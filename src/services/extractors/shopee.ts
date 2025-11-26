import puppeteer from "puppeteer";
import * as cheerio from "cheerio";

export class ShopeeScraperBackend {
   public async fetchPageHtmlWithWait(url: string) {
      const browser = await puppeteer.launch({
         headless: true,
         args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
         ],
      });

      const page: any = await browser.newPage();

      // Variáveis para captura de HTML
      let capturedHtml: string | null = null;
      let pageClosed = false;
      let captureInterval: NodeJS.Timeout | null = null;

      try {
         // Configurar user agent para evitar detecção de bot
         await page.setUserAgent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
         );

         await page.setViewport({ width: 1366, height: 768 });

         // Configurar headers extras
         await page.setExtraHTTPHeaders({
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
         });

         // Configurar timeout de navegação
         page.setDefaultNavigationTimeout(45000);
         page.setDefaultTimeout(30000);

         // Configurar listeners de erro para evitar crashes
         page.on("error", (err: any) => {
            console.warn("⚠️ [Shopee Scraper]: Erro na página:", err.message);
         });

         page.on("pageerror", (err: any) => {
            console.warn("⚠️ [Shopee Scraper]: Erro JavaScript na página:", err.message);
         });

         // Listener para quando a página é fechada
         page.on("close", () => {
            console.warn("⚠️ [Shopee Scraper]: Página foi fechada");
            pageClosed = true;
         });

         page.on("close", () => {
            console.warn("⚠️ [Shopee Scraper]: Página foi fechada");
            pageClosed = true;
         });

         // Capturar HTML periodicamente para ter um backup
         captureInterval = setInterval(async () => {
            try {
               if (!pageClosed && !page.isClosed()) {
                  capturedHtml = await page.content();
                  console.log("📸 [Shopee Scraper]: HTML capturado periodicamente");
               }
            } catch (error) {
               console.warn("⚠️ [Shopee Scraper]: Erro ao capturar HTML periodicamente:", error);
            }
         }, 2000);

         page.on("framenavigated", async (frame: any) => {
            if (frame === page.mainFrame()) {
               console.log("🔄 [Shopee Scraper]: Página foi redirecionada para:", frame.url());
               try {
                  // Tentar capturar HTML antes que a página seja fechada
                  if (!pageClosed && !page.isClosed()) {
                     await new Promise((resolve) => setTimeout(resolve, 1000));
                     if (!pageClosed && !page.isClosed()) {
                        capturedHtml = await page.content();
                        console.log("✅ [Shopee Scraper]: HTML capturado durante redirecionamento");
                     }
                  }
               } catch (error) {
                  console.warn("⚠️ [Shopee Scraper]: Erro ao capturar HTML durante redirecionamento:", error);
               }
            }
         });

