import { YouTubeService } from "./unit-extractors/yt-services";
import { FacebookService } from "./unit-extractors/facebook.usecase";
import { GenericVideoService } from "./unit-extractors/generic.usecase";
import { InstagramService } from "./unit-extractors/instagram.usecase";
import { TikTokService } from "./unit-extractors/tik-tok.usecase";
import { YouTubeShortsService } from "./unit-extractors/yt-shorts.usecase";
import DexdTvVideoService from "../../dexdTvVideo/dexdTvVideo-service";
import UsageLimitsService from "../../billing/usage-limits-service";
import { DexdTvVideoSavePayload } from "../../dexdTvVideo/dexdTvVideo-interfaces";
import { PageHTMLFetcher } from "./unit-extractors/full-page";
import { OpenAITokenCounter } from "./token-counter";
import { ChineseStoresApiExtractor } from "../chinese-stores-api";
const MODEL_SELECTED = "gpt-4o-mini";
//const MODEL_SELECTED = "gpt-4o";

export class ExtractProductInfoUseCase {
   private prismaClient;
   private tiktokService: TikTokService;
   private ytShortService: YouTubeShortsService;
   private youTubeService: YouTubeService;
   private instagramService: InstagramService;
   private facebookService: FacebookService;
   private genericVideoService: GenericVideoService;
   private readonly dexdTvVideosService: DexdTvVideoService;
   private readonly usageLimitsService: UsageLimitsService;
   private openai;
   private pageHTMLFetcher: PageHTMLFetcher;
   private tokenCounter: OpenAITokenCounter;
   private chineseStoresExtractor: ChineseStoresApiExtractor;

   constructor(prismaClient: any, openai: any) {
      this.prismaClient = prismaClient;
      this.openai = openai;
      this.ytShortService = new YouTubeShortsService();
      this.youTubeService = new YouTubeService();
      this.tiktokService = new TikTokService();
      this.instagramService = new InstagramService();
      this.facebookService = new FacebookService();
      this.genericVideoService = new GenericVideoService();
      this.dexdTvVideosService = new DexdTvVideoService(prismaClient);
      this.usageLimitsService = new UsageLimitsService(prismaClient);
      this.pageHTMLFetcher = new PageHTMLFetcher();
      this.tokenCounter = new OpenAITokenCounter();
      this.chineseStoresExtractor = new ChineseStoresApiExtractor();
   }

   calculateCost(model: any, startTime: any, response: any) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Extrair informações de uso de tokens
      const usage = response.usage;
      const inputTokens = usage.prompt_tokens;
      const outputTokens = usage.completion_tokens;

