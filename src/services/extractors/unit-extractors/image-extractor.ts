interface ImageCandidate {
   url: string;
   score: number;
   source: "img-src" | "data-src" | "srcset" | "background" | "picture";
   context?: string;
   dimensions?: { width?: number; height?: number };
}

interface ExtractorApiResponse {
   store_name: string;
   url: string;
   total_images_found: number;
   top_15_images: Array<{
      url: string;
      alt: string;
      title: string;
      width: string;
      height: string;
      quality_score: number;
      file_size_mb: number;
   }>;
   extraction_method: string;
}

export class ImageExtractor {
   private extractorApiUrl: string | null = null;

   constructor() {
      // Verificar se a variável de ambiente EXTRACTOR está disponível
      let extractorUrl = process.env.EXTRACTOR || null;

      // Corrigir problema de IPv6/IPv4 - forçar IPv4
      if (extractorUrl && extractorUrl.includes("localhost")) {
         extractorUrl = extractorUrl.replace("localhost", "127.0.0.1");
         console.log(`🔄 [ImageExtractor]: Converted localhost to IPv4: ${extractorUrl}`);
      }

      this.extractorApiUrl = extractorUrl;
   }

   async extractImageUrls(input: string, link: string): Promise<string[]> {
      // Se a API de extração estiver disponível, usar ela
      if (this.extractorApiUrl) {
         try {
            console.log(`🔄 [ImageExtractor]: Using external API: ${this.extractorApiUrl}`);
            return await this.extractWithExternalApi(link);
         } catch (error) {
            console.warn(`⚠️ [ImageExtractor]: External API failed, falling back to local extraction:`, error);
            // Fallback para o método local
         }
      }

      // Método local original
      console.log(`🔍 [ImageExtractor]: Using local extraction method`);
      return await this.extractWithLocalMethod(input, link);
   }