         // Navegar para a página com configurações mais robustas
         await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
         });

         // Capturar HTML imediatamente após o carregamento
         try {
            capturedHtml = await page.content();
            console.log("✅ [Shopee Scraper]: HTML capturado imediatamente após carregamento");
         } catch (error) {
            console.warn("⚠️ [Shopee Scraper]: Erro ao capturar HTML imediatamente:", error);
         }

         // Aguardar um pouco para garantir que a página carregou
         await new Promise((resolve) => setTimeout(resolve, 2000));

         // Verificar se a página ainda está válida
         if (page.isClosed()) {
            if (capturedHtml) {
               console.log("✅ [Shopee Scraper]: Usando HTML capturado imediatamente");
               return cheerio.load(capturedHtml);
            }
            throw new Error("Página foi fechada durante o carregamento");
         }

         // Tentar capturar HTML novamente após a espera
         try {
            const currentHtml = await page.content();
            if (currentHtml && capturedHtml && currentHtml.length > capturedHtml.length) {
               capturedHtml = currentHtml;
               console.log("✅ [Shopee Scraper]: HTML atualizado após espera");
            }
         } catch (error) {
            console.warn("⚠️ [Shopee Scraper]: Erro ao capturar HTML após espera:", error);
         }

         // Aguardar elementos específicos da Shopee carregarem (opcional)
         try {
            await this.waitForShopeeElements(page);
         } catch (error) {
            console.warn("⚠️ [Shopee Scraper]: Erro ao aguardar elementos:", error);
         }

         // Verificar novamente se a página ainda está válida
         if (page.isClosed()) {
            if (capturedHtml) {
               console.log("✅ [Shopee Scraper]: Usando HTML capturado como fallback");
               return cheerio.load(capturedHtml);
            }
            throw new Error("Página foi fechada durante a espera por elementos");
         }

         // Tentar capturar HTML final
         let html: string;
         try {
            html = await page.content();
            console.log("✅ [Shopee Scraper]: HTML final capturado com sucesso");
         } catch (error) {
            if (capturedHtml) {
               console.log("✅ [Shopee Scraper]: Usando HTML capturado como fallback");
               return cheerio.load(capturedHtml);
            }
            throw error;
         }
         await browser.close();

         // Limpar o intervalo de captura
         if (captureInterval) {
            clearInterval(captureInterval);
         }
         
         return cheerio.load(html);
      } catch (error) {
         // Limpar o intervalo de captura mesmo em caso de erro
         if (captureInterval) {
            clearInterval(captureInterval);
         }
         
         try {
            await browser.close();
         } catch (closeError) {
            console.warn("⚠️ [Shopee Scraper]: Erro ao fechar browser:", closeError);
         }
         throw error;
      }
   }

   public async waitForShopeeElements(page: any) {
      const selectors = [
         // Títulos possíveis
         'h1[class*="title"]',
         ".shopee-product-info__header__title",
         '[data-testid="product-title"]',
         "h1",
         '[class*="product-title"]',
         '[class*="item-title"]',
         ".product-title",

         // Preços possíveis
         'div[class*="price"]',
         ".shopee-product-info__header__price",
         '[data-testid="price"]',
         ".current-price",
         '[class*="current-price"]',
         '[class*="price"]',
         ".price",

         // Imagens possíveis
         ".shopee-product-info__image img",
         '[class*="gallery"] img',
         '[data-testid="product-image"]',
         'img[class*="image"]',
         ".product-image img",
         'img[src*="shopee"]',
      ];

      const foundSelectors: string[] = [];

      // Tentar aguardar qualquer um dos seletores aparecer
      for (const selector of selectors) {
         try {
            // Verificar se a página ainda está válida antes de tentar
            if (page.isClosed()) {
               console.log("⚠️ [Shopee Scraper]: Página foi fechada durante a busca por elementos");
               return foundSelectors;
            }
            
            await page.waitForSelector(selector, { timeout: 10000 });
            foundSelectors.push(selector);
            console.log(`✅ [Shopee Scraper]: Elemento encontrado: ${selector}`);
         } catch (error) {
            console.log(`⚠️ [Shopee Scraper]: Elemento não encontrado: ${selector}`);
         }
      }

      // Se não encontrou nenhum elemento, aguardar um pouco mais e tentar novamente
      if (foundSelectors.length === 0) {
         console.log("⚠️ [Shopee Scraper]: Nenhum elemento encontrado, aguardando mais tempo...");
         await new Promise((resolve) => setTimeout(resolve, 3000));

         // Verificar se a página ainda está válida
         if (page.isClosed()) {
            console.log("⚠️ [Shopee Scraper]: Página foi fechada durante a espera");
            return foundSelectors;
         }

         // Tentar novamente com timeout menor
         for (const selector of selectors) {
            try {
               await page.waitForSelector(selector, { timeout: 5000 });
               foundSelectors.push(selector);
               console.log(`✅ [Shopee Scraper]: Elemento encontrado na segunda tentativa: ${selector}`);
               break; // Se encontrou pelo menos um, para
            } catch (error) {
               console.log(`⚠️ [Shopee Scraper]: Elemento não encontrado na segunda tentativa: ${selector}`);
            }
         }
      }

      // Se ainda não encontrou nenhum, retornar vazio mas não falhar
      if (foundSelectors.length === 0) {
         console.log("⚠️ [Shopee Scraper]: Nenhum elemento encontrado após todas as tentativas, continuando...");
      }

      return foundSelectors;
   }

   public extractShopeeData($: cheerio.CheerioAPI, url: string): object {
      console.info("🌐 [Shopee Extractor]: Starting Shopee data extraction:", url);

      // Seletores baseados na estrutura real da Shopee
      const titleSelectors = [
         'h1[class*="title"]',
         ".shopee-product-info__header__title",
         '[data-testid="product-title"]',
         "h1",
         '[class*="product-title"]',
         '[class*="item-title"]',
         // Seletores mais genéricos como fallback
         "h1:first",
         ".title:first",
         '[class*="name"]:first',
      ];

      const priceSelectors = [
         // Preços atuais
         'div[class*="price-current"]',
         ".shopee-product-info__header__price--current",
         '[data-testid="price-current"]',
         ".current-price",
         '[class*="current-price"]',
         // Seletores mais genéricos
         ".price:first",
         '[class*="price"]:first',
         // Baseado no HTML que você mostrou, pode ter estruturas específicas
         '[class*="price"] span:first',
         '[class*="price"] div:first',
      ];

      const originalPriceSelectors = [
         'div[class*="price-original"]',
         ".shopee-product-info__header__price--original",
         '[data-testid="price-original"]',
         ".original-price",
         ".price--original",
         '[class*="original-price"]',
         '[class*="price"][class*="original"]',
      ];

      const imageSelectors = [
         ".shopee-product-info__image img",
         '[class*="gallery"] img',
         '[data-testid="product-image"]',
         'img[class*="image"]',
         ".product-image img",
         '[class*="product-gallery"] img',
         // Fallbacks mais genéricos
         'img[src*="shopee"]',
         "img:first",
      ];

      const sellerSelectors = [
         'div[class*="seller-name"]',
         ".shopee-seller-info__name",
         '[data-testid="seller-name"]',
         ".seller-info__name",
         '[class*="shop-name"]',
         '[class*="seller"]',
         // Fallbacks
         '[class*="store"] [class*="name"]',
         '[class*="merchant"] [class*="name"]',
      ];

      // Extrair dados usando múltiplos seletores
      const title = this.extractTextFromSelectors($, titleSelectors);
      const currentPrice = this.extractTextFromSelectors($, priceSelectors);
      const originalPrice = this.extractTextFromSelectors($, originalPriceSelectors);
      const seller = this.extractTextFromSelectors($, sellerSelectors) || "Shopee Seller";
      const description = this.extractDescription($);
      const images = this.extractImages($, imageSelectors);

      // Debug: mostrar o que foi encontrado
      console.info("📊 [Shopee Extractor]: Extracted data:", {
         title: title || "NOT FOUND",
         currentPrice: currentPrice || "NOT FOUND",
         originalPrice: originalPrice || "NOT FOUND",
         seller: seller,
         imagesCount: images.length,
         description: description.substring(0, 100) + "...",
      });

      // Normalizar preços
      const normalizedCurrentPrice = this.normalizePrice(currentPrice);
      const normalizedOriginalPrice = this.normalizePrice(originalPrice);

      const result = {
         url,
         platform: "shopee",
         title: title || "Título não encontrado",
         price: {
            current: normalizedCurrentPrice?.toString() || "0,00",
            original: normalizedOriginalPrice?.toString() || "0,00",
         },
         description,
         images,
         seller,
         extractedAt: new Date().toISOString(),
         // Debug info
         debug: {
            htmlLength: $.html().length,
            foundElements: {
               titles: titleSelectors.map((sel) => $(sel).length),
               prices: priceSelectors.map((sel) => $(sel).length),
               images: imageSelectors.map((sel) => $(sel).length),
            },
         },
      };

      console.info(
         `✅ [Shopee Extractor]: Extraction completed. Title: ${
            result.title !== "Título não encontrado" ? "✓" : "✗"
         }, ` +
            `Price: ${result.price.current !== "0,00" ? "✓" : "✗"}, ` +
            `Images: ${result.images.length}`
      );

      return result;
   }

   public extractTextFromSelectors($: cheerio.CheerioAPI, selectors: string[]): string {
      for (const selector of selectors) {
         try {
            const elements = $(selector);
            if (elements.length > 0) {
               const text = elements.first().text().trim();
               if (text) {
                  console.info(`✓ [Shopee Extractor]: Found with selector "${selector}": ${text.substring(0, 50)}...`);
                  return text;
               }
            }
         } catch (error) {
            console.warn(`✗ [Shopee Extractor]: Error with selector "${selector}": ${error}`);
         }
      }
      return "";
   }

   public extractDescription($: cheerio.CheerioAPI): string {
      const descriptionSelectors = [
         'div[class*="description"]',
         ".shopee-product-info__description",
         '[data-testid="product-description"]',
         ".product-detail__description",
         '[class*="product-description"]',
         '[class*="item-description"]',
         // Fallbacks
         '[class*="detail"]',
         '[class*="content"]',
      ];

      const description = this.extractTextFromSelectors($, descriptionSelectors);

      if (description) {
         return description;
      }

      // Fallback para meta description
      const metaDescription = $('meta[name="description"]').attr("content");
      if (metaDescription) {
         return metaDescription;
      }

      return "Descrição não encontrada";
   }

   public extractImages($: cheerio.CheerioAPI, selectors: string[]): string[] {
      const imageCandidates: Array<{ url: string; score: number; width?: number; height?: number }> = [];

      for (const selector of selectors) {
         try {
            $(selector).each((i: number, elem: any) => {
               const $elem = $(elem);
               const src =
                  $elem.attr("src") || $elem.attr("data-src") || $elem.attr("data-lazy") || $elem.attr("data-original");

               if (src) {
                  // Converter URLs relativas em absolutas se necessário
                  let fullUrl = src;
                  if (src.startsWith("//")) {
                     fullUrl = `https:${src}`;
                  } else if (src.startsWith("/")) {
                     fullUrl = `https://shopee.com.br${src}`;
                  } else if (!src.startsWith("http")) {
                     fullUrl = `https://${src}`;
                  }

                  // Extrair dimensões se disponíveis
                  const widthAttr = $elem.attr("width");
                  const heightAttr = $elem.attr("height");
                  const width = widthAttr ? parseInt(widthAttr) : undefined;
                  const height = heightAttr ? parseInt(heightAttr) : undefined;

                  // Calcular score baseado na qualidade
                  let score = 0;

                  // Priorizar imagens com dimensões conhecidas
                  if (width && height) {
                     const area = width * height;
                     if (area >= 800 * 600) score += 50; // Muito alta resolução
                     else if (area >= 600 * 400) score += 40; // Alta resolução
                     else if (area >= 400 * 300) score += 30; // Média resolução
                     else if (area >= 200 * 150) score += 20; // Baixa resolução
                     else score += 10; // Muito baixa resolução
                  } else {
                     score += 15; // Score base para imagens sem dimensões
                  }

                  // Priorizar URLs que indicam alta qualidade
                  const url = fullUrl.toLowerCase();
                  if (url.includes("high") || url.includes("hd") || url.includes("full")) score += 20;
                  if (url.includes("original") || url.includes("large")) score += 15;
                  if (url.includes("zoom") || url.includes("detail")) score += 10;
                  if (url.includes("1200") || url.includes("1000")) score += 25;
                  if (url.includes("800") || url.includes("600")) score += 20;

                  // Penalizar URLs que indicam baixa qualidade
                  if (url.includes("thumb") || url.includes("small") || url.includes("mini")) score -= 10;
                  if (url.includes("icon") || url.includes("logo")) score -= 20;

                  // Tentar obter versão de maior resolução
                  let highResUrl = fullUrl;
                  if (fullUrl.includes("/")) {
                     // Tentar diferentes padrões de alta resolução
                     const highResPatterns = [
                        fullUrl.replace(/\/\d+x\d+\//, "/1200x1200/"),
                        fullUrl.replace(/\/\d+x\d+\//, "/1000x1000/"),
                        fullUrl.replace(/\/\d+x\d+\//, "/800x800/"),
                        fullUrl.replace(/\/\d+x\d+\//, "/600x600/"),
                        fullUrl.replace(/\/\d+x\d+\//, "/original/"),
                        fullUrl.replace(/\/\d+x\d+\//, "/full/"),
                        fullUrl.replace(/\/\d+x\d+\//, "/high/"),
                     ];

                     // Usar o primeiro padrão que não seja igual ao original
                     const betterUrl = highResPatterns.find((pattern) => pattern !== fullUrl);
                     if (betterUrl) highResUrl = betterUrl;
                  }

                  imageCandidates.push({
                     url: highResUrl,
                     score,
                     width,
                     height,
                  });
               }
            });

            if (imageCandidates.length > 0) {
               console.info(
                  `✓ [Shopee Extractor]: ${imageCandidates.length} image candidates found with selector: ${selector}`
               );
               break; // Se encontrou imagens, pare
            }
         } catch (error) {
            console.warn(`✗ [Shopee Extractor]: Error extracting images with selector "${selector}": ${error}`);
         }
      }

      // Ordenar por score (maior para menor) e remover duplicatas
      const uniqueImages = imageCandidates
         .sort((a, b) => b.score - a.score)
         .filter((candidate, index, arr) => arr.findIndex((c) => c.url === candidate.url) === index);

      return uniqueImages.slice(0, 10).map((c) => c.url); // Máximo 10 imagens
   }

   public normalizePrice(price: string): number | null {
      if (!price) return null;

      // Remove tudo exceto números, vírgulas e pontos
      const cleaned = price.replace(/[^\d,\.]/g, "");

      if (!cleaned) return null;

      // Detectar se usa vírgula como separador decimal (formato brasileiro)
      if (cleaned.includes(",") && !cleaned.includes(".")) {
         return parseFloat(cleaned.replace(",", ".")) || null;
      }

      // Se tem tanto vírgula quanto ponto, assumir formato brasileiro (1.234,56)
      if (cleaned.includes(",") && cleaned.includes(".")) {
         return parseFloat(cleaned.replace(/\./g, "").replace(",", ".")) || null;
      }

      // Apenas ponto - formato americano
      return parseFloat(cleaned) || null;
   }

   // Método principal - USA APENAS Puppeteer + Cheerio
   async extractShopeeData2(url: string): Promise<object> {
      try {
         console.info(`🌐 [Shopee Extractor]: Starting scraping URL: ${url}`);

         // Aguardar página carregar completamente e extrair HTML renderizado
         const $ = await this.fetchPageHtmlWithWait(url);

         // Usar Cheerio para extrair dados do HTML já renderizado
         return this.extractShopeeData($, url);
      } catch (error) {
         console.error("❌ [Shopee Extractor]: Error in extraction:", error);
         throw new Error(`Failed to extract Shopee data: ${error}`);
      }
   }

   // Método para debug - salva HTML para análise
   async debugSaveHtml(url: string, filename: string = "shopee_debug.html"): Promise<void> {
      const browser = await puppeteer.launch({ headless: true });
      const page: any = await browser.newPage();

      try {
         await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
         );

         await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
         await page.waitForTimeout(5000);

         const html = await page.content();

         // Se estiver em ambiente Node.js, pode salvar o arquivo
         const fs = require("fs");
         fs.writeFileSync(filename, html, "utf8");

         console.info(`✅ [Shopee Extractor]: HTML saved to: ${filename}`);
         console.info(`📊 [Shopee Extractor]: HTML size: ${html.length} characters`);
      } catch (error) {
         console.error("❌ [Shopee Extractor]: Error saving HTML:", error);
      } finally {
         await browser.close();
      }
   }

   // Método para testar seletores específicos
   async testSelectors(url: string, selectors: string[]): Promise<any> {
      const browser = await puppeteer.launch({ headless: true });
      const page: any = await browser.newPage();

      try {
         await page.goto(url, { waitUntil: "networkidle0" });
         await page.waitForTimeout(5000);

         const html = await page.content();
         const $ = cheerio.load(html);

         const results: any = {};

         for (const selector of selectors) {
            const elements: any = $(selector);
            results[selector] = {
               count: elements.length,
               texts: elements.map((i: any, el: any) => $(el).text().trim().substring(0, 100)).get(),
               attributes: elements
                  .map((i: any, el: any) => {
                     const attrs: any = {};
                     if (el.attribs) {
                        Object.keys(el.attribs).forEach((attr) => {
                           attrs[attr] = el.attribs[attr];
                        });
                     }
                     return attrs;
                  })
                  .get(),
            };
         }

         return results;
      } finally {
         await browser.close();
      }
   }
}
