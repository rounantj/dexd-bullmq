import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";

interface ScrapedProductData {
   title: string;
   price: string;
   originalPrice?: string;
   images: string[];
   description?: string;
   seller?: string;
   url: string;
   platform: string;
   extractedAt: string;
}

export class EnhancedChineseScraper {
   private browser: any = null;

   constructor() {}

   /**
    * Inicializa o browser se necessário
    */
   private async initBrowser() {
      if (!this.browser) {
         try {
            try {
               puppeteer.use(StealthPlugin());
            } catch {}

            const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
            const args = [
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
            ];
            if (proxyUrl) {
               args.push(`--proxy-server=${proxyUrl}`);
            }

            this.browser = await puppeteer.launch({
               headless: true,
               args,
            } as any);
         } catch (error) {
            console.error("❌ [Enhanced Scraper]: Erro ao inicializar browser:", error);
            throw error;
         }
      }
      return this.browser;
   }

   /**
    * Fecha o browser
    */
   async closeBrowser() {
      if (this.browser) {
         await this.browser.close();
         this.browser = null;
      }
   }

   /**
    * Detecta a plataforma baseada na URL
    */
   private detectPlatform(url: string): "shopee" | "shein" | null {
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes("shopee.com")) return "shopee";
      if (lowerUrl.includes("shein.com")) return "shein";
      return null;
   }

   /**
    * Extrai dados de uma URL chinesa (Shopee ou Shein)
    */
   async extractProductData(url: string): Promise<ScrapedProductData | null> {
      const platform = this.detectPlatform(url);
      if (!platform) {
         console.error("❌ [Enhanced Scraper]: URL não suportada:", url);
         return null;
      }

      console.log(`🔍 [Enhanced Scraper]: Extraindo dados do ${platform}:`, url);

      let page: any = null;
      let browser: any = null;

      try {
         browser = await this.initBrowser();
         page = await browser.newPage();

         // Configurar página para evitar detecção
         await this.setupPage(page);

         // Navegar para a URL com configurações mais robustas
         await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
         });

         // Aguardar um pouco para garantir que a página carregou
         await new Promise((resolve) => setTimeout(resolve, 3000));

         // Verificar se a página ainda está válida
         if (page.isClosed()) {
            throw new Error("Página foi fechada durante o carregamento");
         }

         let productData: ScrapedProductData | null = null;

         if (platform === "shopee") {
            productData = await this.extractShopeeData(page, url);
         } else if (platform === "shein") {
            productData = await this.extractSheinData(page, url);
         }

         return productData;
      } catch (error) {
         console.error(`❌ [Enhanced Scraper]: Erro ao extrair dados do ${platform}:`, error);
         return null;
      } finally {
         // Sempre fechar a página, mesmo se houver erro
         if (page && !page.isClosed()) {
            try {
               await page.close();
            } catch (closeError) {
               console.warn("⚠️ [Enhanced Scraper]: Erro ao fechar página:", closeError);
            }
         }
      }
   }

   /**
    * Configura a página para evitar detecção de bot
    */
   private async setupPage(page: any) {
      try {
         // User agent realista
         await page.setUserAgent(this.randomUserAgent());

         // Viewport realista
         await page.setViewport({ width: 1366, height: 768 });

         // Adicionar headers extras
         await page.setExtraHTTPHeaders({
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
         });

         try {
            await page.evaluateOnNewDocument(() => {
               Object.defineProperty(navigator, "languages", { get: () => ["pt-BR", "pt", "en-US", "en"] });
               Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
            });
         } catch {}

         // Configurar timeout de navegação
         page.setDefaultNavigationTimeout(45000);
         page.setDefaultTimeout(30000);

         // Configurar listeners de erro para evitar crashes
         page.on("error", (err: any) => {
            console.warn("⚠️ [Enhanced Scraper]: Erro na página:", err.message);
         });

         page.on("pageerror", (err: any) => {
            console.warn("⚠️ [Enhanced Scraper]: Erro JavaScript na página:", err.message);
         });

         // Listener para quando a página é fechada
         page.on("close", () => {
            console.warn("⚠️ [Enhanced Scraper]: Página foi fechada");
         });

         // Listener para quando a página é redirecionada
         page.on("framenavigated", (frame: any) => {
            if (frame === page.mainFrame()) {
               console.log("🔄 [Enhanced Scraper]: Página foi redirecionada para:", frame.url());
            }
         });

         // Interceptar requisições para melhorar performance (opcional)
         try {
            await page.setRequestInterception(true);
            page.on("request", (req: any) => {
               const resourceType = req.resourceType();
               // Permitir imagens, mas bloquear CSS e fontes para performance
               if (["stylesheet", "font"].includes(resourceType)) {
                  req.abort();
               } else {
                  req.continue();
               }
            });
         } catch (interceptError) {
            console.warn(
               "⚠️ [Enhanced Scraper]: Não foi possível configurar interceptação de requisições:",
               interceptError
            );
         }
      } catch (error) {
         console.warn("⚠️ [Enhanced Scraper]: Erro ao configurar página:", error);
         // Continuar mesmo com erro na configuração
      }
   }

   /**
    * Aguarda elementos específicos carregarem na página
    */
   private async waitForElements(page: any, selectors: string[], timeout: number = 15000): Promise<string[]> {
      const foundSelectors: string[] = [];

      for (const selector of selectors) {
         try {
            // Verificar se a página ainda está válida antes de tentar
            if (page.isClosed()) {
               console.log("⚠️ [Enhanced Scraper]: Página foi fechada durante a busca por elementos");
               return foundSelectors;
            }

            await page.waitForSelector(selector, { timeout });
            foundSelectors.push(selector);
            console.log(`✅ [Enhanced Scraper]: Elemento encontrado: ${selector}`);
         } catch (error) {
            console.log(`⚠️ [Enhanced Scraper]: Elemento não encontrado: ${selector}`);
         }
      }

      // Se não encontrou nenhum elemento, aguardar um pouco mais e tentar novamente
      if (foundSelectors.length === 0) {
         console.log("⚠️ [Enhanced Scraper]: Nenhum elemento encontrado, aguardando mais tempo...");
         await new Promise((resolve) => setTimeout(resolve, 3000));

         // Verificar se a página ainda está válida
         if (page.isClosed()) {
            console.log("⚠️ [Enhanced Scraper]: Página foi fechada durante a espera");
            return foundSelectors;
         }

         // Tentar novamente com timeout menor
         for (const selector of selectors) {
            try {
               await page.waitForSelector(selector, { timeout: 5000 });
               foundSelectors.push(selector);
               console.log(`✅ [Enhanced Scraper]: Elemento encontrado na segunda tentativa: ${selector}`);
               break; // Se encontrou pelo menos um, para
            } catch (error) {
               console.log(`⚠️ [Enhanced Scraper]: Elemento não encontrado na segunda tentativa: ${selector}`);
            }
         }
      }

      // Se ainda não encontrou nenhum, retornar vazio mas não falhar
      if (foundSelectors.length === 0) {
         console.log("⚠️ [Enhanced Scraper]: Nenhum elemento encontrado após todas as tentativas, continuando...");
      }

      return foundSelectors;
   }

   /**
    * Extrai dados do Shopee
    */
   private async extractShopeeData(page: any, url: string): Promise<ScrapedProductData> {
      console.log("🛍️ [Enhanced Scraper]: Extraindo dados do Shopee...");

      try {
         // Verificar se a página ainda está válida
         if (page.isClosed()) {
            throw new Error("Página foi fechada antes da extração");
         }

         // Aguardar elementos críticos carregarem
         const titleSelectors = [
            'h1[class*="title"]',
            ".shopee-product-info__header__title",
            '[data-testid="product-title"]',
            "h1",
            '[class*="product-title"]',
            '[class*="item-title"]',
            ".product-title",
         ];

         const priceSelectors = [
            'div[class*="price-current"]',
            ".shopee-product-info__header__price--current",
            '[data-testid="price-current"]',
            ".current-price",
            '[class*="current-price"]',
            '[class*="price"]',
            ".price",
         ];

         const imageSelectors = [
            ".shopee-product-info__image img",
            '[class*="gallery"] img',
            '[data-testid="product-image"]',
            'img[class*="image"]',
            ".product-image img",
            'img[src*="shopee"]',
         ];

         // Aguardar pelo menos um elemento de cada tipo
         await this.waitForElements(page, titleSelectors);
         await this.waitForElements(page, priceSelectors);
         await this.waitForElements(page, imageSelectors);

         // Aguardar mais tempo para garantir carregamento completo
         await new Promise((resolve) => setTimeout(resolve, 3000));

         // Verificar novamente se a página ainda está válida
         if (page.isClosed()) {
            throw new Error("Página foi fechada durante a espera");
         }

         // Tentar extrair dados via JavaScript na página
         const productData = await page.evaluate(() => {
            const data: any = {};

            // Extrair título
            const titleElement = document.querySelector(
               'h1[class*="title"], .shopee-product-info__header__title, [data-testid="product-title"], h1, [class*="product-title"], [class*="item-title"], .product-title'
            );
            data.title = titleElement ? titleElement.textContent?.trim() : "";

            // Extrair preço atual
            const priceElement = document.querySelector(
               'div[class*="price-current"], .shopee-product-info__header__price--current, [data-testid="price-current"], .current-price, [class*="current-price"], [class*="price"], .price'
            );
            data.currentPrice = priceElement ? priceElement.textContent?.trim() : "";

            // Extrair preço original
            const originalPriceElement = document.querySelector(
               'div[class*="price-original"], .shopee-product-info__header__price--original, [data-testid="price-original"], .original-price'
            );
            data.originalPrice = originalPriceElement ? originalPriceElement.textContent?.trim() : "";

            // Extrair vendedor
            const sellerElement = document.querySelector(
               'div[class*="seller-name"], .shopee-seller-info__name, [data-testid="seller-name"], [class*="shop-name"], [class*="seller"]'
            );
            data.seller = sellerElement ? sellerElement.textContent?.trim() : "";

            // Extrair descrição
            const descElement = document.querySelector(
               'div[class*="description"], .shopee-product-info__description, [data-testid="product-description"], [class*="product-description"]'
            );
            data.description = descElement ? descElement.textContent?.trim() : "";

            // Extrair imagens
            const imageElements = document.querySelectorAll(
               '.shopee-product-info__image img, [class*="gallery"] img, [data-testid="product-image"], img[class*="image"], .product-image img, img[src*="shopee"]'
            );
            data.images = Array.from(imageElements)
               .map((img: any) => {
                  const src = img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy");
                  return src ? src : "";
               })
               .filter((src) => src && src.includes("http"));

            return data;
         });

         // Se não conseguiu extrair via JavaScript, tentar via HTML
         if (!productData.title || !productData.currentPrice) {
            console.log("⚠️ [Enhanced Scraper]: Dados insuficientes via JavaScript, tentando HTML...");

            // Verificar se a página ainda está válida antes de tentar extrair HTML
            if (page.isClosed()) {
               throw new Error("Página foi fechada antes de extrair HTML");
            }

            const html = await page.content();
            const $ = cheerio.load(html);

            return this.extractFromHTML($, url, "shopee");
         }

         return {
            title: productData.title || "Produto Shopee",
            price: this.normalizePrice(productData.currentPrice),
            originalPrice: productData.originalPrice ? this.normalizePrice(productData.originalPrice) : undefined,
            images: productData.images.slice(0, 10),
            description: productData.description || "Descrição não disponível",
            seller: productData.seller || "Shopee Seller",
            url: url,
            platform: "shopee",
            extractedAt: new Date().toISOString(),
         };
      } catch (error) {
         console.error("❌ [Enhanced Scraper]: Erro ao extrair dados do Shopee:", error);

         // Fallback: tentar extrair via HTML mesmo com erro
         try {
            // Verificar se a página ainda está válida antes de tentar extrair HTML
            if (!page.isClosed()) {
               const html = await page.content();
               const $ = cheerio.load(html);
               return this.extractFromHTML($, url, "shopee");
            } else {
               console.error("❌ [Enhanced Scraper]: Página foi fechada, não é possível extrair HTML");
               throw error; // Re-throw o erro original
            }
         } catch (htmlError) {
            console.error("❌ [Enhanced Scraper]: Erro também no fallback HTML:", htmlError);
            throw error; // Re-throw o erro original
         }
      }
   }

   /**
    * Extrai dados do Shein
    */
   private async extractSheinData(page: any, url: string): Promise<ScrapedProductData> {
      console.log("👗 [Enhanced Scraper]: Extraindo dados do Shein...");

      try {
         // Verificar se a página ainda está válida
         if (page.isClosed()) {
            throw new Error("Página foi fechada antes da extração");
         }

         // Aguardar elementos críticos carregarem
         const titleSelectors = [
            'h1[class*="title"]',
            ".product-title",
            '[data-testid="product-title"]',
            "h1",
            '[class*="product-name"]',
            '[class*="goods-name"]',
            ".goods-name",
         ];

         const priceSelectors = [
            'div[class*="price"]',
            ".product-price",
            '[data-testid="price"]',
            ".current-price",
            '[class*="current-price"]',
            '[class*="sale-price"]',
            ".sale-price",
         ];

         const imageSelectors = [
            ".product-gallery img",
            '[class*="gallery"] img',
            '[data-testid="product-image"]',
            'img[class*="image"]',
            ".product-image img",
            'img[src*="shein"]',
         ];

         // Aguardar pelo menos um elemento de cada tipo
         await this.waitForElements(page, titleSelectors);
         await this.waitForElements(page, priceSelectors);
         await this.waitForElements(page, imageSelectors);

         // Aguardar mais tempo para garantir carregamento completo
         await new Promise((resolve) => setTimeout(resolve, 3000));

         // Verificar novamente se a página ainda está válida
         if (page.isClosed()) {
            throw new Error("Página foi fechada durante a espera");
         }

         // Tentar extrair dados via JavaScript na página
         const productData = await page.evaluate(() => {
            const data: any = {};

            // Extrair título
            const titleElement = document.querySelector(
               'h1[class*="title"], .product-title, [data-testid="product-title"], h1, [class*="product-name"], [class*="goods-name"], .goods-name'
            );
            data.title = titleElement ? titleElement.textContent?.trim() : "";

            // Extrair preço atual
            const priceElement = document.querySelector(
               'div[class*="price"], .product-price, [data-testid="price"], .current-price, [class*="current-price"], [class*="sale-price"], .sale-price'
            );
            data.currentPrice = priceElement ? priceElement.textContent?.trim() : "";

            // Extrair preço original
            const originalPriceElement = document.querySelector(
               'div[class*="original-price"], .original-price, [data-testid="original-price"], [class*="retail-price"]'
            );
            data.originalPrice = originalPriceElement ? originalPriceElement.textContent?.trim() : "";

            // Extrair vendedor/marca
            const sellerElement = document.querySelector(
               'div[class*="seller"], .store-name, .brand-name, [class*="brand"], [class*="store"]'
            );
            data.seller = sellerElement ? sellerElement.textContent?.trim() : "";

            // Extrair descrição
            const descElement = document.querySelector(
               'div[class*="description"], .product-description, [data-testid="product-description"], [class*="goods-desc"]'
            );
            data.description = descElement ? descElement.textContent?.trim() : "";

            // Extrair imagens
            const imageElements = document.querySelectorAll(
               '.product-gallery img, [class*="gallery"] img, [data-testid="product-image"], img[class*="image"], .product-image img, img[src*="shein"]'
            );
            data.images = Array.from(imageElements)
               .map((img: any) => {
                  const src = img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy");
                  return src ? src : "";
               })
               .filter((src) => src && src.includes("http"));

            return data;
         });

         // Se não conseguiu extrair via JavaScript, tentar via HTML
         if (!productData.title || !productData.currentPrice) {
            console.log("⚠️ [Enhanced Scraper]: Dados insuficientes via JavaScript, tentando HTML...");

            // Verificar se a página ainda está válida antes de tentar extrair HTML
            if (page.isClosed()) {
               throw new Error("Página foi fechada antes de extrair HTML");
            }

            const html = await page.content();
            const $ = cheerio.load(html);

            return this.extractFromHTML($, url, "shein");
         }

         return {
            title: productData.title || "Produto Shein",
            price: this.normalizePrice(productData.currentPrice),
            originalPrice: productData.originalPrice ? this.normalizePrice(productData.originalPrice) : undefined,
            images: productData.images.slice(0, 10),
            description: productData.description || "Descrição não disponível",
            seller: productData.seller || "Shein",
            url: url,
            platform: "shein",
            extractedAt: new Date().toISOString(),
         };
      } catch (error) {
         console.error("❌ [Enhanced Scraper]: Erro ao extrair dados do Shein:", error);

         // Fallback: tentar extrair via HTML mesmo com erro
         try {
            // Verificar se a página ainda está válida antes de tentar extrair HTML
            if (!page.isClosed()) {
               const html = await page.content();
               const $ = cheerio.load(html);
               return this.extractFromHTML($, url, "shein");
            } else {
               console.error("❌ [Enhanced Scraper]: Página foi fechada, não é possível extrair HTML");
               throw error; // Re-throw o erro original
            }
         } catch (htmlError) {
            console.error("❌ [Enhanced Scraper]: Erro também no fallback HTML:", htmlError);
            throw error; // Re-throw o erro original
         }
      }
   }

   /**
    * Extrai dados do HTML como fallback
    */
   private extractFromHTML($: cheerio.CheerioAPI, url: string, platform: string): ScrapedProductData {
      console.log(`🔄 [Enhanced Scraper]: Extraindo dados via HTML para ${platform}...`);

      // Seletores específicos por plataforma
      const selectors =
         platform === "shopee"
            ? {
                 title: [
                    'h1[class*="title"]',
                    ".shopee-product-info__header__title",
                    '[data-testid="product-title"]',
                    "h1",
                 ],
                 price: [
                    'div[class*="price-current"]',
                    ".shopee-product-info__header__price--current",
                    '[data-testid="price-current"]',
                    ".current-price",
                 ],
                 originalPrice: [
                    'div[class*="price-original"]',
                    ".shopee-product-info__header__price--original",
                    '[data-testid="price-original"]',
                    ".original-price",
                 ],
                 images: [
                    ".shopee-product-info__image img",
                    '[class*="gallery"] img',
                    '[data-testid="product-image"]',
                    'img[class*="image"]',
                 ],
                 seller: ['div[class*="seller-name"]', ".shopee-seller-info__name", '[data-testid="seller-name"]'],
                 description: [
                    'div[class*="description"]',
                    ".shopee-product-info__description",
                    '[data-testid="product-description"]',
                 ],
              }
            : {
                 title: ['h1[class*="title"]', ".product-title", '[data-testid="product-title"]', "h1"],
                 price: ['div[class*="price"]', ".product-price", '[data-testid="price"]', ".current-price"],
                 originalPrice: ['div[class*="original-price"]', ".original-price", '[data-testid="original-price"]'],
                 images: [
                    ".product-gallery img",
                    '[class*="gallery"] img',
                    '[data-testid="product-image"]',
                    'img[class*="image"]',
                 ],
                 seller: ['div[class*="seller"]', ".store-name", ".brand-name", '[class*="brand"]'],
                 description: [
                    'div[class*="description"]',
                    ".product-description",
                    '[data-testid="product-description"]',
                 ],
              };

      // Extrair dados usando os seletores
      const title = this.extractTextFromSelectors($, selectors.title);
      const price = this.extractTextFromSelectors($, selectors.price);
      const originalPrice = this.extractTextFromSelectors($, selectors.originalPrice);
      const seller = this.extractTextFromSelectors($, selectors.seller);
      const description = this.extractTextFromSelectors($, selectors.description);
      const images = this.extractImagesFromSelectors($, selectors.images);

      return {
         title: title || `Produto ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
         price: this.normalizePrice(price),
         originalPrice: originalPrice ? this.normalizePrice(originalPrice) : undefined,
         images: images.slice(0, 10),
         description: description || "Descrição não disponível",
         seller: seller || (platform === "shopee" ? "Shopee Seller" : "Shein"),
         url: url,
         platform: platform,
         extractedAt: new Date().toISOString(),
      };
   }

   /**
    * Extrai texto de múltiplos seletores
    */
   private extractTextFromSelectors($: cheerio.CheerioAPI, selectors: string[]): string {
      for (const selector of selectors) {
         try {
            const element = $(selector).first();
            if (element.length > 0) {
               const text = element.text().trim();
               if (text) {
                  return text;
               }
            }
         } catch (error) {
            console.warn(`⚠️ [Enhanced Scraper]: Erro com seletor "${selector}":`, error);
         }
      }
      return "";
   }

   /**
    * Extrai imagens de múltiplos seletores
    */
   private extractImagesFromSelectors($: cheerio.CheerioAPI, selectors: string[]): string[] {
      const images: string[] = [];

      for (const selector of selectors) {
         try {
            $(selector).each((i, elem) => {
               const $elem = $(elem);
               const src = $elem.attr("src") || $elem.attr("data-src") || $elem.attr("data-lazy");

               if (src && src.includes("http") && !src.includes("logo") && !src.includes("icon")) {
                  // Converter URLs relativas em absolutas
                  let fullUrl = src;
                  if (src.startsWith("//")) {
                     fullUrl = `https:${src}`;
                  } else if (src.startsWith("/")) {
                     fullUrl = `https://${new URL($.root().prop("baseURI") || "https://example.com").hostname}${src}`;
                  }

                  if (!images.includes(fullUrl)) {
                     images.push(fullUrl);
                  }
               }
            });

            if (images.length > 0) break;
         } catch (error) {
            console.warn(`⚠️ [Enhanced Scraper]: Erro extraindo imagens com seletor "${selector}":`, error);
         }
      }

      return images;
   }

   /**
    * Normaliza preços para formato padrão
    */
   private normalizePrice(price: string): string {
      if (!price) return "Preço não disponível";

      // Remove símbolos de moeda e espaços extras
      const cleaned = price.replace(/[^\d,.]/g, "").trim();

      if (!cleaned) return "Preço não disponível";

      // Detectar formato brasileiro (1.234,56)
      if (cleaned.includes(",") && cleaned.includes(".")) {
         const normalized = cleaned.replace(/\./g, "").replace(",", ".");
         return `R$ ${parseFloat(normalized).toFixed(2).replace(".", ",")}`;
      }

      // Detectar formato com vírgula decimal (1234,56)
      if (cleaned.includes(",") && !cleaned.includes(".")) {
         const normalized = cleaned.replace(",", ".");
         return `R$ ${parseFloat(normalized).toFixed(2).replace(".", ",")}`;
      }

      // Formato americano (1234.56)
      return `R$ ${parseFloat(cleaned).toFixed(2).replace(".", ",")}`;
   }

   private randomUserAgent(): string {
      const agents = [
         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
         "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
         "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
      ];
      return agents[Math.floor(Math.random() * agents.length)];
   }
}