   private async extractWithExternalApi(link: string): Promise<string[]> {
      try {
         const url = `${this.extractorApiUrl}/extract-images`;
         console.log(`🔄 [ImageExtractor]: Using external API: ${url}`);
         const response = await fetch(url, {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
            },
            body: JSON.stringify({
               url: link,
            }),
            // Timeout de 2 minutos para a API
            signal: AbortSignal.timeout(120000),
         });

         if (!response.ok) {
            throw new Error(`API responded with status: ${response.status}`);
         }

         const result: ExtractorApiResponse = await response.json();

         console.log(
            `✅ [ImageExtractor]: External API extracted ${result.top_15_images.length} images from ${result.store_name}`
         );

         // Retornar apenas as URLs das imagens (top 15 já ordenadas por qualidade)
         return result.top_15_images.map((img) => img.url);
      } catch (error) {
         console.error(`❌ [ImageExtractor]: Error calling external API:`, error);
         throw error;
      }
   }

   private async extractWithLocalMethod(input: string, link: string): Promise<string[]> {
      const candidates: ImageCandidate[] = [];
      const baseUrl = new URL(link);

      // 1. Tags img com src (prioridade alta)
      const imgRegex = /<img([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*?)>/gi;
      let match: any;
      while ((match = imgRegex.exec(input)) !== null) {
         const fullMatch = match[0];
         const beforeSrc = match[1];
         const srcUrl = match[2];
         const afterSrc = match[3];
         const fullAttrs = beforeSrc + afterSrc;

         candidates.push({
            url: srcUrl,
            score: 0,
            source: "img-src",
            context: fullMatch,
            dimensions: this.extractDimensions(fullAttrs),
         });
      }

      // 2. Data-src para lazy loading (prioridade alta)
      const dataSrcRegex = /<([^>]*?)data-src\s*=\s*["']([^"']+)["']([^>]*?)>/gi;
      while ((match = dataSrcRegex.exec(input)) !== null) {
         const fullMatch = match[0];
         const beforeDataSrc = match[1];
         const dataSrcUrl = match[2];
         const afterDataSrc = match[3];
         const fullAttrs = beforeDataSrc + afterDataSrc;

         candidates.push({
            url: dataSrcUrl,
            score: 0,
            source: "data-src",
            context: fullMatch,
            dimensions: this.extractDimensions(fullAttrs),
         });
      }

      // 3. Srcset para imagens responsivas
      const srcsetRegex = /<img([^>]*?)srcset\s*=\s*["']([^"']+)["']([^>]*?)>/gi;
      while ((match = srcsetRegex.exec(input)) !== null) {
         const srcsetValue = match[2];
         const srcsetUrls = this.parseSrcset(srcsetValue);
         const fullAttrs = match[1] + match[3];

         srcsetUrls.forEach(({ url, width }) => {
            candidates.push({
               url,
               score: 0,
               source: "srcset",
               context: match[0],
               dimensions: { width },
            });
         });
      }

      // 4. Tags picture/source
      const pictureRegex = /<picture[^>]*>([\s\S]*?)<\/picture>/gi;
      while ((match = pictureRegex.exec(input)) !== null) {
         const pictureContent = match[1];
         const sourceRegex = /<source[^>]*srcset\s*=\s*["']([^"']+)["'][^>]*>/gi;
         let sourceMatch;

         while ((sourceMatch = sourceRegex.exec(pictureContent)) !== null) {
            const srcsetUrls = this.parseSrcset(sourceMatch[1]);
            srcsetUrls.forEach(({ url, width }) => {
               candidates.push({
                  url,
                  score: 0,
                  source: "picture",
                  context: match[0],
                  dimensions: { width },
               });
            });
         }
      }

      // 5. Background-image (prioridade menor)
      const bgRegex = /background-image\s*:\s*url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi;
      while ((match = bgRegex.exec(input)) !== null) {
         candidates.push({
            url: match[1],
            score: 0,
            source: "background",
            context: match[0],
         });
      }

      // Processar e ranquear candidatos
      const processedCandidates = candidates
         .map((candidate) => ({
            ...candidate,
            url: this.resolveUrl(candidate.url, baseUrl),
            score: this.calculateImageScore(candidate, input),
         }))
         .filter((candidate) => this.isValidImageUrl(candidate.url))
         .filter(
            (candidate, index, arr) => arr.findIndex((c) => c.url === candidate.url) === index // Remove duplicatas
         );

      // Ordenar por score (maior para menor)
      processedCandidates.sort((a, b) => b.score - a.score);

      // Retornar apenas as URLs das 10 melhores
      return processedCandidates.slice(0, 10).map((c) => c.url);
   }

   private extractDimensions(attrs: string): { width?: number; height?: number } {
      const dimensions: { width?: number; height?: number } = {};

      const widthMatch = attrs.match(/width\s*=\s*["']?(\d+)["']?/i);
      const heightMatch = attrs.match(/height\s*=\s*["']?(\d+)["']?/i);

      if (widthMatch) dimensions.width = parseInt(widthMatch[1]);
      if (heightMatch) dimensions.height = parseInt(heightMatch[1]);

      return dimensions;
   }

   private parseSrcset(srcset: string): { url: string; width?: number }[] {
      return srcset.split(",").map((item) => {
         const parts = item.trim().split(/\s+/);
         const url = parts[0];
         const descriptor = parts[1];

         if (descriptor && descriptor.endsWith("w")) {
            return { url, width: parseInt(descriptor.slice(0, -1)) };
         }

         return { url };
      });
   }

   private calculateImageScore(candidate: ImageCandidate, htmlContent: string): number {
      let score = 0;
      const url = candidate.url.toLowerCase();
      const context = (candidate.context || "").toLowerCase();

      // Pontuação base por tipo de fonte
      const sourceScores = {
         "img-src": 10,
         "data-src": 12, // Lazy loading geralmente é para imagens importantes
         srcset: 15, // Imagens responsivas são geralmente principais
         picture: 18, // Picture elements são para imagens muito importantes
         background: 5, // Background images são menos relevantes para produtos
      };
      score += sourceScores[candidate.source];

      // Pontuação por dimensões - Priorizar imagens de alta resolução
      if (candidate.dimensions?.width && candidate.dimensions?.height) {
         const area = candidate.dimensions.width * candidate.dimensions.height;

         if (area >= 1200 * 800) score += 50; // Muito alta resolução (4K+)
         else if (area >= 800 * 600) score += 40; // Alta resolução (Full HD)
         else if (area >= 600 * 400) score += 30; // Média-alta resolução
         else if (area >= 400 * 300) score += 20; // Média resolução
         else if (area >= 200 * 150) score += 15; // Baixa resolução
         else if (area < 100 * 100) score -= 20; // Muito baixa resolução
         else score += 10; // Resolução padrão
      } else if (candidate.dimensions?.width) {
         // Se só temos largura, usar como referência
         if (candidate.dimensions.width >= 1200) score += 35;
         else if (candidate.dimensions.width >= 800) score += 30;
         else if (candidate.dimensions.width >= 600) score += 25;
         else if (candidate.dimensions.width >= 400) score += 20;
         else if (candidate.dimensions.width >= 200) score += 15;
         else if (candidate.dimensions.width < 100) score -= 15;
         else score += 10;
      } else if (candidate.dimensions?.height) {
         // Se só temos altura, usar como referência
         if (candidate.dimensions.height >= 800) score += 30;
         else if (candidate.dimensions.height >= 600) score += 25;
         else if (candidate.dimensions.height >= 400) score += 20;
         else if (candidate.dimensions.height >= 200) score += 15;
         else if (candidate.dimensions.height < 100) score -= 15;
         else score += 10;
      } else {
         // Sem dimensões conhecidas
         score += 5;
      }

      // Palavras-chave positivas na URL - Priorizar alta qualidade
      const positiveKeywords = [
         "product",
         "produto",
         "item",
         "gallery",
         "galeria",
         "main",
         "principal",
         "hero",
         "large",
         "big",
         "zoom",
         "detail",
         "detalhe",
         "high",
         "hd",
         "full",
         "original",
         "catalog",
         "catalogo",
         "1200",
         "1000",
         "800",
         "600",
         "4k",
         "ultra",
         "premium",
         "quality",
         "qualidade",
         "max",
         "maximum",
         "best",
         "melhor",
         "super",
         "mega",
         "extra",
         "plus",
         "pro",
      ];

      positiveKeywords.forEach((keyword) => {
         if (url.includes(keyword)) score += 8;
      });

      // Palavras-chave negativas na URL
      const negativeKeywords = [
         "logo",
         "icon",
         "icone",
         "banner",
         "ad",
         "advertisement",
         "thumb",
         "thumbnail",
         "small",
         "mini",
         "tiny",
         "badge",
         "social",
         "footer",
         "header",
         "nav",
         "menu",
         "btn",
         "button",
         "arrow",
         "seta",
         "loading",
         "spinner",
         "pixel",
         "tracking",
         "analytics",
      ];

      negativeKeywords.forEach((keyword) => {
         if (url.includes(keyword)) score -= 15;
      });

      // Análise do contexto HTML
      if (context) {
         // Classes e IDs positivos
         const positiveClasses = [
            "product-image",
            "main-image",
            "hero-image",
            "gallery",
            "zoom",
            "produto-imagem",
            "imagem-principal",
            "foto-produto",
         ];

         positiveClasses.forEach((className) => {
            if (context.includes(className)) score += 12;
         });

         // Atributos que indicam importância
         if (context.includes('loading="eager"')) score += 8;
         if (context.includes('fetchpriority="high"')) score += 10;
         if (context.includes("itemprop")) score += 6; // Schema.org

         // Alt text relevante
         const altMatch = context.match(/alt\s*=\s*["']([^"']+)["']/i);
         if (altMatch) {
            const altText = altMatch[1].toLowerCase();
            if (altText.includes("product") || altText.includes("produto")) score += 8;
            if (altText.length > 5 && !altText.includes("image")) score += 5; // Alt descritivo
         }
      }

      // Boost para URLs que parecem ser de produtos
      if (url.match(/\/products?\/|\/produto/)) score += 15;

      // Penalizar URLs que parecem ser recursos do sistema
      if (url.match(/\/(assets|static|css|js|fonts?)\//)) score -= 20;

      // Boost para formatos de alta qualidade
      if (url.match(/\.(jpg|jpeg)$/i)) score += 5;
      if (url.match(/\.webp$/i)) score += 8; // WebP geralmente indica imagens otimizadas
      if (url.match(/\.png$/i)) score += 3;
      if (url.match(/\.(tiff|tif)$/i)) score += 15; // TIFF é formato de alta qualidade
      if (url.match(/\.(bmp|gif)$/i)) score -= 5; // Formatos mais antigos

      // Penalizar SVGs (geralmente ícones)
      if (url.match(/\.svg$/i)) score -= 8;

      // Penalizar URLs muito curtas (geralmente ícones)
      if (url.length < 20) score -= 10;

      return Math.max(0, score); // Não permitir scores negativos
   }

   private resolveUrl(url: string, baseUrl: URL): string {
      try {
         // Se já é uma URL completa
         if (url.match(/^https?:\/\//)) {
            return url;
         }

         // Se começa com //
         if (url.startsWith("//")) {
            return baseUrl.protocol + url;
         }

         // URL relativa
         if (url.startsWith("/")) {
            return baseUrl.origin + url;
         }

         // URL relativa sem /
         return new URL(url, baseUrl.href).href;
      } catch {
         return url; // Retorna original se não conseguir resolver
      }
   }

   private isValidImageUrl(url: string): boolean {
      if (!url || url.trim() === "") return false;

      // Verificar se tem extensão de imagem
      if (!/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url)) return false;

      // Verificar se não é data URL muito pequena
      if (url.startsWith("data:") && url.length < 100) return false;

      // Verificar se não são URLs de tracking/analytics
      if (url.match(/(analytics|tracking|pixel|beacon)/i)) return false;

      return true;
   }
}