      // Registrar uso e calcular custos
      this.tokenCounter.logTokenUsage(model, inputTokens, outputTokens, duration);
      console.info("📊 [Extractor]: OpenAI usage stats:", {
         usage: {
            inputTokens,
            outputTokens,
            totalTokens: usage.total_tokens,
            cost: this.tokenCounter.calculateCost(model, inputTokens, outputTokens),
         },
      });
   }

   getOpenAIStats() {
      const stats = this.tokenCounter.getStats();
      console.info("📊 === GENERAL OPENAI STATISTICS ===");
      console.info(`💵 Total Cost: ${stats.totalCost.toFixed(6)}`);
      console.info(`📥 Total Input Tokens: ${stats.totalInputTokens.toLocaleString()}`);
      console.info(`📤 Total Output Tokens: ${stats.totalOutputTokens.toLocaleString()}`);
      console.info(`🔢 Total Tokens: ${stats.totalTokens.toLocaleString()}`);
      console.info(`🔄 Total Calls: ${stats.callCount}`);
      console.info(`📊 Average Cost Per Call: ${stats.averageCostPerCall.toFixed(6)}`);
      console.info("=====================================\n");

      return stats;
   }

   /**
    * Extrai o ID do vídeo do YouTube da URL
    */
   private extractYouTubeVideoId(url: string): string | null {
      if (!url) return null;
      const patterns = [
         /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
         /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
      ];
      for (const pattern of patterns) {
         const match = url.match(pattern);
         if (match && match[1]) {
            return match[1];
         }
      }
      return null;
   }

   /**
    * Gera a URL da thumbnail do YouTube diretamente (sem precisar de API)
    * Formato: https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg
    */
   private getYouTubeThumbnailFromUrl(url: string): string | null {
      const videoId = this.extractYouTubeVideoId(url);
      if (videoId) {
         return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
      return null;
   }

   /**
    * Extrai a melhor thumbnail disponível dos metadados do vídeo
    * Suporta YouTube (thumbnails object) e outras plataformas (thumbnailUrl string)
    */
   private getBestThumbnail(videoMetadata: any, videoLink?: string): string | null {
      // PRIORIDADE 1: Se for YouTube, gerar thumbnail direta da URL (mais confiável!)
      if (videoLink && (videoLink.includes("youtube.com") || videoLink.includes("youtu.be"))) {
         const ytThumbnail = this.getYouTubeThumbnailFromUrl(videoLink);
         if (ytThumbnail) {
            console.info(`🖼️ [Extractor]: YouTube thumbnail from URL: ${ytThumbnail}`);
            return ytThumbnail;
         }
      }

      if (!videoMetadata) return null;

      // PRIORIDADE 2: YouTube retorna thumbnails como objeto com várias resoluções
      if (videoMetadata.thumbnails && typeof videoMetadata.thumbnails === "object") {
         const thumbnails = videoMetadata.thumbnails;
         // Priorizar maior resolução
         if (thumbnails.maxres?.url) return thumbnails.maxres.url;
         if (thumbnails.high?.url) return thumbnails.high.url;
         if (thumbnails.standard?.url) return thumbnails.standard.url;
         if (thumbnails.medium?.url) return thumbnails.medium.url;
         if (thumbnails.default?.url) return thumbnails.default.url;

         // Fallback para qualquer thumbnail disponível
         const availableThumbnails = Object.values(thumbnails).filter(
            (t: any) => t && typeof t === "object" && "url" in t
         );
         if (availableThumbnails.length > 0) {
            return (availableThumbnails[0] as { url: string }).url;
         }
      }

      // PRIORIDADE 3: Outras plataformas retornam thumbnailUrl diretamente
      if (videoMetadata.thumbnailUrl) {
         return videoMetadata.thumbnailUrl;
      }

      // PRIORIDADE 4: Fallback para thumbnail simples (mas verificar se não é logo do YT)
      if (videoMetadata.thumbnail) {
         const thumb = videoMetadata.thumbnail;
         // Ignorar logos genéricos do YouTube
         if (thumb.includes("yt_logo") || thumb.includes("supported_browsers") || thumb.includes("/img/desktop/")) {
            console.warn(`⚠️ [Extractor]: Ignoring YouTube logo as thumbnail`);
            return null;
         }
         return thumb;
      }

      return null;
   }

   /**
    * Método principal que cria vídeo e retorna links de produtos (como no código da esquerda)
    */
   async execute(link: string, user: any) {
      const userId = user?.id;
      console.info(`🚀 [Extractor]: Starting video processing with product detection. User ID: ${userId}`);
      console.info(`🔗 [Extractor]: Link: ${link}`);

      try {
         // ETAPA 1: Detectar plataforma e obter metadados
         const videoMetadata = await this.getVideoMetadata(link);
         console.info(`📱 [Extractor]: Platform detected: ${videoMetadata.platform}`);

         // ETAPA 2: Criar o vídeo com tags usando IA
         console.info("🎥 [Extractor]: STEP 2: Creating video with tags...");
         const video = await this.createDexdTvVideoWithAIAndTags(user, link, null, videoMetadata);
         console.info(`✅ [Extractor]: Video created successfully. ID: ${video.id}`);

         // // ETAPA 3: Detectar links de produtos no conteúdo (sem criar os produtos)
         // console.log("🔍 ETAPA 3: Detectando links de produtos no conteúdo...");
         // const productLinks = await this.extractProductLinksFromVideoContent(link, video, videoMetadata);
         const links = video.productsInfo?.map((product: any) => product.url);
         const result = {
            video: video.video,
            productLinks: links || [],
            productsInfo: video.productsInfo,
            message:
               links && links.length > 0
                  ? `Vídeo criado com sucesso! ${links.length} link(s) de produto detectado(s).`
                  : "Vídeo criado com sucesso!",
         };

         console.info(`🎯 [Extractor]: Processing completed. Video: ✅, Detected links: ${links?.length || 0}`);
         return result;
      } catch (error) {
         console.error("❌ [Extractor]: Error in execute processing:", error);
         throw error;
      }
   }

   /**
    * Método para criar vídeo no banco usando dados já processados pela LLM (vindo do worker)
    * Este método NÃO chama a LLM, apenas usa os dados recebidos para criar no banco
    */
   async createVideoFromLLMData(user: any, videoInfo: any, videoLink: string) {
      try {
         console.info(`🎬 [Extractor]: Creating video from pre-processed LLM data...`);
         console.info(`👤 [Extractor]: User ID: ${user?.id}`);

         // Procurar ou criar as 10 tags usando os dados da LLM
         const tagIds = await this.findOrCreateExactly10TagIds(videoInfo.tags || []);

         console.info(`🏷️ [Extractor]: Tag IDs connected: ${JSON.stringify(tagIds)}`);

         // ❌ REMOVIDA A VERIFICAÇÃO AQUI - JÁ FOI FEITA ANTES DE ENVIAR PARA FILA
         // A verificação agora ocorre no SystemController ANTES de enviar para BullMQ
         // Isso evita gastar recursos de IA quando o limite já foi excedido

         // Extrair a melhor thumbnail - PRIORIZA YouTube direto da URL!
         const platformThumbnail = this.getBestThumbnail(videoInfo, videoLink);
         console.info(`🖼️ [Extractor]: Platform thumbnail: ${platformThumbnail || "NULL"}`);
         
         // Montar o payload para criar o vídeo
         const videoData: any = {
            title: videoInfo.title || "Vídeo importado",
            description: videoInfo.description || "Vídeo adicionado via IA",
            url: videoLink,
            thumbnail:
               platformThumbnail ||
               "https://res.cloudinary.com/de6vmpoiy/image/upload/v1695837709/unknown.405a1077_tn4zdk.jpg",
            userId: user.id,
            tags: tagIds,
            value: videoInfo.price || 0,
            isPaid: false,
         };

         // Criar vídeo no banco
         const result = await this.dexdTvVideosService.store(videoData);
         const video = result.video;

         // ✅ REGISTRAR USO APÓS CRIAÇÃO
         await this.usageLimitsService.recordUsage(user.id, "videosPerMonth", "video", video.id);

         console.info(`✅ [Extractor]: Video created with ID: ${video.id} and ${tagIds.length} tags`);

         // Montar resposta no mesmo formato do execute()
         const productLinks = videoInfo.productAnalysis?.productLinks || [];
         const productsInfo = videoInfo.productAnalysis?.productsInfo || [];

         return {
            video: video,
            productLinks: productLinks,
            productsInfo: productsInfo,
            message:
               productLinks.length > 0
                  ? `Vídeo criado com sucesso! ${productLinks.length} link(s) de produto detectado(s).`
                  : "Vídeo criado com sucesso!",
         };
      } catch (error: any) {
         console.error("❌ [Extractor]: Error creating video from LLM data:", error);
         throw new Error(`Failed to create video from LLM data: ${error.message}`);
      }
   }

   /**
    * Verifica se o link é de uma loja chinesa e extrai dados usando a API específica
    */
   private async extractChineseStoreProductData(link: string): Promise<any | null> {
      try {
         const hostname = new URL(link).hostname.toLowerCase();

         if (hostname.includes("aliexpress.com") || hostname.includes("shein.com") || hostname.includes("shopee.com")) {
            console.info(`🌐 [Extractor]: Detected Chinese store, using API: ${hostname}`);
            const productData = await this.chineseStoresExtractor.extractProductData(link);

            return {
               url: productData!.url,
               title: productData!.title,
               price: productData!.price,
               originalPrice: productData!.originalPrice,
               description: productData!.description,
               images: productData!.images,
               seller: productData!.store,
               platform: productData!.store,
            };
         }

         return null;
      } catch (error) {
         console.warn("⚠️ [Extractor]: Chinese store extraction failed:", error);
         return null;
      }
   }

   /**
    * ETAPA 1: Detectar plataforma e obter metadados do vídeo
    */
   async getVideoMetadata(link: string) {
      const prompt = `Detecte qual plataforma o link pertence e devolva apenas a palavra correspondente a plataforma sendo possiveis: tiktok, instagram, facebook, youtube-shorts, youtube, outros. Link: ${link}`;

      const response = await this.freePrompt(prompt);
      const plataform = response.choices[0].message.content?.toLowerCase().trim() || "outros";

      let videoMetadata: any = null;

      switch (plataform) {
         case "tiktok":
            videoMetadata = await this.tiktokService.fetchVideoData(link);
            break;
         case "instagram":
            videoMetadata = await this.instagramService.fetchVideoData(link);
            break;
         case "facebook":
            videoMetadata = await this.facebookService.fetchVideoData(link);
            break;
         case "youtube-shorts":
            videoMetadata = await this.ytShortService.fetchShortsData(link);
            break;
         case "youtube":
            videoMetadata = await this.youTubeService.fetchVideoData(link);
            break;
         case "outros":
            videoMetadata = await this.genericVideoService.fetchVideoData(link);
            break;
         default:
            videoMetadata = await this.genericVideoService.fetchVideoData(link);
            break;
      }

      videoMetadata.platform = plataform;
      return videoMetadata;
   }

   /**
    * ETAPA 2: Cria um vídeo na tabela dexd_tv_videos usando IA com sistema de tags
    */
   private async createDexdTvVideoWithAIAndTags(
      user: any,
      videoLink: string,
      description?: string | null,
      videoMetadata?: any
   ): Promise<any> {
      try {
         // ✅ VERIFICAR LIMITES LOGO NO INÍCIO, ANTES DE GASTAR RECURSOS
         const usageCheck = await this.usageLimitsService.canCreateVideo(user.id);
         if (!usageCheck.canProceed) {
            console.warn(`⚠️ [Extractor]: Video limit exceeded for user ${user.id} - BLOQUEADO ANTES DA IA`);
            throw {
               name: "UsageLimitExceededError",
               message: usageCheck.message || "Limite de vídeos excedido",
               status: 403,
            };
         }

         // Usar IA para extrair informações do vídeo
         const videoInfo = await this.analyzeVideoContentWithAI(videoMetadata, videoLink);
         const productLinks = videoInfo.productAnalysis.productLinks;
         const productsInfo = videoInfo.productAnalysis.productsInfo;
         // Procurar ou criar exatamente 10 tags para o vídeo
         const tagIds = await this.findOrCreateExactly10TagIds(videoInfo.tags);

         console.info(`🏷️ [Extractor]: Tag IDs to be connected to the video: ${JSON.stringify(tagIds)}`);

         // Extrair a melhor thumbnail - PRIORIZA YouTube direto da URL!
         const platformThumbnail = this.getBestThumbnail(videoMetadata, videoLink);
         console.info(`🖼️ [Extractor]: Thumbnail extracted: ${platformThumbnail || "NULL"}`);

         // Montar o payload para o método store
         const videoData: DexdTvVideoSavePayload = {
            title: videoInfo.title || videoMetadata?.title || "Vídeo importado",
            description: videoInfo.description || description || videoMetadata?.description || "Vídeo adicionado via IA",
            url: videoLink,
            thumbnail:
               platformThumbnail ||
               videoInfo.thumbnail ||
               "https://res.cloudinary.com/de6vmpoiy/image/upload/v1695837709/unknown.405a1077_tn4zdk.jpg",
            userId: user.id,
            tags: tagIds,
            value: videoInfo.price || 0,
            isPaid: false,
         };

         // Usar o método store do DexdTvVideosService
         const result = await this.dexdTvVideosService.store(videoData);
         const video = result.video;

         // ✅ REGISTRAR USO APÓS CRIAÇÃO
         await this.usageLimitsService.recordUsage(user.id, "videosPerMonth", "video", video.id);

         console.info(`✅ [Extractor]: Video created with ${tagIds.length} tags. ID: ${video.id}`);
         return { video, productLinks, productsInfo };
      } catch (error: any) {
         console.error("❌ [Extractor]: Error creating video with AI and tags:", error);
         throw new Error(`Failed to create video: ${error.message}`);
      }
   }

   /**
    * ETAPA 3: Extrai múltiplos links de produtos do conteúdo do vídeo usando IA (sem criar os produtos)
    */
   private async extractProductLinksFromVideoContent(
      videoLink: string,
      video: any,
      videoMetadata?: any
   ): Promise<string[]> {
      try {
         console.info("🔍 [Extractor]: Analyzing video content to detect product links...");

         const additionalContent = videoMetadata ? JSON.stringify(videoMetadata, null, 2) : "";

         const prompt = `
Analise este vídeo e seu conteúdo para detectar todos os links de produtos específicos mencionados.
Avalie se os links postados são de lojas e de produtos.
NÃO INVENTE LINKS DE PRODUTOS, ou tem ou não, caso o conteudo não tenha links de produtos deixe o array de links vazios.

INFORMAÇÕES DO VÍDEO:
- Link: ${videoLink}
- Título: ${video.title}
- Descrição: ${video.description}
- Conteúdo da página: ${additionalContent}

OBJETIVO:
Extrair TODOS os links de produtos específicos que podem ser comprados online mencionados no vídeo.

INSTRUÇÕES:
1. Analise o título, descrição e conteúdo
2. Procure por todos os links de compra, afiliados, ou referências a lojas
3. Identifique múltiplos produtos se houver
4. Extraia URLs completas de e-commerce

TIPOS DE LINKS VÁLIDOS:
- Links diretos para produtos em e-commerce (Amazon, Mercado Livre, etc.)
- Links de afiliado para produtos específicos
- URLs de páginas de produto
- Links em descrições de vídeos

RETORNE UM JSON:
{
  "hasProducts": true ou false,
  "productLinks": ["url1", "url2", "url3"] ou [],
  "productsInfo": [
    {
      "url": "url_do_produto",
      "productName": "Nome estimado do produto",
      "platform": "amazon|mercadolivre|shopee|etc",
      "confidence": 0.0 a 1.0
    }
  ],
  "totalFound": número_de_links_encontrados,
  "reasoning": "Explicação dos links encontrados"
}

REGRAS:
- Retorne TODOS os links de produtos encontrados
- Só inclua URLs que levem diretamente a produtos compráveis
- Ordene por confiança (mais confiáveis primeiro)
- Inclua no máximo 50 links
- Se for apenas menção genérica sem link, não inclua
         `;
         const startTime = new Date();
         const response = await this.openai.chat.completions.create({
            model: MODEL_SELECTED,
            messages: [
               {
                  role: "system",
                  content: "Você é especialista em identificar links de produtos em conteúdo de vídeo.",
               },
               {
                  role: "user",
                  content: prompt,
               },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 2000,
         });
         this.calculateCost(MODEL_SELECTED, startTime, response);
         this.getOpenAIStats();

         const content = response.choices[0].message.content || "{}";

         try {
            const analysis = JSON.parse(content);
            console.info("📊 [Extractor]: Product analysis:", analysis);

            if (analysis.hasProducts && analysis.productLinks && analysis.productLinks.length > 0) {
               // // Filtrar apenas links com confiança alta
               // const highConfidenceLinks =
               //    analysis.productsInfo
               //       ?.filter((product: any) => product.confidence > 0.6)
               //       ?.map((product: any) => product.url) || analysis.productLinks;

               console.info(`${analysis.productsInfo.length} product link(s) detected`);
               return analysis.productsInfo;
            }

            console.info("Nenhum link de produto detectado");
            return [];
         } catch (parseError) {
            console.error("❌ [Extractor]: Error parsing product analysis:", parseError);
            return [];
         }
      } catch (error) {
         console.error("❌ [Extractor]: Error analyzing products in video:", error);
         return [];
      }
   }

   /**
    * Usa IA para analisar o conteúdo do vídeo e extrair informações incluindo links de produtos
    */
   private async analyzeVideoContentWithAI(videoMetadata: any, videoLink: string): Promise<any> {
      try {
         // Verificar se o link é de uma loja chinesa
         const chineseProductData = await this.extractChineseStoreProductData(videoLink);

         // EXTRAÇÃO DIRETA DE TODOS OS LINKS (SEM LLM) - GARANTE TODOS OS LINKS
         const allExtractedLinks = await this.extractAllProductLinksDirectly(videoLink, videoMetadata);

         // USAR LLM PARA EXTRAIR TÍTULOS DOS LINKS ENCONTRADOS
         const linksWithTitles = await this.extractTitlesFromLinksWithAI(allExtractedLinks, videoMetadata);

         // Usar LLM apenas para informações do vídeo (não para links)
         const contextInfo = videoMetadata ? JSON.stringify(videoMetadata, null, 2) : "Nenhum conteúdo extraído";
         const chineseProductInfo = chineseProductData ? JSON.stringify(chineseProductData, null, 2) : "";

         const prompt = `
Analise este link de vídeo e extraia informações para criar um registro completo.

🔗 LINK DO VÍDEO: ${videoLink}
📄 CONTEÚDO EXTRAÍDO DA PÁGINA: ${contextInfo}
${chineseProductData ? `🏪 DADOS DE PRODUTO CHINÊS EXTRAÍDOS: ${chineseProductInfo}` : ""}

INSTRUÇÕES:
1. Analise o link e conteúdo fornecido
2. Extraia informações sobre o vídeo (título, descrição, plataforma, etc.)
3. NÃO PROCURE POR LINKS DE PRODUTOS - isso já foi feito diretamente
4. Foque apenas nas informações do vídeo

RETORNE UM JSON com os seguintes campos:

{
  "title": "Título do vídeo extraído ou gerado",
  "description": "Descrição detalhada do vídeo",
  "platform": "youtube|vimeo|tiktok|instagram|facebook|other",
  "thumbnail": "URL da thumbnail se disponível",
  "duration": null ou número_em_segundos,
  "category": "Categoria do vídeo (tecnologia, educação, etc.)",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "language": "pt-BR",
  "author": "Nome do canal/autor",
  "price": 0,
  "isEducational": true ou false,
  "targetAudience": "Público-alvo do vídeo",
  "mainTopic": "Tópico principal do vídeo",
  "hasProductMentions": true ou false,
  "contentType": "tutorial|review|entertainment|educational|promotional|other"
}

REGRAS GERAIS:
- Se não conseguir extrair informações específicas, crie baseado na URL
      - Sempre inclua exatamente 10 tags relevantes
- Título deve ser claro e descritivo
- Descrição deve ser útil para busca
- Se for vídeo educacional/tutorial, marque isEducational como true
- NÃO PROCURE POR LINKS DE PRODUTOS
      `;

         const startTime = new Date();
         const response = await this.openai.chat.completions.create({
            model: MODEL_SELECTED,
            messages: [
               {
                  role: "system",
                  content: "Você é um especialista em análise de conteúdo de vídeo e extração de metadados.",
               },
               {
                  role: "user",
                  content: prompt,
               },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 4000,
         });
         this.calculateCost(MODEL_SELECTED, startTime, response);
         this.getOpenAIStats();

         const content = response.choices[0].message.content || "{}";

         try {
            const videoInfo = JSON.parse(content);
            console.info("📊 [Extractor]: Video information analyzed by AI:", videoInfo);

            // CONSTRUIR ANÁLISE DE PRODUTOS COM TODOS OS LINKS EXTRAÍDOS DIRETAMENTE
            const productAnalysis = {
               hasProducts: linksWithTitles.length > 0 || !!chineseProductData,
               productLinks: linksWithTitles.map((link: any) => link.url),
               productsInfo: [...linksWithTitles],
               totalFound: linksWithTitles.length + (chineseProductData ? 1 : 0),
               reasoning: `Encontrados ${linksWithTitles.length} links diretamente + ${
                  chineseProductData ? "1 produto chinês" : "0 produtos chineses"
               }`,
            };

            // Se temos dados de loja chinesa, incluí-los na análise
            if (chineseProductData) {
               productAnalysis.productsInfo.unshift({
                  url: chineseProductData.url,
                  productName: chineseProductData.title,
                  platform: chineseProductData.platform,
                  confidence: 1.0, // Alta confiança pois vem da API
                  price: chineseProductData.price,
                  originalPrice: chineseProductData.originalPrice,
                  description: chineseProductData.description,
                  images: chineseProductData.images,
                  seller: chineseProductData.seller,
               });

               console.info(`🏪 [Extractor]: Chinese store product added to analysis: ${chineseProductData.title}`);
            }

            // Adicionar análise de produtos ao resultado
            videoInfo.productAnalysis = productAnalysis;

            // Log específico para produtos detectados
            if (productAnalysis.hasProducts) {
               console.info(`${productAnalysis.productsInfo?.length || 0} product link(s) detected`);
            } else {
               console.info("Nenhum link de produto detectado");
            }

            return videoInfo;
         } catch (parseError) {
            console.error("❌ [Extractor]: Error parsing video analysis:", parseError);
            return this.getFallbackVideoInfo(videoLink, null);
         }
      } catch (error) {
         console.error("❌ [Extractor]: Error in video analysis with AI:", error);
         return this.getFallbackVideoInfo(videoLink, null);
      }
   }

   /**
    * Usa LLM para extrair títulos dos links encontrados
    */
   private async extractTitlesFromLinksWithAI(links: any[], videoMetadata: any): Promise<any[]> {
      try {
         if (links.length === 0) return links;

         console.info(`🤖 [Extractor]: Using AI to extract titles for ${links.length} links...`);

         const linksInfo = links.map((link, index) => ({
            id: index + 1,
            url: link.url,
            source: link.source,
            confidence: link.confidence,
            isProduct: link.isProduct,
         }));

         const prompt = `
Analise os links encontrados no conteúdo do vídeo e extraia títulos descritivos e precisos para cada um.

📄 CONTEÚDO DO VÍDEO:
${videoMetadata?.description ? `Descrição: ${videoMetadata.description}` : ""}
${videoMetadata?.title ? `Título: ${videoMetadata.title}` : ""}

🔗 LINKS ENCONTRADOS:
${JSON.stringify(linksInfo, null, 2)}

INSTRUÇÕES:
1. Analise cada link e o contexto do vídeo
2. Extraia ou gere um título descritivo e preciso para cada link
3. O título deve ser claro, específico e útil para identificar o produto/conteúdo
4. Use o contexto do vídeo para entender melhor o que cada link representa
5. Se o link for de produto, o título deve descrever o produto
6. Se o link for de rede social, o título deve indicar a plataforma e propósito

RETORNE UM JSON com a seguinte estrutura:
{
  "links": [
    {
      "id": 1,
      "url": "https://exemplo.com/produto",
      "title": "Título descritivo do produto/conteúdo",
      "type": "product|social|website|other",
      "description": "Breve descrição do que é o link"
    }
  ]
}

REGRAS:
- Títulos devem ser em português brasileiro
- Seja específico e descritivo
- Use o contexto do vídeo para melhorar a precisão
- Para produtos, inclua marca/modelo se possível
- Para redes sociais, indique a plataforma e propósito
- Mantenha títulos concisos mas informativos
        `;

         const startTime = new Date();
         const response = await this.openai.chat.completions.create({
            model: MODEL_SELECTED,
            messages: [
               {
                  role: "system",
                  content: "Você é um especialista em análise de links e extração de títulos descritivos.",
               },
               {
                  role: "user",
                  content: prompt,
               },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 4000,
         });
         this.calculateCost(MODEL_SELECTED, startTime, response);
         this.getOpenAIStats();

         const content = response.choices[0].message.content || "{}";
         const result = JSON.parse(content);

         // Combinar os títulos extraídos com os links originais
         const linksWithTitles = links.map((link, index) => {
            const aiResult = result.links?.find((l: any) => l.id === index + 1);
            return {
               ...link,
               productName: aiResult?.title || this.extractProductNameFromUrl(link.url),
               type: aiResult?.type || "unknown",
               description: aiResult?.description || "",
            };
         });

         console.info(`✅ [Extractor]: AI extracted titles for ${linksWithTitles.length} links`);
         return linksWithTitles;
      } catch (error) {
         console.error("❌ [Extractor]: Error extracting titles with AI:", error);
         // Em caso de erro, retorna os links originais com títulos extraídos da URL
         return links.map((link) => ({
            ...link,
            productName: this.extractProductNameFromUrl(link.url),
            type: "unknown",
            description: "",
         }));
      }
   }

   /**
    * Extrai TODOS os links de produtos diretamente do conteúdo sem usar LLM
    * Garante que nenhum link seja perdido
    */
   private async extractAllProductLinksDirectly(videoLink: string, videoMetadata: any): Promise<any[]> {
      try {
         console.info("🔍 [Extractor]: Extracting ALL product links directly from content...");

         const allLinks: any[] = [];

         // 1. Extrair TODOS os links da descrição do vídeo (sem filtrar ainda)
         if (videoMetadata?.description) {
            console.info(`📝 [Extractor]: Processing description with ${videoMetadata.description.length} characters`);
            const descriptionLinks = this.extractAllLinksFromText(videoMetadata.description);
            console.info(`🔗 [Extractor]: Found ${descriptionLinks.length} total links in description`);

            allLinks.push(
               ...descriptionLinks.map((link) => ({
                  url: link,
                  source: "description",
                  confidence: 0.9,
                  isProduct: this.isProductLink(link),
               }))
            );
         }

         // 2. Extrair TODOS os links do título
         if (videoMetadata?.title) {
            const titleLinks = this.extractAllLinksFromText(videoMetadata.title);
            console.info(`🔗 [Extractor]: Found ${titleLinks.length} total links in title`);

            allLinks.push(
               ...titleLinks.map((link) => ({
                  url: link,
                  source: "title",
                  confidence: 0.8,
                  isProduct: this.isProductLink(link),
               }))
            );
         }

         // 3. Extrair TODOS os links de comentários se disponíveis
         if (videoMetadata?.comments) {
            const commentLinks = this.extractAllLinksFromText(JSON.stringify(videoMetadata.comments));
            console.info(`🔗 [Extractor]: Found ${commentLinks.length} total links in comments`);

            allLinks.push(
               ...commentLinks.map((link) => ({
                  url: link,
                  source: "comments",
                  confidence: 0.7,
                  isProduct: this.isProductLink(link),
               }))
            );
         }

         // 4. Extrair TODOS os links da página HTML se disponível
         if (videoMetadata?.pageContent) {
            const pageLinks = this.extractAllLinksFromHTML(videoMetadata.pageContent);
            console.info(`🔗 [Extractor]: Found ${pageLinks.length} total links in page content`);

            allLinks.push(
               ...pageLinks.map((link) => ({
                  url: link,
                  source: "page",
                  confidence: 0.6,
                  isProduct: this.isProductLink(link),
               }))
            );
         }

         // Log de todos os links encontrados
         console.info(`📊 [Extractor]: Total links found: ${allLinks.length}`);
         console.info(`🛍️ [Extractor]: Product links found: ${allLinks.filter((l) => l.isProduct).length}`);

         // Log detalhado de cada link encontrado
         allLinks.forEach((link, index) => {
            console.info(
               `🔗 [Extractor]: Link ${index + 1}: ${link.url} (${link.source}) - Product: ${link.isProduct}`
            );
         });

         // 5. Remover duplicatas e retornar TODOS os links (sem filtrar produtos)
         const uniqueLinks = this.removeDuplicatesAndReturnAll(allLinks);

         console.info(`✅ [Extractor]: Final result: ${uniqueLinks.length} unique product links`);
         return uniqueLinks;
      } catch (error) {
         console.error("❌ [Extractor]: Error extracting links directly:", error);
         return [];
      }
   }

   /**
    * Extrai TODOS os links de um texto usando regex (sem filtrar)
    */
   private extractAllLinksFromText(text: string): string[] {
      if (!text) return [];

      const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
      const matches = text.match(urlRegex) || [];

      return matches;
   }

   /**
    * Extrai links de um texto usando regex (apenas produtos)
    */
   private extractLinksFromText(text: string): string[] {
      if (!text) return [];

      const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
      const matches = text.match(urlRegex) || [];

      return matches.filter((url) => this.isProductLink(url));
   }

   /**
    * Extrai TODOS os links de HTML usando regex (sem filtrar)
    */
   private extractAllLinksFromHTML(html: string): string[] {
      if (!html) return [];

      const hrefRegex = /href=["']([^"']+)["']/gi;
      const matches = [];
      let match;

      while ((match = hrefRegex.exec(html)) !== null) {
         if (match[1] && match[1].startsWith("http")) {
            matches.push(match[1]);
         }
      }

      return matches;
   }

   /**
    * Extrai links de HTML usando regex (apenas produtos)
    */
   private extractLinksFromHTML(html: string): string[] {
      if (!html) return [];

      const hrefRegex = /href=["']([^"']+)["']/gi;
      const matches = [];
      let match;

      while ((match = hrefRegex.exec(html)) !== null) {
         if (match[1] && this.isProductLink(match[1])) {
            matches.push(match[1]);
         }
      }

      return matches;
   }

   /**
    * Verifica se um link é de produto baseado no domínio
    */
   private isProductLink(url: string): boolean {
      try {
         const hostname = new URL(url).hostname.toLowerCase();

         // Lista expandida de domínios de e-commerce conhecidos
         const productDomains = [
            // Amazon
            "amazon.com",
            "amazon.com.br",
            "amzn.to",
            "amzn.com",
            "amazon.co.uk",
            "amazon.de",
            "amazon.fr",
            "amazon.it",
            "amazon.es",
            "amazon.ca",
            "amazon.com.mx",
            "amazon.com.au",
            "amazon.in",
            "amazon.co.jp",

            // Mercado Livre
            "mercadolivre.com.br",
            "mercadolibre.com",
            "mercadolibre.com.ar",
            "mercadolibre.com.mx",
            "mercadolibre.cl",
            "mercadolibre.com.co",
            "mercadolibre.com.pe",
            "mercadolibre.com.uy",
            "mercadolibre.com.ve",

            // Magazine Luiza
            "magazineluiza.com",
            "magalu.com",
            "magazinevoce.com",

            // Americanas/Submarino
            "americanas.com.br",
            "submarino.com",
            "shoptime.com.br",

            // Casas Bahia
            "casasbahia.com.br",
            "extra.com.br",
            "pontofrio.com.br",

            // Shopee
            "shopee.com.br",
            "shopee.com",
            "shopee.com.my",
            "shopee.co.th",
            "shopee.co.id",
            "shopee.com.sg",
            "shopee.com.ph",
            "shopee.vn",

            // AliExpress
            "aliexpress.com",
            "aliexpress.us",
            "aliexpress.ru",

            // Shein
            "shein.com",
            "shein.com.br",
            "shein.com.mx",
            "shein.com.ar",
            "shein.com.co",
            "shein.com.pe",
            "shein.com.cl",
            "shein.com.uy",
            "shein.com.ve",

            // Netshoes
            "netshoes.com.br",
            "netshoes.com.ar",
            "netshoes.com.mx",

            // Dafiti
            "dafiti.com.br",
            "dafiti.com.ar",
            "dafiti.com.mx",
            "dafiti.com.co",
            "dafiti.com.pe",
            "dafiti.com.cl",

            // Zattini
            "zattini.com.br",
            "zattini.com.ar",
            "zattini.com.mx",
            "zattini.com.co",
            "zattini.com.pe",
            "zattini.com.cl",

            // Walmart
            "walmart.com.br",
            "walmart.com",
            "walmart.com.mx",
            "walmart.com.ar",
            "walmart.com.co",
            "walmart.com.pe",
            "walmart.com.cl",

            // Carrefour
            "carrefour.com.br",
            "carrefour.com",
            "carrefour.com.ar",
            "carrefour.com.mx",
            "carrefour.com.co",
            "carrefour.com.pe",
            "carrefour.com.cl",

            // Hotmart
            "hotmart.com",
            "hotmart.com.br",
            "hotmart.com.mx",
            "hotmart.com.ar",
            "hotmart.com.co",
            "hotmart.com.pe",
            "hotmart.com.cl",

            // Eduzz
            "eduzz.com",
            "eduzz.com.br",
            "eduzz.com.mx",
            "eduzz.com.ar",
            "eduzz.com.co",
            "eduzz.com.pe",
            "eduzz.com.cl",

            // Monetizze
            "monetizze.com.br",
            "monetizze.com",
            "monetizze.com.mx",
            "monetizze.com.ar",
            "monetizze.com.co",
            "monetizze.com.pe",
            "monetizze.com.cl",

            // Lomadee
            "lomadee.com",
            "lomadee.com.br",
            "lomadee.com.mx",
            "lomadee.com.ar",
            "lomadee.com.co",
            "lomadee.com.pe",
            "lomadee.com.cl",

            // Zanox
            "zanox.com",
            "zanox.com.br",
            "zanox.com.mx",
            "zanox.com.ar",
            "zanox.com.co",
            "zanox.com.pe",
            "zanox.com.cl",

            // Outras plataformas brasileiras
            "kabum.com.br",
            "terabyteshop.com.br",
            "pichau.com.br",
            "gigantec.com.br",
            "fastshop.com.br",
            "ricardoeletro.com.br",
            "saraiva.com.br",
            "livrariacultura.com.br",
            "americanas.com.br",
            "submarino.com.br",
            "shoptime.com.br",

            // Plataformas internacionais
            "ebay.com",
            "ebay.com.br",
            "ebay.com.mx",
            "ebay.com.ar",
            "ebay.com.co",
            "ebay.com.pe",
            "ebay.com.cl",
            "wish.com",
            "wish.com.br",
            "wish.com.mx",
            "wish.com.ar",
            "wish.com.co",
            "wish.com.pe",
            "wish.com.cl",
            "banggood.com",
            "banggood.com.br",
            "banggood.com.mx",
            "banggood.com.ar",
            "banggood.com.co",
            "banggood.com.pe",
            "banggood.com.cl",
            "gearbest.com",
            "gearbest.com.br",
            "gearbest.com.mx",
            "gearbest.com.ar",
            "gearbest.com.co",
            "gearbest.com.pe",
            "gearbest.com.cl",
            "lightinthebox.com",
            "lightinthebox.com.br",
            "lightinthebox.com.mx",
            "lightinthebox.com.ar",
            "lightinthebox.com.co",
            "lightinthebox.com.pe",
            "lightinthebox.com.cl",

            // Plataformas de afiliados
            "clickbank.com",
            "clickbank.com.br",
            "clickbank.com.mx",
            "clickbank.com.ar",
            "clickbank.com.co",
            "clickbank.com.pe",
            "clickbank.com.cl",
            "jvzoo.com",
            "jvzoo.com.br",
            "jvzoo.com.mx",
            "jvzoo.com.ar",
            "jvzoo.com.co",
            "jvzoo.com.pe",
            "jvzoo.com.cl",
            "warriorplus.com",
            "warriorplus.com.br",
            "warriorplus.com.mx",
            "warriorplus.com.ar",
            "warriorplus.com.co",
            "warriorplus.com.pe",
            "warriorplus.com.cl",

            // Plataformas de cursos
            "udemy.com",
            "udemy.com.br",
            "udemy.com.mx",
            "udemy.com.ar",
            "udemy.com.co",
            "udemy.com.pe",
            "udemy.com.cl",
            "coursera.org",
            "coursera.org.br",
            "coursera.org.mx",
            "coursera.org.ar",
            "coursera.org.co",
            "coursera.org.pe",
            "coursera.org.cl",
            "skillshare.com",
            "skillshare.com.br",
            "skillshare.com.mx",
            "skillshare.com.ar",
            "skillshare.com.co",
            "skillshare.com.pe",
            "skillshare.com.cl",

            // Plataformas de software
            "adobe.com",
            "adobe.com.br",
            "adobe.com.mx",
            "adobe.com.ar",
            "adobe.com.co",
            "adobe.com.pe",
            "adobe.com.cl",
            "microsoft.com",
            "microsoft.com.br",
            "microsoft.com.mx",
            "microsoft.com.ar",
            "microsoft.com.co",
            "microsoft.com.pe",
            "microsoft.com.cl",
            "apple.com",
            "apple.com.br",
            "apple.com.mx",
            "apple.com.ar",
            "apple.com.co",
            "apple.com.pe",
            "apple.com.cl",

            // Plataformas de jogos
            "steam.com",
            "steam.com.br",
            "steam.com.mx",
            "steam.com.ar",
            "steam.com.co",
            "steam.com.pe",
            "steam.com.cl",
            "gog.com",
            "gog.com.br",
            "gog.com.mx",
            "gog.com.ar",
            "gog.com.co",
            "gog.com.pe",
            "gog.com.cl",
            "epicgames.com",
            "epicgames.com.br",
            "epicgames.com.mx",
            "epicgames.com.ar",
            "epicgames.com.co",
            "epicgames.com.pe",
            "epicgames.com.cl",

            // Plataformas de streaming
            "netflix.com",
            "netflix.com.br",
            "netflix.com.mx",
            "netflix.com.ar",
            "netflix.com.co",
            "netflix.com.pe",
            "netflix.com.cl",
            "disneyplus.com",
            "disneyplus.com.br",
            "disneyplus.com.mx",
            "disneyplus.com.ar",
            "disneyplus.com.co",
            "disneyplus.com.pe",
            "disneyplus.com.cl",
            "hbo.com",
            "hbo.com.br",
            "hbo.com.mx",
            "hbo.com.ar",
            "hbo.com.co",
            "hbo.com.pe",
            "hbo.com.cl",
            "primevideo.com",
            "primevideo.com.br",
            "primevideo.com.mx",
            "primevideo.com.ar",
            "primevideo.com.co",
            "primevideo.com.pe",
            "primevideo.com.cl",

            // Plataformas de música
            "spotify.com",
            "spotify.com.br",
            "spotify.com.mx",
            "spotify.com.ar",
            "spotify.com.co",
            "spotify.com.pe",
            "spotify.com.cl",
            "deezer.com",
            "deezer.com.br",
            "deezer.com.mx",
            "deezer.com.ar",
            "deezer.com.co",
            "deezer.com.pe",
            "deezer.com.cl",
            "tidal.com",
            "tidal.com.br",
            "tidal.com.mx",
            "tidal.com.ar",
            "tidal.com.co",
            "tidal.com.pe",
            "tidal.com.cl",

            // Plataformas de livros
            "kindle.com",
            "kindle.com.br",
            "kindle.com.mx",
            "kindle.com.ar",
            "kindle.com.co",
            "kindle.com.pe",
            "kindle.com.cl",
            "kobo.com",
            "kobo.com.br",
            "kobo.com.mx",
            "kobo.com.ar",
            "kobo.com.co",
            "kobo.com.pe",
            "kobo.com.cl",

            // Plataformas de roupas e acessórios
            "renner.com.br",
            "renner.com.ar",
            "renner.com.mx",
            "renner.com.co",
            "renner.com.pe",
            "renner.com.cl",
            "c&a.com.br",
            "c&a.com.ar",
            "c&a.com.mx",
            "c&a.com.co",
            "c&a.com.pe",
            "c&a.com.cl",
            "riachuelo.com.br",
            "riachuelo.com.ar",
            "riachuelo.com.mx",
            "riachuelo.com.co",
            "riachuelo.com.pe",
            "riachuelo.com.cl",
            "marisa.com.br",
            "marisa.com.ar",
            "marisa.com.mx",
            "marisa.com.co",
            "marisa.com.pe",
            "marisa.com.cl",

            // Plataformas de calçados
            "centauro.com.br",
            "centauro.com.ar",
            "centauro.com.mx",
            "centauro.com.co",
            "centauro.com.pe",
            "centauro.com.cl",
            "nike.com",
            "nike.com.br",
            "nike.com.mx",
            "nike.com.ar",
            "nike.com.co",
            "nike.com.pe",
            "nike.com.cl",
            "adidas.com",
            "adidas.com.br",
            "adidas.com.mx",
            "adidas.com.ar",
            "adidas.com.co",
            "adidas.com.pe",
            "adidas.com.cl",
            "puma.com",
            "puma.com.br",
            "puma.com.mx",
            "puma.com.ar",
            "puma.com.co",
            "puma.com.pe",
            "puma.com.cl",

            // Plataformas de cosméticos
            "sephora.com",
            "sephora.com.br",
            "sephora.com.mx",
            "sephora.com.ar",
            "sephora.com.co",
            "sephora.com.pe",
            "sephora.com.cl",
            "loreal.com",
            "loreal.com.br",
            "loreal.com.mx",
            "loreal.com.ar",
            "loreal.com.co",
            "loreal.com.pe",
            "loreal.com.cl",
            "avon.com",
            "avon.com.br",
            "avon.com.mx",
            "avon.com.ar",
            "avon.com.co",
            "avon.com.pe",
            "avon.com.cl",

            // Plataformas de perfumes
            "boticario.com.br",
            "boticario.com.ar",
            "boticario.com.mx",
            "boticario.com.co",
            "boticario.com.pe",
            "boticario.com.cl",
            "natura.com.br",
            "natura.com.ar",
            "natura.com.mx",
            "natura.com.co",
            "natura.com.pe",
            "natura.com.cl",

            // Plataformas de bebidas
            "heineken.com",
            "heineken.com.br",
            "heineken.com.mx",
            "heineken.com.ar",
            "heineken.com.co",
            "heineken.com.pe",
            "heineken.com.cl",
            "corona.com",
            "corona.com.br",
            "corona.com.mx",
            "corona.com.ar",
            "corona.com.co",
            "corona.com.pe",
            "corona.com.cl",
            "budweiser.com",
            "budweiser.com.br",
            "budweiser.com.mx",
            "budweiser.com.ar",
            "budweiser.com.co",
            "budweiser.com.pe",
            "budweiser.com.cl",

            // Plataformas de alimentos
            "nestle.com",
            "nestle.com.br",
            "nestle.com.mx",
            "nestle.com.ar",
            "nestle.com.co",
            "nestle.com.pe",
            "nestle.com.cl",
            "coca-cola.com",
            "coca-cola.com.br",
            "coca-cola.com.mx",
            "coca-cola.com.ar",
            "coca-cola.com.co",
            "coca-cola.com.pe",
            "coca-cola.com.cl",
            "pepsico.com",
            "pepsico.com.br",
            "pepsico.com.mx",
            "pepsico.com.ar",
            "pepsico.com.co",
            "pepsico.com.pe",
            "pepsico.com.cl",
         ];

         return productDomains.some((domain) => hostname.includes(domain));
      } catch {
         return false;
      }
   }

   /**
    * Remove duplicatas e retorna TODOS os links (sem filtrar produtos)
    */
   private removeDuplicatesAndReturnAll(links: any[]): any[] {
      const seen = new Set();
      const unique = [];

      for (const link of links) {
         const normalizedUrl = this.normalizeUrl(link.url);

         if (!seen.has(normalizedUrl)) {
            seen.add(normalizedUrl);
            unique.push({
               url: link.url,
               productName: this.extractProductNameFromUrl(link.url),
               platform: this.extractPlatformFromUrl(link.url),
               confidence: link.confidence,
               source: link.source,
               isProduct: link.isProduct, // Mantém a informação se é produto ou não
            });
         }
      }

      // Ordenar por confiança (mais alta primeiro)
      return unique.sort((a, b) => b.confidence - a.confidence);
   }

   /**
    * Remove duplicatas e filtra apenas links válidos de produtos
    */
   private filterAndDeduplicateProductLinks(links: any[]): any[] {
      const seen = new Set();
      const filtered = [];

      for (const link of links) {
         const normalizedUrl = this.normalizeUrl(link.url);

         // Verificar se é um link de produto ou tem características de produto
         const isProduct = this.isProductLink(link.url) || this.hasProductCharacteristics(link.url);

         if (!seen.has(normalizedUrl) && isProduct) {
            seen.add(normalizedUrl);
            filtered.push({
               url: link.url,
               productName: this.extractProductNameFromUrl(link.url),
               platform: this.extractPlatformFromUrl(link.url),
               confidence: link.confidence,
               source: link.source,
            });
         }
      }

      // Ordenar por confiança (mais alta primeiro)
      return filtered.sort((a, b) => b.confidence - a.confidence);
   }

   /**
    * Verifica se uma URL tem características de produto mesmo não estando na lista de domínios
    */
   private hasProductCharacteristics(url: string): boolean {
      try {
         const urlObj = new URL(url);
         const pathname = urlObj.pathname.toLowerCase();
         const searchParams = urlObj.searchParams.toString().toLowerCase();

         // Verificar se é Google Shopping
         const isGoogleShopping =
            (urlObj.hostname.includes("gstatic.com") && pathname.includes("/shopping")) ||
            (urlObj.hostname.includes("google.com") && pathname.includes("/shopping"));

         if (isGoogleShopping) {
            return true;
         }

         // Palavras-chave que indicam que é um produto
         const productKeywords = [
            "product",
            "produto",
            "item",
            "buy",
            "comprar",
            "purchase",
            "shop",
            "shopping",
            "loja",
            "store",
            "cart",
            "carrinho",
            "checkout",
            "finalizar",
            "order",
            "pedido",
            "dp/",
            "gp/product/",
            "product/",
            "produto/",
            "item/",
            "buy/",
            "comprar/",
            "p/",
            "producto/",
            "articulo/",
            "compra/",
            "tienda/",
            "carrito/",
            "amzn.to",
            "amzn.com",
            "bit.ly",
            "tinyurl.com",
            "goo.gl",
            "t.co",
         ];

         // Verificar se a URL contém palavras-chave de produto
         const hasProductKeyword = productKeywords.some(
            (keyword) => pathname.includes(keyword) || searchParams.includes(keyword)
         );

         // Verificar se é um link encurtado (muitos links de produtos são encurtados)
         const isShortenedLink = ["amzn.to", "amzn.com", "bit.ly", "tinyurl.com", "goo.gl", "t.co"].some((domain) =>
            urlObj.hostname.includes(domain)
         );

         // Verificar se tem parâmetros típicos de e-commerce
         const hasEcommerceParams = ["ref=", "tag=", "camp=", "link=", "affiliate=", "partner="].some((param) =>
            searchParams.includes(param)
         );

         return hasProductKeyword || isShortenedLink || hasEcommerceParams;
      } catch {
         return false;
      }
   }

   /**
    * Normaliza URL para comparação
    */
   private normalizeUrl(url: string): string {
      try {
         const urlObj = new URL(url);
         return `${urlObj.hostname}${urlObj.pathname}`;
      } catch {
         return url;
      }
   }

   /**
    * Extrai nome do produto da URL
    */
   private extractProductNameFromUrl(url: string): string {
      try {
         const urlObj = new URL(url);
         const pathname = urlObj.pathname;

         // Para Amazon
         if (urlObj.hostname.includes("amazon")) {
            const match = pathname.match(/\/([^\/]+)(?:\/dp\/|\/gp\/product\/)([A-Z0-9]+)/);
            if (match) {
               return match[1].replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
            }
         }

         // Para Mercado Livre
         if (urlObj.hostname.includes("mercadolivre")) {
            const match = pathname.match(/\/([^\/]+)-([A-Z0-9]+)/);
            if (match) {
               return match[1].replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
            }
         }

         // Para outros sites
         const segments = pathname.split("/").filter((s) => s.length > 0);
         if (segments.length > 0) {
            const lastSegment = segments[segments.length - 1];
            return lastSegment.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
         }

         return "Produto";
      } catch {
         return "Produto";
      }
   }

   /**
    * Extrai plataforma da URL
    */
   private extractPlatformFromUrl(url: string): string {
      try {
         const hostname = new URL(url).hostname.toLowerCase();

         if (hostname.includes("amazon")) return "amazon";
         if (hostname.includes("mercadolivre")) return "mercadolivre";
         if (hostname.includes("magazineluiza") || hostname.includes("magalu")) return "magazineluiza";
         if (hostname.includes("americanas") || hostname.includes("submarino")) return "americanas";
         if (hostname.includes("casasbahia")) return "casasbahia";
         if (hostname.includes("extra")) return "extra";
         if (hostname.includes("pontofrio")) return "pontofrio";
         if (hostname.includes("shopee")) return "shopee";
         if (hostname.includes("aliexpress")) return "aliexpress";
         if (hostname.includes("shein")) return "shein";
         if (hostname.includes("netshoes")) return "netshoes";
         if (hostname.includes("dafiti")) return "dafiti";
         if (hostname.includes("zattini")) return "zattini";
         if (hostname.includes("walmart")) return "walmart";
         if (hostname.includes("carrefour")) return "carrefour";
         if (hostname.includes("hotmart") || hostname.includes("eduzz") || hostname.includes("monetizze"))
            return "affiliate";

         return "other";
      } catch {
         return "other";
      }
   }

   /**
    * Procura ou cria exatamente 10 tags com categorias obrigatórias e retorna apenas seus IDs
    * Obrigatório ter: 1 tag de marca, 2 tags de cor, 1 tag de segmento, as demais conforme conteúdo
    */
   private async findOrCreateExactly10TagIds(suggestedTags: string[] = []): Promise<number[]> {
      const tagIds: number[] = [];

      // Tags padrão com categorias específicas para vídeos
      const defaultTagsWithCategories = [
         { name: "Vídeo", category: "Tipo de Conteúdo" },
         { name: "Conteúdo", category: "Tipo de Conteúdo" },
         { name: "Digital", category: "Tecnologia" },
         { name: "Mídia", category: "Tipo de Conteúdo" },
         { name: "Social", category: "Plataformas" },
         { name: "Premium", category: "Marca" },
         { name: "Azul", category: "Cores e Paletas" },
         { name: "Branco", category: "Cores e Paletas" },
         { name: "Tecnologia", category: "Segmento" },
         { name: "Inovação", category: "Especialidades" },
      ];

      // Garantir que temos exatamente 10 tags
      const tagsToProcess = [...suggestedTags];
      while (tagsToProcess.length < 10) {
         const nextTag = defaultTagsWithCategories[tagsToProcess.length % defaultTagsWithCategories.length];
         if (!tagsToProcess.includes(nextTag.name)) {
            tagsToProcess.push(nextTag.name);
         } else {
            tagsToProcess.push(`${nextTag.name}_${Math.floor(Math.random() * 1000)}`);
         }
      }

      if (tagsToProcess.length > 10) {
         tagsToProcess.splice(10);
      }

      console.info("🔄 [Extractor]: Processing exactly 10 tags with categories:", tagsToProcess);

      // Procurar ou criar cada tag com categoria
      for (let i = 0; i < tagsToProcess.length; i++) {
         const tagName = tagsToProcess[i];
         try {
            // Procurar tag existente
            let tag = await this.prismaClient.tag.findFirst({
               where: { name: tagName },
               include: { category: true },
            });

            if (!tag) {
               // Determinar categoria para a tag
               const categoryName = this.determineTagCategory(tagName, i, defaultTagsWithCategories);

               // Procurar ou criar categoria
               let category = await this.prismaClient.tagCategory.findFirst({
                  where: { name: categoryName },
               });

               if (!category) {
                  category = await this.prismaClient.tagCategory.create({
                     data: { name: categoryName },
                  });
                  console.info(`✅ [Extractor]: New category created: ${categoryName}, ID: ${category.id}`);
               }

               // Criar tag com categoria
               tag = await this.prismaClient.tag.create({
                  data: {
                     name: tagName,
                     categoryId: category.id,
                  },
                  include: { category: true },
               });
               console.info(`✅ [Extractor]: New tag created: ${tagName}, ID: ${tag.id}, Category: ${categoryName}`);
            } else {
               console.info(
                  `🔄 [Extractor]: Existing tag found: ${tagName}, ID: ${tag.id}, Category: ${
                     tag.category?.name || "Sem categoria"
                  }`
               );
            }

            tagIds.push(tag.id);
         } catch (error) {
            console.error(`❌ [Extractor]: Error processing tag "${tagName}":`, error);

            // Fallback para tag genérica com categoria
            try {
               const fallbackCategory =
                  (await this.prismaClient.tagCategory.findFirst({
                     where: { name: "Geral" },
                  })) ||
                  (await this.prismaClient.tagCategory.create({
                     data: { name: "Geral" },
                  }));

               const fallbackTag = await this.prismaClient.tag.create({
                  data: {
                     name: `Tag_${Math.floor(Math.random() * 10000)}`,
                     categoryId: fallbackCategory.id,
                  },
               });
               tagIds.push(fallbackTag.id);
            } catch (fallbackError) {
               console.error("❌ [Extractor]: Critical error creating fallback tag:", fallbackError);
            }
         }
      }

      console.info(`✅ [Extractor]: 10 tags created/found successfully with categories: ${tagIds.join(", ")}`);
      return tagIds;
   }

   /**
    * Determina a categoria apropriada para uma tag
    */
   private determineTagCategory(tagName: string, index: number, defaultTags: any[]): string {
      // Mapeamento de tags para categorias
      const tagCategoryMapping: { [key: string]: string } = {
         // Tipo de Conteúdo
         Vídeo: "Tipo de Conteúdo",
         Conteúdo: "Tipo de Conteúdo",
         Mídia: "Tipo de Conteúdo",
         Tutorial: "Tipo de Conteúdo",
         Review: "Tipo de Conteúdo",
         Unboxing: "Tipo de Conteúdo",
         Vlog: "Tipo de Conteúdo",
         Podcast: "Tipo de Conteúdo",
         Live: "Tipo de Conteúdo",
         Story: "Tipo de Conteúdo",
         Reel: "Tipo de Conteúdo",

         // Tecnologia
         Digital: "Tecnologia",
         Tecnologia: "Tecnologia",
         Gadget: "Tecnologia",
         Eletrônico: "Tecnologia",
         Smartphone: "Tecnologia",
         Computador: "Tecnologia",
         Software: "Tecnologia",
         App: "Tecnologia",

         // Plataformas
         Social: "Plataformas",
         YouTube: "Plataformas",
         Instagram: "Plataformas",
         TikTok: "Plataformas",
         Facebook: "Plataformas",
         Twitter: "Plataformas",
         LinkedIn: "Plataformas",

         // Marca (obrigatório)
         Premium: "Marca",
         "Marca Própria": "Marca",
         "Marca Nacional": "Marca",
         "Marca Internacional": "Marca",
         "Marca Local": "Marca",
         "Marca Regional": "Marca",
         "Marca Independente": "Marca",
         "Marca Autoral": "Marca",
         "Marca Digital": "Marca",
         "Marca Física": "Marca",
         "Marca Virtual": "Marca",
         "Marca Popular": "Marca",
         "Marca Especializada": "Marca",
         "Marca Multinacional": "Marca",
         "Marca Exclusiva": "Marca",
         "Marca Oficial": "Marca",
         "Marca Sustentável": "Marca",
         "Marca Flexível": "Marca",
         "Marca Dedicada": "Marca",
         "Marca Industrial": "Marca",
         "Marca Séria": "Marca",
         "Marca Artesanal": "Marca",
         "Marca Modular": "Marca",
         "Marca Terceirizada": "Marca",

         // Cores e Paletas (obrigatório - 2 tags)
         Azul: "Cores e Paletas",
         Branco: "Cores e Paletas",
         Preto: "Cores e Paletas",
         Vermelho: "Cores e Paletas",
         Verde: "Cores e Paletas",
         Amarelo: "Cores e Paletas",
         Rosa: "Cores e Paletas",
         Roxo: "Cores e Paletas",
         Laranja: "Cores e Paletas",
         Cinza: "Cores e Paletas",
         Marrom: "Cores e Paletas",
         Bege: "Cores e Paletas",
         Dourado: "Cores e Paletas",
         Prateado: "Cores e Paletas",
         Transparente: "Cores e Paletas",
         "Azul Marinho": "Cores e Paletas",
         "Azul Claro": "Cores e Paletas",
         "Azul Escuro": "Cores e Paletas",
         "Verde Escuro": "Cores e Paletas",
         "Verde Claro": "Cores e Paletas",
         "Vermelho Escuro": "Cores e Paletas",
         "Vermelho Claro": "Cores e Paletas",
         "Rosa Claro": "Cores e Paletas",
         "Rosa Escuro": "Cores e Paletas",
         "Roxo Claro": "Cores e Paletas",
         "Roxo Escuro": "Cores e Paletas",
         "Laranja Claro": "Cores e Paletas",
         "Laranja Escuro": "Cores e Paletas",
         "Cinza Claro": "Cores e Paletas",
         "Cinza Escuro": "Cores e Paletas",
         "Marrom Claro": "Cores e Paletas",
         "Marrom Escuro": "Cores e Paletas",
         "Bege Claro": "Cores e Paletas",
         "Bege Escuro": "Cores e Paletas",

         // Segmento (obrigatório)
         "Tecnologia Digital": "Segmento",
         Moda: "Segmento",
         Beleza: "Segmento",
         Saúde: "Segmento",
         Gastronomia: "Segmento",
         Turismo: "Segmento",
         Lifestyle: "Segmento",
         Jogos: "Segmento",
         Educação: "Segmento",
         Negócios: "Segmento",
         Empreendedorismo: "Segmento",
         Arte: "Segmento",
         Cultura: "Segmento",
         Música: "Segmento",
         Cinema: "Segmento",
         Esportes: "Segmento",
         Automóveis: "Segmento",
         Pets: "Segmento",
         Decoração: "Segmento",
         Arquitetura: "Segmento",
         Família: "Segmento",
         Finanças: "Segmento",
         Investimentos: "Segmento",
         Produtividade: "Segmento",
         "Desenvolvimento Pessoal": "Segmento",
         "Bem-estar": "Segmento",
         Sustentabilidade: "Segmento",
         Comédia: "Segmento",
         Humor: "Segmento",
         // Público-Alvo
         Adolescentes: "Público-Alvo",
         Jovens: "Público-Alvo",
         Adultos: "Público-Alvo",
         Pais: "Público-Alvo",
         Mães: "Público-Alvo",
         Profissionais: "Público-Alvo",
         Estudantes: "Público-Alvo",
         Empreendedores: "Público-Alvo",
         Executivos: "Público-Alvo",
         Freelancers: "Público-Alvo",
         Idosos: "Público-Alvo",
         Crianças: "Público-Alvo",
         Mulheres: "Público-Alvo",
         Homens: "Público-Alvo",
         Casais: "Público-Alvo",
         Universitários: "Público-Alvo",

         // Especialidades
         Fotografia: "Especialidades",
         "Edição de Vídeo": "Especialidades",
         Copywriting: "Especialidades",
         "Marketing Digital": "Especialidades",
         Design: "Especialidades",
         "Estratégia de Conteúdo": "Especialidades",
         Analytics: "Especialidades",
         SEO: "Especialidades",
         SEM: "Especialidades",
         "Social Media": "Especialidades",
         "Redes Sociais": "Especialidades",
         "Produção de Vídeo": "Especialidades",
         "Edição de Imagem": "Especialidades",
         Ilustração: "Especialidades",
         Animação: "Especialidades",
         "Web Design": "Especialidades",
         "UI/UX": "Especialidades",
         Programação: "Especialidades",
         Desenvolvimento: "Especialidades",
         Consultoria: "Especialidades",
         Mentoria: "Especialidades",
         Coaching: "Especialidades",
         Treinamento: "Especialidades",
         Palestras: "Especialidades",
         Workshops: "Especialidades",
         Cursos: "Especialidades",
         "E-books": "Especialidades",
         Streaming: "Especialidades",
         Gaming: "Especialidades",
         Cosplay: "Especialidades",
         Maquiagem: "Especialidades",
         Cabelo: "Especialidades",
         Skincare: "Especialidades",
         Fitness: "Especialidades",
         Nutrição: "Especialidades",
         Culinária: "Especialidades",
         Viagem: "Especialidades",
         "Fotografia de Viagem": "Especialidades",
         Videografia: "Especialidades",
         Drone: "Especialidades",
      };

      // Verificar se a tag tem categoria mapeada
      if (tagCategoryMapping[tagName]) {
         return tagCategoryMapping[tagName];
      }

      // Se não tem mapeamento, usar categoria padrão baseada no índice
      const defaultCategories = [
         "Tipo de Conteúdo",
         "Nicho de Atuação",
         "Tecnologia",
         "Plataformas",
         "Especialidades",
         "Marca",
         "Cores e Paletas",
         "Segmento",
      ];
      return defaultCategories[index % defaultCategories.length];
   }

   /**
    * Informações de fallback para vídeo quando IA falha
    */
   private getFallbackVideoInfo(videoLink: string, description?: string | null): any {
      return {
         title: this.extractTitleFromUrl(videoLink),
         description: description || "Vídeo importado automaticamente",
         platform: this.extractVideoPlatformFromUrl(videoLink),
         thumbnail: null,
         duration: null,
         category: "Geral",
         tags: ["video", "importado", "automatico", "conteudo", "midia"],
         language: "pt-BR",
         author: "Desconhecido",
         price: 0,
         isEducational: false,
         targetAudience: "Geral",
         mainTopic: "Conteúdo de vídeo",
         hasProductMentions: false,
         contentType: "other",
      };
   }

   /**
    * Extrai título básico da URL como fallback
    */
   private extractTitleFromUrl(url: string): string {
      try {
         const urlObj = new URL(url);

         // Para YouTube
         if (urlObj.hostname.includes("youtube.com") || urlObj.hostname.includes("youtu.be")) {
            const videoId = urlObj.searchParams.get("v") || urlObj.pathname.split("/").pop();
            return `Vídeo do YouTube - ${videoId}`;
         }

         // Para Vimeo
         if (urlObj.hostname.includes("vimeo.com")) {
            const videoId = urlObj.pathname.split("/").pop();
            return `Vídeo do Vimeo - ${videoId}`;
         }

         // Para TikTok
         if (urlObj.hostname.includes("tiktok.com")) {
            return `Vídeo do TikTok`;
         }

         // Genérico
         return `Vídeo de ${urlObj.hostname}`;
      } catch (error) {
         return "Vídeo importado";
      }
   }

   /**
    * Extrai plataforma da URL (para vídeos)
    */
   private extractVideoPlatformFromUrl(url: string): string {
      try {
         const hostname = new URL(url).hostname.toLowerCase();

         if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "youtube";
         if (hostname.includes("vimeo.com")) return "vimeo";
         if (hostname.includes("tiktok.com")) return "tiktok";
         if (hostname.includes("instagram.com")) return "instagram";
         if (hostname.includes("facebook.com")) return "facebook";
         if (hostname.includes("twitch.tv")) return "twitch";

         return hostname;
      } catch (error) {
         return "unknown";
      }
   }

   /**
    * Método auxiliar para prompts livres
    */
   async freePrompt(prompt: string) {
      const startTime = new Date();
      const response = await this.openai.chat.completions.create({
         model: MODEL_SELECTED,
         messages: [
            {
               role: "system",
               content: prompt,
            },
         ],
         temperature: 0,
         max_tokens: 4000,
      });
      this.calculateCost(MODEL_SELECTED, startTime, response);
      this.getOpenAIStats();
      return response;
   }
}
