import { ImageExtractor } from "./extractors/unit-extractors/image-extractor";
import { OpenAITokenCounter } from "./extractors/token-counter";
import { PageHTMLFetcher } from "./extractors/unit-extractors/full-page";
import { ProductContentExtractor } from "./extractors/unit-extractors/product-extractor";

import { UrlResolver } from "./extractors/link-extractor";
import { YouTubeService } from "./extractors/unit-extractors/yt-services";
import { EnhancedChineseScraper } from "./extractors/enhanced-chinese-scraper";
import { ChineseStoresApiExtractor } from "./extractors/chinese-stores-api";

import ProductService from "../modules/product/product-service";
import UsageLimitsService from "../modules/billing/usage-limits-service";
import { User, UserSubscription, Subscription } from "@prisma/client";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import DexdTvVideoService from "../modules/dexdTvVideo/dexdTvVideo-service";
import { DexdTvVideoSavePayload } from "../modules/dexdTvVideo/dexdTvVideo-interfaces";
import { ExtractProductInfoUseCase } from "./extractors/extract-product-info.usecase";
import { parse } from "path";
import { autoCategorizeTag } from "../helpers/autoCategorizeTag";
import { intelligentTagCategorization, applyTagCategorization } from "../helpers/intelligentTagCategorization";

//const MODEL_SELECTED = "gpt-4o";
const MODEL_SELECTED = "gpt-4o-mini";

type CurrencyRates = {
   USD: number;
   EUR: number;
   GBP: number;
   [key: string]: number;
};

interface ApiResponse {
   success: boolean;
   timestamp: number;
   base: string;
   date: string;
   rates: {
      [key: string]: number;
   };
}
export class AffiliateLinkToProductService {
   private prismaClient;
   private readonly baseUrl = "https://api.exchangerate-api.com/v4/latest";
   private openai;
   private ytServices: YouTubeService;
   private readonly productService: ProductService;
   private readonly dexdTvVideosService: DexdTvVideoService;
   private readonly usageLimitsService: UsageLimitsService;
   private extractDataFromPage: PageHTMLFetcher;
   private extract: ExtractProductInfoUseCase;
   private tokenCounter: OpenAITokenCounter;
   private chineseStoresExtractor: ChineseStoresApiExtractor;
   private enhancedChineseScraper: EnhancedChineseScraper;
   private basicProductExtractor: ProductContentExtractor;

   constructor(prismaClient: any, openai: any) {
      this.prismaClient = prismaClient;
      this.ytServices = new YouTubeService();
      this.extractDataFromPage = new PageHTMLFetcher();
      this.productService = new ProductService(prismaClient);
      this.dexdTvVideosService = new DexdTvVideoService(prismaClient);
      this.usageLimitsService = new UsageLimitsService(prismaClient);
      this.tokenCounter = new OpenAITokenCounter();
      this.openai = openai;
      this.extract = new ExtractProductInfoUseCase(prismaClient, openai);
      this.chineseStoresExtractor = new ChineseStoresApiExtractor();
      this.enhancedChineseScraper = new EnhancedChineseScraper();
      this.basicProductExtractor = new ProductContentExtractor();
   }

   contarTokens(str: string): number {
      return this.tokenCounter.contarTokens(str);
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
      // PRIORIDADE 1: Se for YouTube, gerar thumbnail direta da URL
      if (videoLink && (videoLink.includes("youtube.com") || videoLink.includes("youtu.be"))) {
         const ytThumbnail = this.getYouTubeThumbnailFromUrl(videoLink);
         if (ytThumbnail) {
            console.info(`🖼️ [AffiliateLink]: YouTube thumbnail from URL: ${ytThumbnail}`);
            return ytThumbnail;
         }
      }

      if (!videoMetadata) return null;

      // YouTube retorna thumbnails como objeto com várias resoluções
      if (videoMetadata.thumbnails && typeof videoMetadata.thumbnails === "object") {
         const thumbnails = videoMetadata.thumbnails;
         if (thumbnails.maxres?.url) return thumbnails.maxres.url;
         if (thumbnails.high?.url) return thumbnails.high.url;
         if (thumbnails.standard?.url) return thumbnails.standard.url;
         if (thumbnails.medium?.url) return thumbnails.medium.url;
         if (thumbnails.default?.url) return thumbnails.default.url;

         const availableThumbnails = Object.values(thumbnails).filter(
            (t: any) => t && typeof t === "object" && "url" in t
         );
         if (availableThumbnails.length > 0) {
            return (availableThumbnails[0] as { url: string }).url;
         }
      }

      if (videoMetadata.thumbnailUrl) {
         return videoMetadata.thumbnailUrl;
      }

      // Verificar se não é logo do YouTube
      if (videoMetadata.thumbnail) {
         const thumb = videoMetadata.thumbnail;
         if (thumb.includes("yt_logo") || thumb.includes("supported_browsers") || thumb.includes("/img/desktop/")) {
            console.warn(`⚠️ [AffiliateLink]: Ignoring YouTube logo as thumbnail`);
            return null;
         }
         return thumb;
      }

      return null;
   }

   async getCurrencyRatesInBRL(currencies: string[] = ["USD", "EUR", "GBP"]): Promise<CurrencyRates> {
      try {
         // Primeiro, busca as cotações com base no USD
         const response = await fetch(`${this.baseUrl}/USD`);

         if (!response.ok) {
            throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
         }

         const data: ApiResponse = await response.json();

         if (!data.rates) {
            throw new Error("API retornou erro");
         }

         // Taxa do USD para BRL
         const usdToBrl = data.rates.BRL;

         if (!usdToBrl) {
            throw new Error("Taxa BRL não encontrada na resposta da API");
         }

         // Calcula as cotações em BRL
         const rates: CurrencyRates = {} as CurrencyRates;

         currencies.forEach((currency) => {
            if (currency === "USD") {
               // USD direto
               rates[currency] = usdToBrl;
            } else if (data.rates[currency]) {
               // Para outras moedas: (Taxa da moeda em USD) * (USD em BRL)
               rates[currency] = data.rates[currency] * usdToBrl;
            } else {
               console.warn(`Moeda ${currency} não encontrada na resposta da API`);
            }
         });

         return rates;
      } catch (error) {
         console.error("Erro ao buscar cotações:", error);
         throw new Error(
            `Falha ao obter cotações de moedas: ${error instanceof Error ? error.message : "Erro desconhecido"}`
         );
      }
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
      console.info("📊 [Affiliate Link]: OpenAI usage stats:", {
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

   // Proxy config for Mercado Livre requests
   private getAxiosProxyConfig(): any {
      return {
         host: process.env.PROXY_HOST || "proxy.smartproxy.net",
         port: Number(process.env.PROXY_PORT || 3120),
         auth: {
            username: process.env.PROXY_USER || "smart-rsrg25meix8s",
            password: process.env.PROXY_PASS || "OGf8dvp75MD79qUN",
         },
      };
   }

   private getHttpsAgentForProxy(): any {
      const host = process.env.PROXY_HOST || "proxy.smartproxy.net";
      const port = Number(process.env.PROXY_PORT || 3120);
      const user = process.env.PROXY_USER || "smart-rsrg25meix8s_area-BR_city-aracruz";
      const pass = process.env.PROXY_PASS || "OGf8dvp75MD79qUN";
      const url = `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
      return new HttpsProxyAgent(url);
   }

   async extractPageContentLatest(url: string): Promise<object> {
      try {
         console.info(`🌐 [Affiliate Link]: Extracting content from: ${url}`);

         // Desvia de interstitial do Mercado Livre (account-verification) pegando o alvo real do param "go"
         try {
            const u = new URL(url);
            if (u.hostname.includes("mercadolivre") && u.pathname.includes("/gz/account-verification")) {
               const go = u.searchParams.get("go");
               if (go) {
                  const dest = decodeURIComponent(go);
                  console.info(`↪️  [Affiliate Link]: Unwrapping ML account-verification to: ${dest}`);
                  url = dest;
               }
            }
         } catch {}

         // Tentar via API pública do Mercado Livre primeiro (evita interstitial/account-verification)
         try {
            const host = new URL(url).hostname.toLowerCase();
            if (host.includes("mercadolivre") || host.includes("mercadolibre")) {
               console.info("🟡 [Affiliate Link]: Trying Mercado Livre API extractor first...");
               const apiResult = await this.extractMercadoLivreViaApi(url);
               if (apiResult && (apiResult as any).price?.current) {
                  console.info("✅ [Affiliate Link]: Mercado Livre API extractor succeeded");
                  return apiResult;
               } else {
                  console.warn(
                     "⚠️ [Affiliate Link]: Mercado Livre API extractor returned no price, falling back to HTML"
                  );
               }
            }
         } catch (e) {
            console.warn("⚠️ [Affiliate Link]: Mercado Livre API extractor failed, falling back to HTML");
         }

         // Fazer a solicitação HTTP com axios
         const hostLatest = new URL(url).hostname.toLowerCase();
         const useProxyLatest = hostLatest.includes("mercadolivre") || hostLatest.includes("mercadolibre");
         const { data } = await axios.get(url, {
            headers: {
               "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
               Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
            timeout: 10000,
            httpsAgent: useProxyLatest ? this.getHttpsAgentForProxy() : undefined,
            proxy: useProxyLatest ? false : undefined,
         });

         // Carregar o HTML com cheerio
         const $ = cheerio.load(data);

         // Extrair dados específicos
         const title = $("h1.ui-pdp-title").text().trim();
         const currentPrice = $(".ui-pdp-price__second-line .andes-money-amount__fraction").first().text().trim();
         const originalPrice =
            $(".ui-pdp-price__second-line .andes-money-amount--previous .andes-money-amount__fraction").text().trim() ||
            null;
         const description = $(".ui-pdp-description__content").text().trim() || "Descrição não encontrada";
         const imageUrls = $(".ui-pdp-gallery__figure img")
            .map((_: any, el: any) => $(el).attr("src") || $(el).attr("data-src"))
            .get()
            .filter(Boolean);
         const seller = $(".ui-pdp-seller__link-trigger").text().trim() || "Vendedor não especificado";
         const rating = $(".ui-pdp-reviews__rating__summary__average").text().trim() || null;
         const reviewCount = $(".ui-pdp-reviews__rating__summary__count").text().trim() || null;

         // Montar o objeto de resultado
         const result = {
            url,
            title,
            price: {
               current: currentPrice ? parseFloat(currentPrice.replace(".", "").replace(",", ".")) : null,
               original: originalPrice ? parseFloat(originalPrice.replace(".", "").replace(",", ".")) : null,
            },
            description,
            images: imageUrls,
            seller,
            rating: rating ? parseFloat(rating.replace(",", ".")) : null,
            reviewCount: reviewCount ? parseInt(reviewCount.replace(/\D/g, "")) : null,
         };

         return result;
      } catch (error: any) {
         console.error("❌ Extração falhou:", error.message);
         throw new Error(`Falha ao extrair conteúdo: ${error.message}`);
      }
   }

   private parseMercadoLivreIds(inputUrl: string): { itemId?: string; productId?: string } {
      const result: { itemId?: string; productId?: string } = {};
      try {
         const u = new URL(inputUrl);
         const pathname = u.pathname;
         const params = u.searchParams;

         // 1) Item id via query (wid)
         const wid = params.get("wid") || params.get("item_id");
         if (wid && /^ML[A-Z]{1,2}\d+$/i.test(wid)) {
            result.itemId = wid.toUpperCase();
         }

         // 2) Product id via /p/MLBxxxx
         const prodMatch = pathname.match(/\/p\/(ML[A-Z]{1,2}\d+)/i);
         if (prodMatch) {
            result.productId = prodMatch[1].toUpperCase();
         }

         // 3) Generic MLB item in path
         if (!result.itemId) {
            const itemMatch = pathname.match(/(ML[A-Z]{1,2}\d{5,})/i);
            if (itemMatch) {
               result.itemId = itemMatch[1].toUpperCase();
            }
         }
      } catch {}
      return result;
   }

   private async extractMercadoLivreViaApi(url: string): Promise<object> {
      const ids = this.parseMercadoLivreIds(url);
      const baseItem = "https://api.mercadolibre.com/items/";
      const baseProduct = "https://api.mercadolibre.com/products/";

      const resolvePriceFromItem = (item: any): number | null => {
         const candidates: any[] = [];
         if (item?.price != null) candidates.push(item.price);
         if (item?.sale_price != null) candidates.push(item.sale_price);
         if (item?.original_price != null) candidates.push(item.original_price);
         if (Array.isArray(item?.prices?.prices)) {
            for (const p of item.prices.prices) {
               if (p?.amount != null) candidates.push(p.amount);
            }
         }
         const numeric = candidates
            .map((v) => (typeof v === "number" && isFinite(v) ? v : null))
            .filter((v) => v !== null) as number[];
         return numeric.length ? numeric[0] : null;
      };

      const proxyCfg = this.getAxiosProxyConfig();
      const fetchItem = async (itemId: string) => {
         const { data: item } = await axios.get(`${baseItem}${itemId}`, {
            proxy: proxyCfg,
         });
         let description = "";
         try {
            const { data: descData } = await axios.get(`${baseItem}${itemId}/description`, {
               proxy: proxyCfg,
            });
            description = descData?.plain_text || descData?.text || "";
         } catch {}
         let images: string[] = [];
         if (Array.isArray(item?.pictures) && item.pictures.length > 0) {
            images = item.pictures.map((p: any) => p.url).filter(Boolean);
         } else if (item?.secure_thumbnail || item?.thumbnail) {
            images = [item.secure_thumbnail || item.thumbnail].filter(Boolean);
         }
         let sellerName = "Mercado Livre";
         try {
            if (item?.seller_id) {
               const { data: seller } = await axios.get(`https://api.mercadolibre.com/users/${item.seller_id}`, {
                  proxy: proxyCfg,
               });
               sellerName = seller?.nickname || sellerName;
            }
         } catch {}
         const currentPrice = resolvePriceFromItem(item);
         return this.buildResult(
            url,
            "mercadolivre",
            item?.title || "",
            currentPrice != null ? String(currentPrice) : "",
            item?.original_price != null ? String(item.original_price) : null,
            description,
            images,
            sellerName,
            null as any
         );
      };

      // Prefer itemId; if not, resolve from productId
      if (ids.itemId) {
         const first = await fetchItem(ids.itemId);
         // If price still missing and productId exists, try buy box from product
         if ((first as any)?.price?.current) return first;
         if (ids.productId) {
            try {
               const { data: product } = await axios.get(`${baseProduct}${ids.productId}`, {
                  proxy: proxyCfg,
               });
               const winnerId = product?.buy_box_winner?.item_id || product?.buy_box_winner?.id;
               const firstItemId =
                  Array.isArray(product?.items) && product.items.length > 0 ? product.items[0]?.id : null;
               const itemId = winnerId || firstItemId;
               if (itemId) {
                  return await fetchItem(itemId);
               }
            } catch {}
         }
         return first;
      }

      if (ids.productId) {
         const { data: product } = await axios.get(`${baseProduct}${ids.productId}`, {
            proxy: proxyCfg,
         });
         // Try buy box winner or the first item
         const winnerId = product?.buy_box_winner?.item_id || product?.buy_box_winner?.id;
         const firstItemId = Array.isArray(product?.items) && product.items.length > 0 ? product.items[0]?.id : null;
         const itemId = winnerId || firstItemId;
         if (itemId) {
            return await fetchItem(itemId);
         }
      }

      // If nothing resolved, return empty object to force HTML path
      return {};
   }

   async fetchPageHtml(url: string) {
      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();

      await page.goto(url, { waitUntil: "networkidle2" });

      const html = await page.content();
      await browser.close();

      const $ = cheerio.load(html);
      return $;
   }

   async fetchPageHtmlText(url: string): Promise<string> {
      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();

      await page.goto(url, { waitUntil: "networkidle2" });

      // Captura o HTML completo da página após JavaScript ser executado
      const html = await page.content();

      await browser.close();

      return html; // Retorna a string HTML completa
   }

   async fetchPageViewSource(url: string): Promise<string> {
      try {
         const host = new URL(url).hostname.toLowerCase();
         const useProxy = host.includes("mercadolivre") || host.includes("mercadolibre");
         const response = await axios.get(url, {
            headers: {
               "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
               Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
               "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
               "Accept-Encoding": "gzip, deflate, br",
               Connection: "keep-alive",
               "Upgrade-Insecure-Requests": "1",
            },
            timeout: 30000,
            maxRedirects: 5,
            httpsAgent: useProxy ? this.getHttpsAgentForProxy() : undefined,
            proxy: useProxy ? false : undefined,
         });

         return response.data; // Retorna o HTML puro como string
      } catch (error) {
         console.error(`Error fetching view-source for ${url}:`, error);
         throw new Error(`Failed to fetch view-source: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
   }

   // Método 2: Usando puppeteer para capturar o view-source original (se axios não funcionar)
   async fetchPageViewSourcePuppeteer(url: string): Promise<string> {
      const browser = await puppeteer.launch({
         headless: true,
         args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      try {
         const page = await browser.newPage();

         // Interceptar a resposta HTML original antes do JavaScript executar
         let originalHtml = "";

         page.on("response", async (response) => {
            if (response.url() === url && response.headers()["content-type"]?.includes("text/html")) {
               try {
                  originalHtml = await response.text();
               } catch (error) {
                  console.warn("Could not capture original HTML from response");
               }
            }
         });

         await page.goto(url, {
            waitUntil: "domcontentloaded", // Não esperar JavaScript executar
         });

         // Se conseguimos capturar o HTML original, usar ele
         if (originalHtml) {
            return originalHtml;
         }

         // Fallback: capturar HTML via page.content()
         const html = await page.content();

         return html;
      } catch (error) {
         console.error(`Error fetching view-source with puppeteer for ${url}:`, error);
         throw new Error(`Failed to fetch view-source: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
         await browser.close();
      }
   }

   // Método 3: Híbrido - tenta axios primeiro, fallback para puppeteer
   async fetchPageHtmlSource(url: string): Promise<string | null> {
      try {
         // Unwrap Mercado Livre interstitial if present
         try {
            const u = new URL(url);
            if (u.hostname.includes("mercadolivre") && u.pathname.includes("/gz/account-verification")) {
               const go = u.searchParams.get("go");
               if (go) {
                  const dest = decodeURIComponent(go);
                  console.info(`↪️  [HTMLFetcher]: Unwrapping ML account-verification to: ${dest}`);
                  url = dest;
               }
            }
         } catch {}

         // Primeiro tenta com axios (mais rápido)
         const html = await this.extractDataFromPage.execute(url);
         if (html.length) return html;
         return await this.fetchPageViewSource(url);
      } catch (error) {
         console.warn("Axios failed, trying with puppeteer...");
         // Se falhar, usa puppeteer
         return await this.fetchPageViewSourcePuppeteer(url);
      }
   }
   async fetchViewSourceUrl(url: string): Promise<string> {
      // Remove view-source: se estiver presente
      const cleanUrl = url.replace(/^view-source:/, "");

      try {
         const host = new URL(cleanUrl).hostname.toLowerCase();
         const useProxy = host.includes("mercadolivre") || host.includes("mercadolibre");
         const response = await axios.get(cleanUrl, {
            headers: {
               "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            timeout: 30000,
            responseType: "text", // Garantir que retorna como texto
            httpsAgent: useProxy ? this.getHttpsAgentForProxy() : undefined,
            proxy: useProxy ? false : undefined,
         });

         return response.data;
      } catch (error) {
         throw new Error(
            `Failed to fetch view-source for ${cleanUrl}: ${error instanceof Error ? error.message : "Unknown error"}`
         );
      }
   }
   async extractPageContent(url: string): Promise<object> {
      try {
         console.info(`🌐 [Affiliate Link]: Extracting content from: ${url}`);
         const site = this.detectSite(url);
         if (site === "mercadolivre") {
            return await this.extractPageContentLatest(url);
         }

         // Fazer a solicitação HTTP com headers robustos
         let data = null;
         const host = new URL(url).hostname.toLowerCase();
         const useProxy = host.includes("mercadolivre") || host.includes("mercadolibre");
         const resu = await axios.get(url, {
            headers: {
               "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
               Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
               "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
               "Accept-Encoding": "gzip, deflate, br",
               "Cache-Control": "no-cache",
               Pragma: "no-cache",
               "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
               "Sec-Ch-Ua-Mobile": "?0",
               "Sec-Ch-Ua-Platform": '"Windows"',
               "Sec-Fetch-Dest": "document",
               "Sec-Fetch-Mode": "navigate",
               "Sec-Fetch-Site": "none",
               "Upgrade-Insecure-Requests": "1",
            },
            timeout: 20000,
            maxRedirects: 5,
            validateStatus: (status) => status < 500, // Aceita redirecionamentos
            httpsAgent: useProxy ? this.getHttpsAgentForProxy() : undefined,
            proxy: useProxy ? false : undefined,
         });
         data = resu.data;

         const $ = cheerio.load(data);

         console.info(`🌐 [Affiliate Link]: Site detected: ${site}`);

         let result = await this.extractDataBySite($, url, site);

         // Se a extração específica falhar, tentar extração genérica
         if (!result.title && site !== "generic") {
            console.info("🔄 [Affiliate Link]: Trying generic extraction...");
            result = await this.extractGenericData($, url);
         }

         // Última tentativa: usar JSON-LD e metadados
         if (!result.title) {
            console.info("🔄 [Affiliate Link]: Trying metadata extraction...");
            result = await this.extractFromMetadata($, url);
         }

         // Debug detalhado se ainda não encontrou dados essenciais
         if (!result.title || !result.price.current) {
            console.warn("⚠️ [Affiliate Link]: Incomplete extraction. Data found:");
            console.warn("- Title:", result.title ? "✓" : "✗");
            console.warn("- Price:", result.price.current ? "✓" : "✗");
            console.warn("- Description:", result.description !== "Descrição não disponível" ? "✓" : "✗");
            console.warn("- Images:", result.images.length > 0 ? `✓ (${result.images.length})` : "✗");

            // Tentar encontrar elementos disponíveis na página
            console.warn("\n📋 [Affiliate Link]: Elements found on page:");
            console.warn("- H1s found:", $("h1").length);
            console.warn("- H2s found:", $("h2").length);
            console.warn('- Classes with "price":', $('[class*="price"]').length);
            console.warn('- Classes with "title":', $('[class*="title"]').length);
            console.warn("- Total images:", $("img").length);
         }

         console.info("✅ [Affiliate Link]: Content extracted successfully");
         return result;
      } catch (error: any) {
         console.error("❌ [Affiliate Link]: Extraction failed:", error.message);
         throw new Error(`Failed to extract content: ${error.message}`);
      }
   }

   private detectSite(url: string): string {
      const hostname = new URL(url).hostname.toLowerCase();
      const pathname = new URL(url).pathname.toLowerCase();

      // Google Shopping
      if ((hostname.includes("gstatic.com") || hostname.includes("google.com")) && pathname.includes("/shopping")) {
         return "googleshopping";
      }

      // Principais plataformas brasileiras
      if (hostname.includes("amazon.com")) return "amazon";
      if (hostname.includes("mercadolivre.com") || hostname.includes("mercadolibre.com")) return "mercadolivre";
      if (
         hostname.includes("magazineluiza.com") ||
         hostname.includes("magalu.com") ||
         hostname.includes("magazinevoce.com")
      )
         return "magazineluiza";
      if (hostname.includes("americanas.com") || hostname.includes("submarino.com")) return "americanas";
      if (hostname.includes("casasbahia.com")) return "casasbahia";
      if (hostname.includes("extra.com")) return "extra";
      if (hostname.includes("pontofrio.com")) return "pontofrio";
      if (hostname.includes("shopee.com")) return "shopee";
      if (hostname.includes("aliexpress.com")) return "aliexpress";
      if (hostname.includes("shein.com")) return "shein";
      if (hostname.includes("netshoes.com")) return "netshoes";
      if (hostname.includes("dafiti.com")) return "dafiti";
      if (hostname.includes("zattini.com")) return "zattini";
      if (hostname.includes("walmart.com")) return "walmart";
      if (hostname.includes("carrefour.com")) return "carrefour";

      // Sites de afiliados conhecidos
      if (hostname.includes("hotmart.com") || hostname.includes("eduzz.com") || hostname.includes("monetizze.com"))
         return "affiliate";
      if (hostname.includes("lomadee.com") || hostname.includes("zanox.com")) return "affiliate";

      return "generic";
   }

   private async extractDataBySite($: any, url: string, site: string): Promise<any> {
      // Verificar se é uma loja chinesa e usar a nova API
      if (site === "aliexpress" || site === "shein" || site === "shopee") {
         try {
            console.info(`🌐 [Affiliate Link]: Using Chinese Stores API for ${site}`);
            const chineseData = await this.chineseStoresExtractor.extractProductData(url);

            // Converter para o formato esperado pelo sistema
            return {
               url: chineseData!.url,
               title: chineseData!.title,
               price: {
                  current: chineseData!.price,
                  original: chineseData!.originalPrice || null,
               },
               description: chineseData!.description || "Descrição não disponível",
               images: chineseData!.images,
               seller: chineseData!.store,
               rating: null,
               reviewCount: null,
               platform: chineseData!.store,
            };
         } catch (error) {
            console.warn(
               `⚠️ [Affiliate Link]: Chinese Stores API failed for ${site}, falling back to HTML extraction:`,
               error
            );
            // Fallback para o método original
         }
      }

      const extractors: any = {
         amazon: () => this.extractAmazonData($, url),
         mercadolivre: () => this.extractMercadoLivreData($, url),
         magazineluiza: () => this.extractMagazineLuizaData($, url),
         americanas: () => this.extractAmericanasData($, url),
         shopee: () => this.extractShopeeData($, url),
         aliexpress: () => this.extractAliexpressData($, url),
         affiliate: () => this.extractAffiliateData($, url),
         googleshopping: () => this.extractGoogleShoppingData($, url),
         generic: () => this.extractGenericData($, url),
      };

      return extractors[site] ? await extractors[site]() : await this.extractGenericData($, url);
   }

   private async extractAmazonData($: any, url: string): Promise<object> {
      const title =
         $("#productTitle").text().trim() ||
         $('h1[data-automation-id="product-title"]').text().trim() ||
         $(".product-title").text().trim();

      const currentPrice =
         $(".a-price-current .a-offscreen").first().text() ||
         $(".a-price .a-offscreen").first().text() ||
         $('[data-testid="price-current"]').text() ||
         $(".a-price-whole").text() + "," + $(".a-price-fraction").text();

      const originalPrice = $(".a-price-was .a-offscreen").text() || $(".a-text-price .a-offscreen").text();

      const description =
         $("#feature-bullets ul li")
            .map((_: any, el: any) => $(el).text().trim())
            .get()
            .join(". ") ||
         $("#productDescription p").text().trim() ||
         $(".a-unordered-list li")
            .map((_: any, el: any) => $(el).text().trim())
            .get()
            .join(". ");

      const images = await this.extractImages($, [
         "#landingImage",
         ".a-dynamic-image",
         "img[data-old-hires]",
         "#altImages img",
         ".imageThumb img",
      ]);

      const seller =
         $("#sellerProfileTriggerId").text().trim() ||
         $('.tabular-buybox-text[tabular-attribute-name*="Vendido"] span').text().trim() ||
         $('.a-link-normal:contains("Amazon")').text().trim() ||
         "Amazon";

      return this.buildResult(url, "amazon", title, currentPrice, originalPrice, description, images, seller, $);
   }

   private async extractMercadoLivreData($: any, url: string): Promise<object> {
      const title = $('h1.ui-pdp-title, h1[data-testid="product-title"]').text().trim();

      const currentPrice =
         $(".ui-pdp-price__second-line .andes-money-amount__fraction").first().text() ||
         $(".price-tag-fraction").text() ||
         $('[data-testid="price-part"]').text();

      const originalPrice =
         $(".ui-pdp-price__second-line .andes-money-amount--previous .andes-money-amount__fraction").text() ||
         $(".price-tag-symbol + .price-tag-fraction").text();

      const description = $(".ui-pdp-description__content").text().trim() || $(".item-description").text().trim();

      const images = await this.extractImages($, [
         ".ui-pdp-gallery__figure img",
         ".carousel-container img",
         ".gallery-image img",
         '[data-testid="product-image"]',
      ]);

      const seller = $(".ui-pdp-seller__link-trigger").text().trim() || $(".seller-info .seller-name").text().trim();

      return this.buildResult(url, "mercadolivre", title, currentPrice, originalPrice, description, images, seller, $);
   }

   private async extractMagazineLuizaData($: any, url: string): Promise<object> {
      const isMagazineVoce = url.includes("magazinevoce.com");

      let title, currentPrice, originalPrice, description, seller;
      let images: string[];

      if (isMagazineVoce) {
         // Seletores para Magazine Você
         title =
            $('h1.header-product__title, h1.title-product, h1[data-testid="product-title"], .product-title h1')
               .text()
               .trim() || "";

         currentPrice =
            $('.price-current, .sales-price, .price-value, [data-testid="price-current"], .sc-ijv5l5-2')
               .text()
               .trim() || "";

         originalPrice =
            $('.price-original, .list-price, .price-was, [data-testid="price-original"]').text().trim() || null;

         description =
            $('.product-description, .description-content, .product-details, [data-testid="description"]')
               .text()
               .trim() || "Descrição não encontrada";

         images = await this.extractImages($, [
            ".product-image img",
            ".gallery-image img",
            ".sc-kgw9hw-0 img",
            '[data-testid="product-image"]',
            ".slider-image img",
         ]);

         seller = $('.seller-name, .store-name, [data-testid="seller-name"]').text().trim() || "Magazine Você";
      } else {
         // Seletores para Magazine Luiza
         title =
            $('h1[data-testid="heading-product-title"], .header-product__title, .sc-8b169c7f-0 h1, .product-title h1')
               .text()
               .trim() || "";

         currentPrice =
            $('[data-testid="price-value"], .price-template__text, .sc-94ac9c7-0, .header-product__price-value')
               .text()
               .trim() || "";

         originalPrice =
            $('[data-testid="price-original"], .price-template__text--strike, .sc-94ac9c7-1').text().trim() || null;

         description =
            $('[data-testid="long-description"], .description-template, .sc-3e4f7f7b-0').text().trim() ||
            "Descrição não encontrada";

         images = await this.extractImages($, [
            '[data-testid="product-image"]',
            ".sc-kgw9hw-0 img",
            ".slider-container img",
            ".product-gallery img",
         ]);

         seller = $('[data-testid="seller-name"], .sc-8b169c7f-4').text().trim() || "Magazine Luiza";
      }

      // Normalizar preços
      const normalizedCurrentPrice = currentPrice
         ? parseFloat(currentPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;
      const normalizedOriginalPrice = originalPrice
         ? parseFloat(originalPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;

      return this.buildResult(
         url,
         "magazineluiza",
         title,
         normalizedCurrentPrice?.toString() || "0,00",
         normalizedOriginalPrice?.toString() || "0,00",
         description,
         images,
         seller,
         $
      );
   }

   private async extractAmericanasData($: any, url: string): Promise<object> {
      const title = $('h1[data-testid="product-name"], .sc-6c184ef-0 h1, .product-title h1').text().trim() || "";

      const currentPrice =
         $('[data-testid="price-current"], .sc-94ac9c7-0, .sales-price, .price__SalesPrice').text().trim() || "";

      const originalPrice = $('[data-testid="price-original"], .sc-94ac9c7-1, .list-price').text().trim() || null;

      const description =
         $('[data-testid="product-description"], .sc-3e4f7f7b-0, .product-description').text().trim() ||
         "Descrição não encontrada";

      const images = await this.extractImages($, [
         '[data-testid="product-image"]',
         ".sc-kgw9hw-0 img",
         ".product-gallery img",
         ".thumbs img",
      ]);

      const seller = $('[data-testid="seller-name"], .sc-8b169c7f-4').text().trim() || "Americanas";

      // Normalizar preços
      const normalizedCurrentPrice = currentPrice
         ? parseFloat(currentPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;
      const normalizedOriginalPrice = originalPrice
         ? parseFloat(originalPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;

      return this.buildResult(
         url,
         "americanas",
         title,
         normalizedCurrentPrice?.toString() || "0,00",
         normalizedOriginalPrice?.toString() || "0,00",
         description,
         images,
         seller,
         $
      );
   }

   async extractShopeeData($: any, url: string): Promise<object> {
      console.info("🌐 [Affiliate Link]: Starting Shopee data extraction:", url);
      const scrapedData = await this.enhancedChineseScraper.extractProductData(url);

      if (scrapedData) {
         return {
            url: scrapedData.url,
            platform: scrapedData.platform,
            title: scrapedData.title,
            price: {
               current: scrapedData.price,
               original: scrapedData.originalPrice || scrapedData.price,
            },
            description: scrapedData.description,
            images: scrapedData.images,
            seller: scrapedData.seller,
            extractedAt: scrapedData.extractedAt,
         };
      }

      // Fallback para o método antigo se o novo falhar
      console.warn("⚠️ [Affiliate Link]: Enhanced scraper failed, using fallback...");
      return {
         url,
         platform: "shopee",
         title: "Produto Shopee",
         price: { current: "Preço não disponível", original: "Preço não disponível" },
         description: "Descrição não disponível",
         images: [],
         seller: "Shopee Seller",
         extractedAt: new Date().toISOString(),
      };
   }

   private async extractAliexpressData($: any, url: string): Promise<object> {
      const isPtVersion = url.includes("pt.aliexpress.com");

      const title =
         $(
            'h1[data-pl="product-title"], .product-title-text, h1.product-title, .pdp-product-title, ' +
               '[data-testid="pdp-product-title"], .title--wrap--UUHae_g h1, h1:first, h2:first'
         )
            .text()
            .trim() || "";

      const currentPrice =
         $(
            ".product-price-current, .price--current--H7luGBF, .price-current, .notranslate:first, " +
               '[data-testid="pdp-price"], .uniform-banner-box-price, .product-price-value, .price:first'
         )
            .text()
            .trim() || "";

      const originalPrice =
         $(".product-price-original, .price--original--Tv4EWwJ, .price-original, .product-price .price-del")
            .text()
            .trim() || null;

      const description =
         $(
            ".product-description, .product-overview, .pdp-product-description, .description--wrap--L6QSFhN, " +
               ".product-property, .sku-prop"
         )
            .map((_: any, el: any) => $(el).text().trim())
            .get()
            .join(". ") ||
         $('meta[name="description"]').attr("content") ||
         "Descrição não encontrada";

      const images = await this.extractImages($, [
         ".product-image img",
         ".images-view-item img",
         ".slider-image img",
         ".preview--wrap--qMeq2bF img",
         ".magnifier--image--XQnO18R",
         '[data-testid="pdp-gallery"] img',
         ".pdp-gallery img",
         ".gallery-thumb img",
         'img[src*="alicdn"]',
      ]);

      const seller =
         $('.shop-name, .store-name, .seller-name, .store--storeName--_2w8Ew5, [data-testid="store-name"]')
            .text()
            .trim() || "AliExpress Seller";

      // Normalizar preços
      const normalizedCurrentPrice = currentPrice
         ? parseFloat(currentPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;
      const normalizedOriginalPrice = originalPrice
         ? parseFloat(originalPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;

      return this.buildResult(
         url,
         "aliexpress",
         title,
         normalizedCurrentPrice?.toString() || "0,00",
         normalizedOriginalPrice?.toString() || "0,00",
         description,
         images,
         seller,
         $
      );
   }

   private async extractAliexpressAggressive($: any, url: string): Promise<object> {
      // Extração mais agressiva procurando por qualquer elemento que pareça relevante

      // Buscar título em qualquer h1, h2 ou elemento com "title" no nome
      const title =
         $("h1").first().text().trim() ||
         $("h2").first().text().trim() ||
         $('[class*="title"]').first().text().trim() ||
         $('[data-*="title"]').first().text().trim() ||
         $(".title").first().text().trim();

      // Buscar preço em qualquer elemento que contenha números e símbolos de moeda
      let currentPrice = "";
      $("*").each((_: any, el: any) => {
         const text = $(el).text().trim();
         // Procurar por padrões de preço (R$, $, €, etc.)
         if (text.match(/(R\$|US\$|\$|€|£)\s*\d+[.,]\d+/) && !currentPrice && text.length < 50) {
            currentPrice = text;
            return false; // Para o loop
         }
      });

      // Buscar qualquer imagem que pareça ser do produto
      const images = await this.extractImages($, [
         'img[src*="product"]',
         'img[alt*="product"]',
         'img[class*="product"]',
         'img[data-*="product"]',
         ".gallery img",
         ".slider img",
         'img[src*="alicdn"]', // CDN específico do AliExpress
      ]);

      const description =
         $(".description").first().text().trim() ||
         $('[class*="description"]').first().text().trim() ||
         $('meta[name="description"]').attr("content") ||
         "Descrição não disponível";

      return this.buildResult(url, "aliexpress", title, currentPrice, null, description, images, "AliExpress", $);
   }

   private async extractAffiliateData($: any, url: string): Promise<object> {
      const title =
         $('h1:first, .product-title, .offer-title, [class*="title"], [data-testid*="title"]').text().trim() || "";

      const currentPrice =
         $('.price, .valor, [class*="price"], [data-testid*="price"], .offer-price').text().trim() || "";

      const description =
         $(
            '.description, .offer-description, [class*="description"], [data-testid*="description"], meta[name="description"]'
         )
            .text()
            .trim() || "Descrição não encontrada";

      const images = await this.extractImages($, [
         'img[alt*="produto"], img[class*="product"], .offer-image img',
         ".gallery img",
         '[data-testid*="image"]',
      ]);

      const seller =
         $('.seller, .store, .shop, [class*="seller"], [class*="store"], [data-testid*="seller"]').text().trim() ||
         "Parceiro";

      // Normalizar preço
      const normalizedCurrentPrice = currentPrice
         ? parseFloat(currentPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;

      return this.buildResult(
         url,
         "affiliate",
         title,
         normalizedCurrentPrice?.toString() || "0,00",
         null,
         description,
         images,
         seller,
         $
      );
   }

   private async extractGoogleShoppingData($: any, url: string): Promise<object> {
      console.info("🛍️ [Affiliate Link]: Extracting Google Shopping data...");

      // Google Shopping URLs geralmente são thumbnails/imagens
      // Vamos tentar extrair informações da página ou usar extração genérica
      const title =
         $('h1:first, h2:first, .product-title, [class*="title"], [data-testid*="title"]').text().trim() ||
         "Produto do Google Shopping";

      const currentPrice = $('.price, [class*="price"], [data-testid*="price"]').text().trim() || "";

      const description =
         $('.description, [class*="description"], [data-testid*="description"], meta[name="description"]').attr(
            "content"
         ) ||
         $('.description, [class*="description"]').text().trim() ||
         "Produto encontrado no Google Shopping";

      // Para Google Shopping, a URL geralmente já é uma imagem
      let images: string[] = [];
      if (url.includes("gstatic.com")) {
         // Se for um link direto do gstatic, use a própria URL como imagem
         images = [url];
      } else {
         images = await this.extractImages($, [
            'img[class*="product"]',
            'img[data-testid*="image"]',
            ".gallery img",
            "img[alt]",
         ]);
      }

      const seller = "Google Shopping";

      // Normalizar preço
      const normalizedCurrentPrice = currentPrice
         ? parseFloat(currentPrice.replace(/[^0-9,]/g, "").replace(",", ".")) || null
         : null;

      return this.buildResult(
         url,
         "googleshopping",
         title,
         normalizedCurrentPrice?.toString() || "0,00",
         null,
         description,
         images.length > 0 ? images : [url], // Se não encontrou imagens, usa a própria URL
         seller,
         $
      );
   }

   private async extractGenericData($: any, url: string): Promise<object> {
      console.info("🌐 [Affiliate Link]: Starting generic extraction...");

      const titleSelectors = [
         "h1:first",
         "h2:first",
         '[data-testid*="title"]',
         ".product-title",
         ".title",
         ".product-name",
         '[class*="title"]',
         '[id*="title"]',
         ".pdp-title",
         ".item-title",
         ".name",
      ];

      // Função para encontrar dinamicamente classes com 'price' no nome
      const findPriceClasses = ($: any): string[] => {
         const priceClasses = new Set<string>();

         // Percorre todos os elementos do DOM
         $("*").each((index: number, element: any) => {
            const classList = $(element).attr("class");
            const idList = $(element).attr("id");

            // Verifica classes que contêm 'price'
            if (classList) {
               const classes = classList.split(/\s+/);
               classes.forEach((className: string) => {
                  if (
                     className.toLowerCase().includes("price") ||
                     className.toLowerCase().includes("preco") ||
                     className.toLowerCase().includes("valor")
                  ) {
                     priceClasses.add(`.${className}`);
                  }
               });
            }

            // Verifica IDs que contêm 'price'
            if (idList) {
               const ids = idList.split(/\s+/);
               ids.forEach((id: string) => {
                  if (
                     id.toLowerCase().includes("price") ||
                     id.toLowerCase().includes("preco") ||
                     id.toLowerCase().includes("valor")
                  ) {
                     priceClasses.add(`#${id}`);
                  }
               });
            }

            // Verifica data attributes relacionados a preço
            const dataTestId = $(element).attr("data-testid");
            if (
               dataTestId &&
               (dataTestId.toLowerCase().includes("price") ||
                  dataTestId.toLowerCase().includes("preco") ||
                  dataTestId.toLowerCase().includes("valor"))
            ) {
               priceClasses.add(`[data-testid="${dataTestId}"]`);
            }
         });

         return Array.from(priceClasses);
      };

      // Seletores base de preço
      const basePriceSelectors = [
         '[data-testid*="price"]',
         ".price",
         ".valor",
         ".preco",
         '[class*="price"]',
         '[id*="price"]',
         ".currency",
         ".sales-price",
         ".current-price",
         ".price-current",
         ".price-value",
         ".product-price",
         ".offer-price",
         ".money",
         ".amount",
         ".cost",
         ".tariff",
         ".fee",
      ];

      // Combina seletores base com classes encontradas dinamicamente
      const dynamicPriceClasses = findPriceClasses($);
      const allPriceSelectors = [...basePriceSelectors, ...dynamicPriceClasses];

      console.info(
         `🌐 [Affiliate Link]: Found ${dynamicPriceClasses.length} dynamic price classes:`,
         dynamicPriceClasses
      );

      const title = this.trySelectors($, titleSelectors) || "";

      let currentPrice = this.trySelectors($, allPriceSelectors) || "";
      if (!currentPrice) {
         currentPrice = this.findPriceByPattern($) || "";
      }

      const description =
         this.extractDescription($) || $('meta[name="description"]').attr("content") || "Descrição não encontrada";

      const images = await this.extractImages($, [
         'img[src*="product"]',
         'img[alt*="produto"]',
         ".product-image img",
         ".gallery img",
         '[class*="image"] img',
         ".item-image img",
         ".photo img",
         ".picture img",
         '[data-testid*="image"]',
      ]);

      const seller =
         $('.seller, .store, .shop, .loja, [class*="seller"], [class*="store"], [data-testid*="seller"]')
            .text()
            .trim() || "N/A";

      // Normalizar preço com melhor tratamento
      const normalizedCurrentPrice = this.normalizePrice(currentPrice);

      const result: any = this.buildResult(
         url,
         "generic",
         title,
         normalizedCurrentPrice?.toString() || "0,00",
         null,
         description,
         images,
         seller,
         $
      );

      console.info(
         `🌐 [Affiliate Link]: Generic extraction completed. Title: ${result.title ? "found" : "not found"}, Price: ${
            result.price?.current ? "found" : "not found"
         }`
      );

      return result;
   }

   // Método auxiliar para normalização de preços
   private normalizePrice(priceText: string): number | null {
      if (!priceText) return null;

      // Remove tudo exceto números, vírgulas e pontos
      let cleanPrice = priceText.replace(/[^\d,.]/g, "");

      // Se não há números, retorna null
      if (!/\d/.test(cleanPrice)) return null;

      // Trata diferentes formatos de preço
      if (cleanPrice.includes(".") && cleanPrice.includes(",")) {
         // Formato: 1.234,56
         if (cleanPrice.lastIndexOf(",") > cleanPrice.lastIndexOf(".")) {
            cleanPrice = cleanPrice.replace(/\./g, "").replace(",", ".");
         } else {
            // Formato: 1,234.56
            cleanPrice = cleanPrice.replace(/,/g, "");
         }
      } else if (cleanPrice.includes(",")) {
         // Verifica se vírgula é separador decimal ou de milhares
         const parts = cleanPrice.split(",");
         if (parts.length === 2 && parts[1].length <= 2) {
            // Vírgula como separador decimal
            cleanPrice = cleanPrice.replace(",", ".");
         } else {
            // Vírgula como separador de milhares
            cleanPrice = cleanPrice.replace(/,/g, "");
         }
      }

      const parsed = parseFloat(cleanPrice);
      return isNaN(parsed) ? null : parsed;
   }

   private findPriceByPattern($: any): string {
      let priceFound = "";

      // Procurar por padrões de preço em todo o documento
      $("*").each((_: any, el: any) => {
         const text = $(el).text().trim();

         // Padrões de preço brasileiros e internacionais
         const pricePatterns = [
            /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/,
            /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
            /€\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/,
            /(\d{1,3}(?:\.\d{3})*,\d{2})/,
            /(\d+,\d{2})/,
         ];

         for (const pattern of pricePatterns) {
            const match = text.match(pattern);
            if (match && text.length < 100 && !priceFound) {
               // Evitar textos muito longos
               priceFound = text;
               return false; // Para o loop
            }
         }
      });

      return priceFound;
   }

   private extractDescription($: any): string {
      const descriptionSelectors = [
         '[data-testid*="description"]',
         ".description",
         ".produto-descricao",
         ".product-details",
         ".details",
         ".product-description",
         ".item-description",
         ".content",
         ".info",
         '[class*="description"]',
      ];

      for (const selector of descriptionSelectors) {
         const desc = $(selector).first().text().trim();
         if (desc && desc.length > 10) return desc;
      }

      // Tentar meta description
      const metaDesc = $('meta[name="description"]').attr("content");
      if (metaDesc) return metaDesc;

      // Como última tentativa, pegar qualquer parágrafo relevante
      const paragraphs = $("p")
         .map((_: any, el: any) => $(el).text().trim())
         .get()
         .filter((text: any) => text.length > 20 && text.length < 500);

      return paragraphs[0] || "Descrição não disponível";
   }

   private extractFromMetadata($: any, url: string): object {
      // Extrair dados de JSON-LD e metadados
      let jsonLdData = {};

      $('script[type="application/ld+json"]').each((_: any, el: any) => {
         try {
            const data = JSON.parse($(el).html() || "");
            if (data["@type"] === "Product" || data.name || data.offers) {
               jsonLdData = data;
            }
         } catch (e) {
            // Ignora JSON inválido
         }
      });

      const title =
         (jsonLdData as any).name ||
         $('meta[property="og:title"]').attr("content") ||
         $('meta[name="twitter:title"]').attr("content") ||
         $("title").text();

      const price =
         (jsonLdData as any).offers?.price ||
         (jsonLdData as any).offers?.[0]?.price ||
         $('meta[property="product:price:amount"]').attr("content");

      const description =
         (jsonLdData as any).description ||
         $('meta[property="og:description"]').attr("content") ||
         $('meta[name="description"]').attr("content");

      const imageUrl = (jsonLdData as any).image || $('meta[property="og:image"]').attr("content");

      return this.buildResult(url, "metadata", title, price, null, description, imageUrl ? [imageUrl] : [], "N/A", $);
   }

   private trySelectors($: any, selectors: string[]): string {
      for (const selector of selectors) {
         const text = $(selector).first().text().trim();
         if (text) return text;
      }
      return "";
   }

   private async getImageIntrinsicSize(imageUrl: string): Promise<{ width: number; height: number } | null> {
      try {
         // Usar fetch para obter a imagem
         const response = await fetch(imageUrl);
         if (!response.ok) return null;

         const arrayBuffer = await response.arrayBuffer();
         const uint8Array = new Uint8Array(arrayBuffer);

         // Verificar se é uma imagem válida
         if (uint8Array.length < 8) return null;

         // Detectar formato da imagem baseado nos primeiros bytes
         let width = 0,
            height = 0;

         // JPEG
         if (uint8Array[0] === 0xff && uint8Array[1] === 0xd8) {
            let i = 2;
            while (i < uint8Array.length - 1) {
               if (uint8Array[i] === 0xff) {
                  const marker = uint8Array[i + 1];
                  if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
                     if (i + 9 < uint8Array.length) {
                        height = (uint8Array[i + 5] << 8) | uint8Array[i + 6];
                        width = (uint8Array[i + 7] << 8) | uint8Array[i + 8];
                        break;
                     }
                  }
                  i += 2;
               } else {
                  i++;
               }
            }
         }
         // PNG
         else if (
            uint8Array[0] === 0x89 &&
            uint8Array[1] === 0x50 &&
            uint8Array[2] === 0x4e &&
            uint8Array[3] === 0x47
         ) {
            if (uint8Array.length >= 24) {
               width = (uint8Array[16] << 24) | (uint8Array[17] << 16) | (uint8Array[18] << 8) | uint8Array[19];
               height = (uint8Array[20] << 24) | (uint8Array[21] << 16) | (uint8Array[22] << 8) | uint8Array[23];
            }
         }
         // GIF
         else if (uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46) {
            if (uint8Array.length >= 10) {
               width = uint8Array[6] | (uint8Array[7] << 8);
               height = uint8Array[8] | (uint8Array[9] << 8);
            }
         }
         // WebP
         else if (
            uint8Array[0] === 0x52 &&
            uint8Array[1] === 0x49 &&
            uint8Array[2] === 0x46 &&
            uint8Array[3] === 0x46
         ) {
            if (uint8Array.length >= 30) {
               width = (uint8Array[26] | (uint8Array[27] << 8)) & 0x3fff;
               height = (uint8Array[28] | (uint8Array[29] << 8)) & 0x3fff;
            }
         }

         return width > 0 && height > 0 ? { width, height } : null;
      } catch (error) {
         console.warn(`Failed to get intrinsic size for image: ${imageUrl}`, error);
         return null;
      }
   }

   private async extractImages($: any, selectors: string[]): Promise<string[]> {
      const imageCandidates: Array<{
         url: string;
         score: number;
         width?: number;
         height?: number;
         intrinsicWidth?: number;
         intrinsicHeight?: number;
      }> = [];

      for (const selector of selectors) {
         $(selector).each((_: any, el: any) => {
            const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy");
            if (src && !src.includes("data:image")) {
               // Extrair dimensões HTML se disponíveis
               const widthAttr = $(el).attr("width");
               const heightAttr = $(el).attr("height");
               const width = widthAttr ? parseInt(widthAttr) : undefined;
               const height = heightAttr ? parseInt(heightAttr) : undefined;

               // Tentar obter versão de maior resolução
               let highResUrl = src;
               if (src.includes("/")) {
                  // Tentar diferentes padrões de alta resolução
                  const highResPatterns = [
                     src.replace(/\/\d+x\d+\//, "/1200x1200/"),
                     src.replace(/\/\d+x\d+\//, "/1000x1000/"),
                     src.replace(/\/\d+x\d+\//, "/800x800/"),
                     src.replace(/\/\d+x\d+\//, "/600x600/"),
                     src.replace(/\/\d+x\d+\//, "/original/"),
                     src.replace(/\/\d+x\d+\//, "/full/"),
                     src.replace(/\/\d+x\d+\//, "/high/"),
                  ];

                  // Usar o primeiro padrão que não seja igual ao original
                  const betterUrl = highResPatterns.find((pattern) => pattern !== src);
                  if (betterUrl) highResUrl = betterUrl;
               }

               imageCandidates.push({
                  url: highResUrl,
                  score: 0, // Será calculado depois
                  width,
                  height,
               });
            }
         });
      }

      // Obter dimensões intrínsecas das imagens
      const imagePromises = imageCandidates.map(async (candidate) => {
         try {
            const intrinsicSize = await this.getImageIntrinsicSize(candidate.url);
            if (intrinsicSize) {
               candidate.intrinsicWidth = intrinsicSize.width;
               candidate.intrinsicHeight = intrinsicSize.height;
            }
         } catch (error) {
            console.warn(`Failed to get intrinsic size for: ${candidate.url}`, error);
         }
         return candidate;
      });

      const processedCandidates = await Promise.all(imagePromises);

      // Calcular score baseado nas dimensões intrínsecas
      processedCandidates.forEach((candidate) => {
         let score = 0;

         // Priorizar imagens com dimensões intrínsecas conhecidas
         if (candidate.intrinsicWidth && candidate.intrinsicHeight) {
            const area = candidate.intrinsicWidth * candidate.intrinsicHeight;
            if (area >= 1920 * 1080) score += 100; // Full HD ou maior
            else if (area >= 1280 * 720) score += 80; // HD
            else if (area >= 800 * 600) score += 60; // Muito alta resolução
            else if (area >= 600 * 400) score += 50; // Alta resolução
            else if (area >= 400 * 300) score += 40; // Média resolução
            else if (area >= 200 * 150) score += 30; // Baixa resolução
            else score += 20; // Muito baixa resolução
         } else if (candidate.width && candidate.height) {
            // Fallback para dimensões HTML
            const area = candidate.width * candidate.height;
            if (area >= 800 * 600) score += 50;
            else if (area >= 600 * 400) score += 40;
            else if (area >= 400 * 300) score += 30;
            else if (area >= 200 * 150) score += 20;
            else score += 10;
         } else {
            score += 15; // Score base para imagens sem dimensões
         }

         // Priorizar URLs que indicam alta qualidade
         const url = candidate.url.toLowerCase();
         if (url.includes("high") || url.includes("hd") || url.includes("full")) score += 20;
         if (url.includes("original") || url.includes("large")) score += 15;
         if (url.includes("zoom") || url.includes("detail")) score += 10;
         if (url.includes("1200") || url.includes("1000")) score += 25;
         if (url.includes("800") || url.includes("600")) score += 20;

         // Penalizar URLs que indicam baixa qualidade
         if (url.includes("thumb") || url.includes("small") || url.includes("mini")) score -= 10;
         if (url.includes("icon") || url.includes("logo")) score -= 20;

         candidate.score = score;
      });

      // Ordenar por score (maior para menor) e remover duplicatas
      const uniqueImages = processedCandidates
         .sort((a, b) => b.score - a.score)
         .filter((candidate, index, arr) => arr.findIndex((c) => c.url === candidate.url) === index);

      return uniqueImages.slice(0, 10).map((c) => c.url); // Máximo 10 imagens
   }

   private buildResult(
      url: string,
      site: string,
      title: string,
      currentPrice: string,
      originalPrice: string | null,
      description: string,
      images: string[],
      seller: string,
      $: any
   ): object {
      return {
         url,
         site,
         title: title || "Título não encontrado",
         price: {
            current: this.parsePrice(currentPrice),
            original: this.parsePrice(originalPrice),
         },
         description: description || "Descrição não disponível",
         images,
         seller: seller || "N/A",
         rating: this.extractRating($),
         reviewCount: this.extractReviewCount($),
         extractedAt: new Date().toISOString(),
      };
   }

   private extractRating($: any): number | null {
      const ratingSelectors = [
         '.rating, .avaliacao, [class*="rating"]',
         '[data-testid*="rating"]',
         ".stars",
         ".review-rating",
         ".product-rating",
      ];

      for (const selector of ratingSelectors) {
         const rating = $(selector).first().text().trim();
         const parsed = this.parseRating(rating);
         if (parsed) return parsed;
      }
      return null;
   }

   private extractReviewCount($: any): number | null {
      const reviewSelectors = [
         '.review-count, .avaliacoes, [class*="review"]',
         '[data-testid*="review"]',
         ".reviews-count",
      ];

      for (const selector of reviewSelectors) {
         const count = $(selector).first().text().trim();
         const parsed = this.parseReviewCount(count);
         if (parsed) return parsed;
      }
      return null;
   }

   private parsePrice(priceText: string | null): number | null {
      if (!priceText) return null;

      // Remove tudo exceto números, vírgulas e pontos
      const cleanPrice = priceText.replace(/[^\d,.-]/g, "");
      if (!cleanPrice) return null;

      // Formato brasileiro: 1.234,56
      if (cleanPrice.includes(",") && cleanPrice.lastIndexOf(",") > cleanPrice.lastIndexOf(".")) {
         const parts = cleanPrice.split(",");
         if (parts.length === 2 && parts[1].length <= 2) {
            const integerPart = parts[0].replace(/\./g, "");
            return parseFloat(`${integerPart}.${parts[1]}`);
         }
      }

      // Formato americano ou sem decimais
      return parseFloat(cleanPrice.replace(/[^\d.]/g, "")) || null;
   }

   private parseRating(ratingText: string): number | null {
      if (!ratingText) return null;
      const match = ratingText.match(/(\d+[,.]?\d*)/);
      return match ? parseFloat(match[1].replace(",", ".")) : null;
   }

   private parseReviewCount(reviewText: string): number | null {
      if (!reviewText) return null;
      const numbers = reviewText.replace(/\D/g, "");
      return numbers ? parseInt(numbers) : null;
   }

   validateProductPayload(productPayload: any): any {
      const missingConditions: string[] = [];

      if (productPayload.price === null || !productPayload.price) {
         return {
            isValid: false,
            reason: `Preço não encontrado`,
         };
      }

      // Verifica se tem imagens (medias)
      const hasImages =
         productPayload.medias && Array.isArray(productPayload.medias) && productPayload.medias.length > 0;

      if (!hasImages) {
         missingConditions.push("imagens");
      }

      // Verifica se tem descrição e título
      const hasDescription =
         productPayload.description &&
         typeof productPayload.description === "string" &&
         productPayload.description.trim() !== "";

      const hasTitle =
         productPayload.name && typeof productPayload.name === "string" && productPayload.name.trim() !== "";

      if (!hasDescription || !hasTitle) {
         const missing = [];
         if (!hasDescription) missing.push("descrição");
         if (!hasTitle) missing.push("título");
         missingConditions.push(missing.join(" e "));
      }

      // Verifica se tem preço (maior que 0, já que você usa || 0 no payload)
      const hasPrice = productPayload.price !== null && productPayload.price !== undefined && productPayload.price > 0;

      if (!hasPrice) {
         missingConditions.push("preço");
      }

      // Se mais de uma condição não existe, retorna FALSE
      if (missingConditions.length > 1) {
         return {
            isValid: false,
            reason: `Múltiplas condições não atendidas: ${missingConditions.join(", ")}`,
         };
      }

      // Se apenas uma ou nenhuma condição não existe, segue em frente (TRUE)
      return {
         isValid: true,
      };
   }

   /**
    * Converte um ou múltiplos links de afiliado em produtos usando apenas OpenAI
    * @param {User} user - Usuário autenticado
    * @param {object} body - Corpo da requisição contendo affiliateLink(s) e opções
    * @param {string|string[]} body.affiliateLink - Link de afiliado do produto ou array de links
    * @param {object} body.options - Opções adicionais (categoria preferida, preço sugerido, etc.)
    * @returns {Promise<object>} - Resultado da operação com detalhes dos produtos criados
    */
   async convertAffiliateLinkToProduct(user: any, body: any) {
      let { affiliateLink, options = {}, videoLink, dexdVideoId = null } = body;
      if (!affiliateLink) affiliateLink = videoLink;
      try {
         const userId = user?.id;
         console.info(`🚀 [Affiliate Link]: Starting affiliate link(s) to product conversion. User ID: ${userId}`);

         // Normalizar o input para sempre trabalhar com array
         const linksArray = Array.isArray(affiliateLink) ? affiliateLink : [affiliateLink];

         console.info(`🔗 [Affiliate Link]: Total links to process: ${linksArray.length}`);
         console.info(`🔗 [Affiliate Link]: Links: ${JSON.stringify(linksArray)}`);

         // Validar que todos os itens são strings válidas
         const validLinks = linksArray;
         /*.filter(
            (link) =>
               typeof link === "string" && link.trim().length > 0 && (link.includes("amzn") || link.includes("mercado"))
         );
         */

         if (validLinks.length === 0) {
            throw new Error("Nenhum link válido foi fornecido");
         }

         if (validLinks.length !== linksArray.length) {
            console.warn(`${linksArray.length - validLinks.length} link(s) inválido(s) foram ignorados`);
         }

         // Obter a loja do usuário uma vez
         const userStore = await this.prismaClient.store.findFirst({
            where: { userId },
         });

         if (!userStore) {
            throw new Error(`Usuário ${userId} não possui uma loja associada`);
         }

         const results: any = {
            success: [],
            errors: [],
            total: validLinks.length,
            processed: 0,
         };

         // Processar cada link
         for (let i = 0; i < validLinks.length; i++) {
            const currentLink = validLinks[i];

            try {
               console.info(`🔄 [Affiliate Link]: Processing link ${i + 1}/${validLinks.length}: ${currentLink}`);

               // ✅ VERIFICAR LIMITES LOGO NO INÍCIO, ANTES DE GASTAR RECURSOS
               const usageCheck = await this.usageLimitsService.canCreateProduct(user.id);
               if (!usageCheck.canProceed) {
                  console.error(
                     `⚠️ [Affiliate Link]: Product limit exceeded or payment pending for user ${user.id} - BLOQUEADO`
                  );
                  // 🚫 LANÇAR ERRO COM NOME ESPECÍFICO PARA O CONTROLLER RETORNAR 403
                  const error: any = new Error(
                     usageCheck.message || "Limite de produtos excedido ou pagamento pendente"
                  );
                  error.name = usageCheck.exceededFeatures?.includes("payment")
                     ? "PaymentPendingError"
                     : "UsageLimitExceededError";
                  error.statusCode = 403;
                  throw error;
               }

               const resolver = new UrlResolver();

               // Método mais simples - retorna apenas a URL final
               const finalUrl = await resolver.getFinalUrl(currentLink);

               // Detectar Mercado Livre e usar extrator local, ignorando caminho via OpenAI (robusto e estável em produção)
               let productInfo: any;
               try {
                  const hostname = new URL(finalUrl || currentLink).hostname.toLowerCase();
                  const isMercadoLivre = hostname.includes("mercadolivre") || hostname.includes("mercadolibre");
                  options.isMercadoLivre = isMercadoLivre;

                  // if (isMercadoLivre) {
                  //    console.info("🛒 [Affiliate Link]: Mercado Livre detected. Using robust local extractor.");
                  //    console.info(
                  //       `🌐 [Affiliate Link]: Extracting with local ML extractor: ${finalUrl || currentLink}`
                  //    );
                  //    const localData: any = await this.extractPageContent(finalUrl || currentLink);
                  //    console.info("🔍 [Affiliate Link]: Local ML extraction result:", {
                  //       title: (localData as any)?.title,
                  //       price: (localData as any)?.price,
                  //       seller: (localData as any)?.seller,
                  //       images: Array.isArray((localData as any)?.images) ? (localData as any)?.images?.length : 0,
                  //    });

                  //    // Mapear dados locais para o formato esperado pelo fluxo atual
                  //    const currentPrice =
                  //       typeof (localData as any)?.price === "object"
                  //          ? (localData as any)?.price?.current
                  //          : (localData as any)?.price;

                  //    const isValidLocal = typeof currentPrice === "number" && currentPrice > 0;

                  //    if (!isValidLocal) {
                  //       console.info("⚠️ [Affiliate Link]: Local ML extractor missing price. Falling back to AI.");
                  //       productInfo = await this.analyzeAffiliateLinkWithOpenAI(finalUrl || "", options);
                  //       console.info("🧠 [Affiliate Link]: AI extraction finished. Summary:", {
                  //          name: productInfo?.name,
                  //          price: productInfo?.price,
                  //          brand: productInfo?.brand,
                  //          images: Array.isArray(productInfo?.images) ? productInfo.images.length : 0,
                  //       });
                  //    } else {
                  //       productInfo = {
                  //          platform: "mercadolivre",
                  //          originalTitle: (localData as any)?.title || null,
                  //          originalDescription: (localData as any)?.description || null,
                  //          name: (localData as any)?.title || "Produto Mercado Livre",
                  //          description: (localData as any)?.description || "Produto do Mercado Livre",
                  //          price: currentPrice,
                  //          cost: Math.round(currentPrice * 0.65 * 100) / 100,
                  //          brand: (localData as any)?.seller || "Mercado Livre",
                  //          model: "affiliate",
                  //          line: "mercadolivre",
                  //          material: "",
                  //          benefits: "",
                  //          suggestedTags: [
                  //             "Mercado Livre",
                  //             "Afiliado",
                  //             "Produto",
                  //             "Oferta",
                  //             "Marketplace",
                  //             "Brasil",
                  //             "E-commerce",
                  //             "Varejo",
                  //             "Compra",
                  //             "Original",
                  //          ],
                  //          height: 0,
                  //          width: 0,
                  //          length: 0,
                  //          weight: 0,
                  //          ncm: "00.00.00",
                  //          images: Array.isArray((localData as any)?.images) ? (localData as any).images : [],
                  //          additionalDetails: `Link analisado: ${finalUrl || currentLink}`,
                  //       };
                  //    }
                  // }

                  // Usar OpenAI para acessar o link e extrair todas as informações do produto
                  productInfo = await this.analyzeAffiliateLinkWithOpenAI(finalUrl || "", options);
               } catch (e) {
                  // Fallback para caminho via OpenAI caso parsing de URL falhe
                  productInfo = await this.analyzeAffiliateLinkWithOpenAI(finalUrl || "", options);
               }
               //const productInfo = await this.analyzeAffiliateLinkWithOpenAI_NEW(finalUrl || "", options);

               // Procurar ou criar exatamente 10 tags relevantes
               // ETAPA 1: LLM cria as tags (suggestedTags já foram criadas pela LLM)
               // ETAPA 2: LLM categoriza as tags perfeitamente
               const productContext = `${productInfo.name || ""} - ${productInfo.description || ""}`.trim();
               const tagIds = await this.findOrCreateExactly10TagIds(productInfo.suggestedTags, productContext);

               console.info(`🏷️ [Affiliate Link]: Tag IDs to be connected to the product: ${JSON.stringify(tagIds)}`);

               // Preparar o payload para o ProductService
               const medias = this.prepareMedias(productInfo.images);
               const productPayload: any = {
                  name: productInfo.name,
                  description: productInfo.description,
                  price: productInfo.price || 0,
                  storeId: userStore.id,
                  dexdVideoId,
                  material: productInfo.material || "",
                  benefits: productInfo.benefits || "",
                  moreDetails: `Produto de afiliado - Link original: ${currentLink}\n\n${
                     productInfo.additionalDetails || ""
                  }`,
                  medias,
                  cost: productInfo.cost || 0,
                  measurementUnitId: 1,
                  measureHeight: productInfo.height || 0,
                  measureWidth: productInfo.width || 0,
                  measureLength: productInfo.length || 0,
                  weight: productInfo.weight || 0,
                  ncm: productInfo.ncm || "00.00.00",
                  measureHeightWithPackaging: productInfo.packageHeight || (productInfo.height || 0) + 2,
                  measureWidthWithPackaging: productInfo.packageWidth || (productInfo.width || 0) + 2,
                  measureLengthWithPackaging: productInfo.packageLength || (productInfo.length || 0) + 2,
                  weightWithPackaging: productInfo.packageWeight || (productInfo.weight || 100) * 1.1,
                  model: productInfo.model || "affiliate",
                  line: productInfo.line || productInfo.brand || productInfo.platform,
                  power: productInfo.power || "",
                  consumption: productInfo.consumption || "",
                  capacity: productInfo.capacity || "",
                  guarantee: productInfo.guarantee || "",
                  toFeed: true,
                  feedDescription: null,
                  type: "external",
                  url: currentLink,
                  tags: tagIds,
               };

               // Usar o ProductService para criar o produto
               const avalia = this.validateProductPayload(productPayload);
               const result = await this.productService.store(productPayload, user);

               // ✅ REGISTRAR USO APÓS CRIAÇÃO
               await this.usageLimitsService.recordUsage(user.id, "productsPerMonth", "product", result.product.id);

               console.info(
                  `✅ [Affiliate Link]: Product created successfully from affiliate link. ID: ${result.product.id}`
               );

               results.success.push({
                  link: currentLink,
                  productId: result.product.id,
                  productName: productInfo.name,
                  index: i + 1,
               });
               // if (avalia.isValid) {

               // } else {
               //    console.warn(`⚠️ [Affiliate Link]: Bad product detected: ${avalia.reason}`);
               //    console.table(productPayload);
               //    results.errors.push({
               //       link: currentLink,
               //       error: `Bad product detected: ${avalia.reason}`,
               //       index: i + 1,
               //    });
               // }
            } catch (error: any) {
               console.error(`Erro ao processar link ${i + 1} (${currentLink}):`, error);

               results.errors.push({
                  link: currentLink,
                  error: error.message || "Erro desconhecido",
                  index: i + 1,
               });
            }

            results.processed++;
         }

         // Log do resultado final
         console.info(`✅ [Affiliate Link]: Processing completed:`);
         console.info(`- Total links: ${results.total}`);
         console.info(`- Successes: ${results.success.length}`);
         console.info(`- Errors: ${results.errors.length}`);

         // Retornar resultado detalhado
         return {
            success: results.errors.length === 0, // true apenas se todos foram processados com sucesso
            results,
            message: `${results.success.length} de ${results.total} produto(s) criado(s) com sucesso`,
         };
      } catch (error) {
         console.error("Erro geral ao converter link(s) de afiliado em produto(s):", error);
         throw error;
      }
   }

   sanitizeString(input: string): string {
      return (
         input
            // Remove scripts, styles e comentários
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")

            // Remove todas as tags HTML
            .replace(/<[^>]*>/g, " ")

            // Remove entities HTML
            .replace(/&[a-zA-Z0-9#]+;/g, " ")

            // Limpa espaços múltiplos e quebras de linha
            .replace(/\s+/g, " ")
            .trim()
      );
   }

   async extractImageUrls(input: string, link: string): Promise<string[]> {
      const imageExtractor = new ImageExtractor();
      const uniqueUrls = await imageExtractor.extractImageUrls(input, link);
      return uniqueUrls;
   }

   compressText(text: string): string {
      return (
         text
            // Remove espaços múltiplos
            .replace(/\s+/g, " ")
            // Remove quebras de linha múltiplas
            .replace(/\n+/g, "\n")
            // Remove caracteres especiais desnecessários
            .replace(/[‏‎]+/g, "")
            // Remove texto repetido (palavras que aparecem mais de 3 vezes seguidas)
            .replace(/(\b\w+\b)(\s+\1){3,}/g, "$1")
            // Remove frases muito similares (90% iguais)
            .split("\n")
            .filter((line, index, arr) => {
               if (line.trim().length < 10) return false;

               for (let i = 0; i < index; i++) {
                  const similarity = this.getSimilarity(line, arr[i]);
                  if (similarity > 0.9) return false;
               }
               return true;
            })
            .join("\n")
            .trim()
      );
   }

   getSimilarity(str1: string, str2: string): number {
      const words1 = str1.toLowerCase().split(/\s+/);
      const words2 = str2.toLowerCase().split(/\s+/);

      if (words1.length === 0 || words2.length === 0) return 0;

      const commonWords = words1.filter((word) => words2.includes(word));
      return commonWords.length / Math.max(words1.length, words2.length);
   }
   async getImages(data: string) {
      const prompt = `
      Retire do html abaixo todas as imagens do produto, procure em tags img em src:
      ${data}
      `;
      const result = await this.extract.freePrompt(prompt);
      return result;
   }

   async extractImagesFromOpenai(input: string, link: string): Promise<string[]> {
      const prompt = `
      Retire do texto abaixo todas as imagens do produto.
      Encontre as imagens que se referem ao produto, analise o padrao, quero as melhores.
      IMPORTANTE: Procure pelas imagens de maior qualidade, de preferência que sejam as principais.
      Procure por detalhes que signifiquem maior resoluçao, como SX679, e etc. Ordene da maior qualidade para a menor.
      Devolva apenas um array stringify de urls, caso não consiga devolva vazio, sem a expressao json, quero algo como: ["url1", "url2", "url3", "url4", "url5", "url6", "url7", "url8", "url9", "url10"].
      ${input}
      `;
      const result = await this.extract.freePrompt(prompt);
      const value = JSON.parse(result.choices[0].message.content || "[]");
      return value;
   }

   extractRelevantContent(text: string, maxTokens: number = 16000): string | null {
      let cleanedText = text;

      // Remover elementos comuns de navegação e UI (universal)
      const removePatterns = [
         // URLs e links
         /https?:\/\/[^\s]+/g,
         /www\.[^\s]+/g,

         // Elementos de navegação comuns
         /menu|navigation|nav-|navbar/gi,
         /skip to|jump to|go to/gi,
         /home|about|contact|privacy|terms|login|register|sign in|sign up/gi,

         // Códigos e IDs técnicos
         /[a-zA-Z0-9]{20,}/g,
         /{"[^"]*"[^}]*}/g,
         /\w+:\s*"[^"]*"/g,

         // Elementos de mídia social e compartilhamento
         /facebook|twitter|instagram|linkedin|youtube|share|like|follow/gi,

         // Elementos de rodapé comuns
         /copyright|©|\(c\)|all rights reserved|terms of service|privacy policy/gi,

         // JavaScript e CSS remnants
         /function\s*\([^)]*\)|var\s+\w+|const\s+\w+|let\s+\w+/g,
         /display:\s*\w+|color:\s*#?\w+|font-size:\s*\d+/g,

         // Elementos de formulário
         /submit|reset|button|input|select|textarea|form-/gi,

         // Timestamps e IDs
         /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g,
         /id="[^"]*"|class="[^"]*"/g,

         // Publicidade e tracking
         /advertisement|ads-|google-ad|tracking|analytics/gi,

         // Elementos repetitivos
         /\b(\w+)\s+\1\b/g, // palavras duplicadas consecutivas
      ];

      // Aplicar padrões de remoção
      removePatterns.forEach((pattern) => {
         cleanedText = cleanedText.replace(pattern, " ");
      });

      // Limpar espaços e quebras de linha excessivas
      cleanedText = cleanedText
         .replace(/\s+/g, " ") // múltiplos espaços
         .replace(/\n\s*\n/g, "\n") // múltiplas quebras de linha
         .replace(/[^\w\s.,!?:;()\-$%]/g, " ") // caracteres especiais desnecessários
         .trim();

      // Dividir em sentenças e priorizar conteúdo relevante
      const sentences = cleanedText.split(/[.!?]+/).filter((s) => s.trim().length > 10);

      // Scoring de relevância para priorizar conteúdo importante
      const scoreSentence = (sentence: string): number => {
         let score = 0;
         const lowerSentence = sentence.toLowerCase();

         // Palavras que indicam conteúdo importante
         const importantKeywords = [
            "price",
            "cost",
            "description",
            "features",
            "specifications",
            "details",
            "review",
            "rating",
            "quality",
            "product",
            "service",
            "available",
            "includes",
            "about",
            "overview",
            "summary",
            "information",
         ];

         // Palavras que indicam conteúdo menos importante
         const unimportantKeywords = [
            "cookie",
            "policy",
            "terms",
            "legal",
            "advertisement",
            "sponsor",
            "newsletter",
            "subscribe",
            "follow",
            "social",
            "media",
         ];

         // Pontuação positiva
         importantKeywords.forEach((keyword) => {
            if (lowerSentence.includes(keyword)) score += 2;
         });

         // Pontuação negativa
         unimportantKeywords.forEach((keyword) => {
            if (lowerSentence.includes(keyword)) score -= 3;
         });

         // Bonus por comprimento adequado
         if (sentence.length >= 30 && sentence.length <= 200) score += 1;

         // Bonus por conter números (preços, especificações)
         if (/\d/.test(sentence)) score += 1;

         // Penalty por frases muito curtas ou muito longas
         if (sentence.length < 20 || sentence.length > 300) score -= 1;

         return score;
      };

      // Ordenar sentenças por relevância
      const rankedSentences = sentences
         .map((sentence) => ({ text: sentence.trim(), score: scoreSentence(sentence) }))
         .filter((item) => item.score > -2) // Filtrar conteúdo muito irrelevante
         .sort((a, b) => b.score - a.score);

      // Montar resultado respeitando limite de tokens (aproximado)
      let result = "";
      let tokenCount = 0;
      const avgTokensPerChar = 0.25; // Aproximação: 1 token ≈ 4 caracteres

      for (const item of rankedSentences) {
         const sentenceTokens = item.text.length * avgTokensPerChar;

         if (tokenCount + sentenceTokens > maxTokens) {
            break;
         }

         result += item.text + ". ";
         tokenCount += sentenceTokens;
      }

      // Limpar resultado final
      result = result
         .replace(/\s+/g, " ")
         .replace(/\.\s*\./g, ".")
         .trim();

      // Se ainda estiver muito longo, truncar
      if (result.length * avgTokensPerChar > maxTokens) {
         const maxChars = Math.floor(maxTokens / avgTokensPerChar);
         result = result.substring(0, maxChars).trim();

         // Garantir que não corta no meio de uma palavra
         const lastSpace = result.lastIndexOf(" ");
         if (lastSpace > maxChars * 0.9) {
            result = result.substring(0, lastSpace).trim();
         }
      }

      return result || null;
   }

   //    private async analyzeAffiliateLinkWithOpenAI(affiliateLink: string, options: any = {}) {
   //       try {
   //          // Primeiro, extrair o conteúdo da página usando o método extractPageContent
   //          const limitTokens = 20000;
   //          console.log("Extraindo conteúdo da página...");
   //          let pageContent = options.pageContent;
   //          /*
   //          if (!pageContent) {
   //             pageContent = await this.extractPageContent(affiliateLink);
   //          }
   //             */
   //          const exchanges = await this.getCurrencyRatesInBRL();
   //          const pageText = await this.fetchPageHtmlSource(affiliateLink);

   //          const imgs = await this.extractImageUrls(pageText || "", affiliateLink);

   //          console.log("Conteúdo da página extraído com sucesso");
   //          let treatedString = this.sanitizeString(pageText || "");
   //          treatedString = this.compressText(treatedString);
   //          const accessWeb = treatedString.length > limitTokens;
   //          if (accessWeb) {
   //             treatedString = this.extractRelevantContent(treatedString, 30000) || "";
   //          }
   //          treatedString = treatedString;

   //          const prompt = `
   // Você é um especialista em análise de produtos e e-commerce. Sua tarefa é analisar o conteúdo da página do produto abaixo e **extrair informações exatas do produto**, sem inventar ou inferir valores.

   // 🔗 LINK DO PRODUTO: ${affiliateLink}

   // ACESSAR_WEB: ${accessWeb ? "true" : "false"}

   // AS IMAGENS DO PRODUTO PODEM ESTAR AQUI ( Selecione 10 delas para as medias): ${JSON.stringify(imgs)}
   // 📄 CONTEÚDO EXTRAÍDO DA PÁGINA:
   // ${treatedString}

   // 🎯 OBJETIVO:
   // Com base no conteúdo HTML extraído acima, **extraia exatamente o que está visível**. Especialmente o **preço**, que deve ser coletado diretamente do HTML como está exibido, sem arredondamentos, alterações ou suposições.

   // 📋 INSTRUÇÕES DETALHADAS:
   // 1. Analise o conteúdo extraído da página fornecido acima.
   // 2. Extraia:
   //    - Imagens (use os URLs fornecidos no conteúdo extraído)
   //    - Título, descrição e preço **exatamente como aparecem**
   //    - Características técnicas e comerciais
   //    - Nome da plataforma (Amazon, Shopee, etc.)
   // 3. **NÃO CRIE VALORES.** Apenas extraia do conteúdo fornecido.
   // 4. IMPORTANTE, acesse o link na web para coletar as imagens dos produtos caso elas nao existam no conteudo da pagina (quando vier SEM CONTEUDO PRÉVIO ou com a flag ACCESSAR_WEB : true), não invente placeholders
   // 5. IMPORTANTE: Verifique a moeda dos dados corretamente, identifique a moeda original e então converta para Real R$ brasileiro.

   // Cotações de moedas:
   // ${JSON.stringify(exchanges, null, 2)}

   // ⚠️ REGRAS OBRIGATÓRIAS:
   // - O campo "price" deve conter **exatamente o valor exibido na página (convertido para real brasileiro usando a cotação atual quando estiver em outras moedas)**, como texto convertido para número (ex: R$ 49,90 → 49.9). E sempre ser convertido para real brasileiro, verificando a cotação atual na web.
   // - **Proibido inventar ou estimar preços.**
   // - Se não for possível extrair o preço, retorne \`"price": null\` e adicione um campo \`"priceError": "Motivo da falha"\`.
   // - O campo "cost" deve ser calculado com base em 60-70% do preço extraído (se disponível).
   // - Use as imagens extraídas do conteúdo da página (máximo 10).
   // - Se o produto for digital, use 0 para dimensões e peso.
   // - Rduza a originalDescription para 500 caracteres e o originalTitle para 100 caracteres.
   // IMPORTANTE: a saida precisa sempre ser um JSON válido, com todos os campos obrigatórios preenchidos.

   // 📦 FORMATO DE SAÍDA (JSON):
   // {
   //   "platform": "Shopee",
   //   "originalTitle": "...",
   //   "originalDescription": "...",
   //   "originalPrice": 49.9,
   //   "name": "...",
   //   "description": "...",
   //   "price": 49.9,
   //   "cost": 29.94,
   //   "brand": "...",
   //   "model": "...",
   //   "line": "...",
   //   "material": "...",
   //   "benefits": "...",
   //   "suggestedTags": ["...", "...", "...", "...", "..."],
   //   "height": ...,
   //   "width": ...,
   //   "length": ...,
   //   "weight": ...,
   //   "ncm": "...",
   //   "power": "...",
   //   "consumption": "...",
   //   "capacity": "...",
   //   "guarantee": "...",
   //   "images": ["...", "..."],
   //   "specifications": {
   //     "cor": "...",
   //     "tamanho": "...",
   //     "voltagem": "..."
   //   },
   //   "category": "...",
   //   "subcategory": "...",
   //   "targetAudience": "...",
   //   "sellPoints": "...",
   //   "additionalDetails": "...",
   //   "competitorAnalysis": "...",
   //   "marketPosition": "...",
   //   "recommendedUse": "...",
   //   "warnings": "..."
   // }

   // 📌 LEMBRETES FINAIS:
   // - NÃO CRIE DADOS. Extraia o que está no conteúdo fornecido acima.
   // - Se não conseguir obter o dado do conteúdo extraído, justifique o campo com erro.
   // - Este JSON será usado em produção — **precisão é obrigatória.**
   // - Use APENAS as informações do conteúdo extraído da página fornecido acima.
   //     `;

   //          console.log("Enviando conteúdo extraído para OpenAI analisar...");

   //          const startTime = new Date();
   //          const totalTk = this.contarTokens(prompt);
   //          console.log(`Total de tokens no prompt: ${totalTk}`);
   //          const response = await this.openai.chat.completions.create({
   //             model: MODEL_SELECTED,
   //             messages: [
   //                {
   //                   role: "system",
   //                   content: prompt.trim(),
   //                },
   //             ],
   //             response_format: { type: "json_object" },
   //             temperature: 0,
   //             max_tokens: 4000,
   //          });

   //          this.calculateCost(MODEL_SELECTED, startTime, response);
   //          this.getOpenAIStats();

   //          const content = response.choices[0].message.content || "{}";
   //          let parsedContent;

   //          try {
   //             parsedContent = JSON.parse(content);
   //             console.log("Informações do produto extraídas com sucesso:", parsedContent);
   //          } catch (e) {
   //             console.error("Erro ao fazer parse do JSON da resposta da OpenAI:", e);
   //             console.log("Conteúdo retornado:", content);

   //             parsedContent = {
   //                platform: "Desconhecida",
   //                name: "Produto Afiliado",
   //                description: "Produto importado via link de afiliado",
   //                price: null,
   //                priceError: "Erro ao interpretar resposta da OpenAI",
   //                cost: null,
   //                brand: "Importado",
   //                model: "Afiliado",
   //                line: "Produtos",
   //                material: "Diversos",
   //                benefits: "Qualidade, Durabilidade, Bom custo-benefício",
   //                suggestedTags: ["Afiliado", "Produto", "Oferta", "Qualidade", "Importado"],
   //                height: 10,
   //                width: 10,
   //                length: 10,
   //                weight: 500,
   //                ncm: "00.00.00",
   //                guarantee: "90 dias",
   //                images: [],
   //                additionalDetails: `Link analisado: ${affiliateLink}`,
   //             };
   //          }

   //          parsedContent = this.ensureExactly10Tags(parsedContent);

   //          return parsedContent;
   //       } catch (error: any) {
   //          console.error("Erro ao analisar link com OpenAI:", error);

   //          return {
   //             platform: "Erro",
   //             name: "Produto Afiliado",
   //             description: "Não foi possível extrair informações do link fornecido",
   //             price: null,
   //             priceError: error.message,
   //             cost: null,
   //             brand: "Desconhecido",
   //             model: "Erro",
   //             line: "Produtos",
   //             material: "Diversos",
   //             benefits: "Produto de afiliado",
   //             suggestedTags: ["Afiliado", "Produto", "Link", "Erro", "Importado"],
   //             height: 10,
   //             width: 10,
   //             length: 10,
   //             weight: 500,
   //             ncm: "00.00.00",
   //             guarantee: "90 dias",
   //             images: [],
   //             additionalDetails: `Erro ao processar link: ${affiliateLink}. Erro: ${error.message}`,
   //          };
   //       }
   //    }

   pegar80PorCento(texto: string) {
      const tamanho = Math.floor(texto.length * 0.7);
      return texto.slice(0, tamanho);
   }
   private async analyzeAffiliateLinkWithOpenAI(affiliateLink: string, options: any = {}) {
      try {
         const limitTokens = 30000; // Reduzido para evitar overflow
         console.info("🌐 [Affiliate Link]: Extracting page content...");

         // 1. Extrair dados SEO estilo WhatsApp primeiro
         let seoData = null;
         try {
            console.info("🔗 [Affiliate Link]: Extracting SEO data for additional context...");
            seoData = await this.extractWhatsAppStyleLinkPreview(affiliateLink);
            console.info("✅ [Affiliate Link]: SEO data extracted successfully");
         } catch (error) {
            console.warn("⚠️ [Affiliate Link]: SEO extraction failed, continuing without SEO context:", error);
         }

         // 2. Verificar se é uma loja chinesa e extrair dados específicos
         let chineseProductData = null;
         const hostname = new URL(affiliateLink).hostname.toLowerCase();

         if (hostname.includes("aliexpress.com") || hostname.includes("shein.com") || hostname.includes("shopee.com")) {
            try {
               console.info(`🏪 [Affiliate Link]: Detected Chinese store, extracting data: ${hostname}`);
               chineseProductData = await this.chineseStoresExtractor.extractProductData(affiliateLink);
               console.info(`✅ [Affiliate Link]: Chinese store data extracted successfully`);
            } catch (error) {
               console.warn(`⚠️ [Affiliate Link]: Chinese store extraction failed, falling back to HTML:`, error);
            }
         }

         let pageContent = options.pageContent;
         // const exchanges = await this.getCurrencyRatesInBRL();
         const pageText = await this.fetchPageHtmlSource(affiliateLink);
         const basicExtract = this.basicProductExtractor.extractBasic(pageText || "", affiliateLink);
         const tt = await this.extractDataFromPage.execute(affiliateLink);
         // SUBSTITUIR AQUI - IMPLEMENTAÇÃO ANTIGA COMENTADA
         // let imgs = await this.extractImageUrls(pageText || "", affiliateLink);
         // const imagesFromOpenai = await this.extractImagesFromOpenai(JSON.stringify(imgs) || "", affiliateLink);
         // imgs = imagesFromOpenai;

         // Log removido para reduzir verbosidade

         // NOVA IMPLEMENTAÇÃO: Usar API de extração de imagens (exceto Mercado Livre)
         const isMercadoLivre =
            hostname.includes("mercadolivre.com") ||
            hostname.includes("mercadolibre.com") ||
            (options && options.isMercadoLivre === true);
         let imgs: string[] = [];

         try {
            // Usar a API de extração de imagens (configurada via EXTRACTOR env)
            imgs = await this.extractImageUrls(pageText || "", affiliateLink);
            console.info(`🔄 [Affiliate Link]: Extracted ${imgs.length} images using ImageExtractor`);
         } catch (error) {
            console.warn(`⚠️ [Affiliate Link]: Image extraction failed, using empty array:`, error);
            imgs = [];
         }

         // SEMPRE adicionar imagem SEO como primeira para TODOS os sites (incluindo Mercado Livre)
         if (seoData?.image) {
            // Remover a imagem SEO se já existir no array para evitar duplicatas
            imgs = imgs.filter((img) => img !== seoData.image);
            // Adicionar como primeira imagem
            imgs.unshift(seoData.image);
            console.info(`✅ [Affiliate Link]: SEO image added as first image for all sites`);
         }

         // fim do substituir

         console.info("✅ [Affiliate Link]: Page content extracted successfully");
         let treatedString = this.sanitizeString(pageText || "");
         treatedString = this.compressText(treatedString);

         const accessWeb = treatedString.length > limitTokens;
         if (accessWeb) {
            treatedString = this.extractRelevantContent(treatedString, limitTokens) || "";
         }

         // Prompt mais conciso e direto
         const prompt = `Analise esta página de produto e retorne um JSON válido com as informações extraídas.

LINK: ${affiliateLink}  
CONTEÚDO:
${this.pegar80PorCento(treatedString)} 
${
   seoData && seoData.title
      ? `
🔗 DADOS SEO EXTRAÍDOS (ESTILO WHATSAPP):
- Título SEO: ${seoData.title}
- Descrição SEO: ${seoData.description || "N/A"}
- Imagem Principal: ${seoData.image ? "Disponível" : "N/A"}
- Domínio: ${seoData.domain}
- Qualidade do Preview: ${seoData.previewQuality}
- Fonte: ${seoData.source}

Use estes dados SEO como contexto adicional para melhorar a extração do produto.
`
      : ""
}
${
   chineseProductData
      ? `
🏪 DADOS DE LOJA CHINESA EXTRAÍDOS:
- Título: ${chineseProductData.title}
- Preço: ${chineseProductData.price}
- Preço Original: ${chineseProductData.originalPrice || "N/A"}
- Descrição: ${chineseProductData.description}
- Vendedor: ${chineseProductData.store}
- Plataforma: ${chineseProductData.store}
- Imagens: ${chineseProductData.images.length} URLs disponíveis

Use estes dados como fonte primária de informação, pois foram extraídos diretamente da API da loja.
`
      : ""
}

📎 DADOS PRÉ-EXTRAÍDOS (ANALISAR E VALIDAR, NÃO INVENTAR):
- Título (pré): ${basicExtract.title || ""}
- Descrição (pré): ${basicExtract.description || ""}
- Preço texto (pré): ${basicExtract.priceText || ""}
- Preço número (pré): ${basicExtract.priceNumber ?? ""}
- Moeda (pré): ${basicExtract.currency || ""}
- Vendedor (pré): ${basicExtract.seller || ""}

REGRAS INICIAIS:
- Extraia dados exatos da página, não invente 
- Use os dados SEO como contexto adicional quando disponíveis
- Priorize dados de loja chinesa quando disponíveis
- Descrições máximo 300 caracteres
- Títulos máximo 80 caracteres
- Se não encontrar preço, use null
- Retorne apenas JSON válido 

 ⚠️ REGRAS OBRIGATÓRIAS:
 - O campo "price" deve conter **exatamente o valor exibido na página**, como texto convertido para número (ex: R$ 49,90 → 49.9).
 - **Proibido inventar ou estimar preços.**
 - Se não for possível extrair o preço, retorne \`"price": null\` e adicione um campo \`"priceError": "Motivo da falha"\`.
 - O campo "cost" deve ser calculado com base em 60-70% do preço extraído (se disponível).
 - Devolva sempre um array vazio em imagens.
 - Se o produto for digital, use 0 para dimensões e peso.
 - Rduza a originalDescription para 500 caracteres e o originalTitle para 100 caracteres.

📌 REGRAS PARA TAGS (suggestedTags):
- Gere EXATAMENTE 10 tags, SEMPRE.
- SEMPRE TEREMOS UMA TAG DENTRO QUE SERÁ O NOME DO PRODUTO, FAÇA A PRIMEIRA DELAS SER O NOME, QUE COMPOE AS PRIMEIRAS PALAVRAS DA DESCRICAO DO PRODUTO NORMALMENTE.
- As 10 tags devem ser derivadas exclusivamente do título e da descrição. Não invente.
- Importante ter pelo menos uma tag com o nome do produto e o modelo do produto!
- Pelo menos uma tag de nome deve conter o nome e o modelo do produto e alguma outra caracteristica relevante, exemplo: "Notebook Samsung Galaxy Book 3 Pro 360".
- Dê prioridade a Marca, Cor, Tamanho (se explícitos), Materiais, Público, Uso/Ocasão, Características e Especificações técnicas; sempre extraindo do conteúdo.
- Tags devem ser valores diretos, sem prefixos. Ex.: "Sony", "Branco", "Tamanho M", "1TB", "SSD", "DualSense".
- Evite duplicação; normalize capitalização conforme exemplos.
- Se faltar informação explícita, derive termos do próprio texto para completar as 10 tags (sem extrapolar além do que está escrito).

${
   chineseProductData
      ? `
🏪 REGRAS ESPECÍFICAS PARA LOJAS CHINESAS:
- Use o título extraído da API como fonte primária para "name" e "originalTitle"
- Use o preço extraído da API como fonte primária para "price"
- Use a descrição extraída da API como fonte primária para "description" e "originalDescription"
- Use o vendedor extraído da API para "brand" se disponível
- As imagens serão adicionadas automaticamente pelo sistema
- Priorize os dados da API sobre o conteúdo HTML extraído
`
      : ""
}

 IMPORTANTE: a saida precisa sempre ser um JSON válido, com todos os campos obrigatórios preenchidos. 
 
  
 📌 LEMBRETES FINAIS:
 - NÃO CRIE DADOS. Extraia o que está no conteúdo fornecido acima.
 - Se não conseguir obter o dado do conteúdo extraído, justifique o campo com erro.
 - Este JSON será usado em produção — **precisão é obrigatória.**
 - Use APENAS as informações do conteúdo extraído da página fornecido acima.

📌 REGRAS PARA BENEFITS (pontos fortes do produto):
- Extraia 3-5 pontos fortes do produto que motivem o usuário a comprar
- Base-se APENAS nas informações reais do produto (descrição, características, avaliações se houver)
- NÃO invente benefícios. Se não houver informações suficientes, retorne string vazia
- Formato: lista com marcadores, exemplo: "• Alta durabilidade\n• Design moderno\n• Fácil instalação"
- Foque em benefícios práticos e diferenciais do produto
- Máximo 200 caracteres

FORMATO OBRIGATÓRIO:
{
  "platform": "string",
  "originalTitle": "string (max 80 chars)",
  "originalDescription": "string (max 300 chars)", 
  "name": "string (max 100 chars)",
  "description": "string (max 500 chars)",
  "benefits": "string (max 200 chars, formato lista com marcadores ou vazio se não houver informações)",
  "price": number | null,
  "cost": number | null,
  "brand": "string",
  "model": "string",
  "suggestedTags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "height": number,
  "width": number, 
  "length": number,
  "weight": number,
  "images": [] (mantenha sempre um array vazio),
  "category": "string",
  "subcategory": "string"
}`;

         const startTime = new Date();
         const totalTk = this.contarTokens(prompt);

         const response = await this.openai.chat.completions.create({
            model: MODEL_SELECTED,
            messages: [
               {
                  role: "system",
                  content:
                     "Você é um extrator de dados de produtos. Retorne apenas JSON válido com os dados solicitados.",
               },
               {
                  role: "user",
                  content: prompt.trim(),
               },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 4000,
         });

         this.calculateCost(MODEL_SELECTED, startTime, response);
         this.getOpenAIStats();

         // Detectar truncamento e tentar um retry mais compacto
         const firstChoice = response.choices && response.choices[0];
         let content = (firstChoice && firstChoice.message && firstChoice.message.content) || "{}";
         const finishReason = firstChoice && (firstChoice as any).finish_reason;
         if (finishReason === "length" || (typeof content === "string" && !content.trim().endsWith("}"))) {
            console.warn("⚠️ [Affiliate Link]: Resposta possivelmente truncada. Retentando com prompt compacto...");
            const compactPrompt = `${prompt}\n\nATENÇÃO: Sua resposta anterior foi truncada. Responda AGORA APENAS com um JSON válido, compacto, sem comentários, sem markdown e com campos curtos.`;
            const retryStart = new Date();
            const retryResponse = await this.openai.chat.completions.create({
               model: MODEL_SELECTED,
               messages: [
                  { role: "system", content: "Você retorna somente JSON válido, nada além disso." },
                  { role: "user", content: compactPrompt.trim() },
               ],
               response_format: { type: "json_object" },
               temperature: 0,
               max_tokens: 4000,
            });
            this.calculateCost(MODEL_SELECTED, retryStart, retryResponse);
            const retryChoice = retryResponse.choices && retryResponse.choices[0];
            content = (retryChoice && retryChoice.message && retryChoice.message.content) || content;
         }

         // Validação e parse robustos do JSON
         let parsedContent: any;
         try {
            parsedContent = this.safeParseJson(content);
         } catch (parseError: any) {
            console.error("❌ [AffiliateLink]: Parse error:", parseError.message);
            throw new Error(`Falha ao interpretar resposta da AI: ${parseError.message}`);
         }

         // Usar imagens das lojas chinesas se disponíveis, senão usar as extraídas do HTML
         if (chineseProductData && chineseProductData.images && chineseProductData.images.length > 0) {
            parsedContent.images = chineseProductData.images;
            console.info(
               `🏪 [Affiliate Link]: Using ${chineseProductData.images.length} images from Chinese store API`
            );
         } else {
            parsedContent.images = imgs;
            console.info(`🌐 [Affiliate Link]: Using ${imgs.length} images from HTML extraction`);
         }

         // Aplicar dados pré-extraídos como fallback seguro (prioridade: SEO > basicExtract)
         if (!parsedContent.name) {
            parsedContent.name = seoData?.title || basicExtract.title || "Produto";
         }
         if (!parsedContent.originalTitle) {
            parsedContent.originalTitle = seoData?.title || basicExtract.title || "Produto";
         }
         if (!parsedContent.description || parsedContent.description.length < 10) {
            parsedContent.description = seoData?.description || basicExtract.description || "Descrição não disponível";
         }
         if (parsedContent.price == null && basicExtract.priceNumber != null) {
            parsedContent.price = basicExtract.priceNumber;
         }
         if (!parsedContent.brand && basicExtract.seller) {
            parsedContent.brand = basicExtract.seller;
         }

         // Usar imagem SEO como fallback se não houver outras imagens
         if ((!parsedContent.images || parsedContent.images.length === 0) && seoData?.image) {
            console.info("🔗 [Affiliate Link]: Using SEO image as fallback");
            parsedContent.seoImage = seoData.image;
         }

         // Encurtar campos longos para evitar truncamentos em respostas futuras
         parsedContent.originalTitle = this.truncateString(
            parsedContent.originalTitle ?? basicExtract.title ?? "",
            100
         );
         parsedContent.name = this.truncateString(parsedContent.name ?? basicExtract.title ?? "", 100);
         parsedContent.originalDescription = this.truncateString(
            parsedContent.originalDescription ?? basicExtract.description ?? "",
            300
         );
         parsedContent.description = this.truncateString(
            parsedContent.description ?? basicExtract.description ?? "",
            500
         );

         // Validação dos campos obrigatórios
         const requiredFields = ["platform", "name", "description", "price"];
         const missingFields = requiredFields.filter((field) => parsedContent[field] === undefined);
         if (missingFields.length > 0) {
            throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(", ")}`);
         }

         // Garantir que suggestedTags tenha exatamente 10 itens
         parsedContent = this.ensureExactly10Tags(parsedContent);

         // Calcular cost se price estiver disponível
         if (parsedContent.price && typeof parsedContent.price === "number") {
            parsedContent.cost = Math.round(parsedContent.price * 0.65 * 100) / 100;
         }

         // Garantir que imagens seja sempre array
         if (!Array.isArray(parsedContent.images)) {
            parsedContent.images = Array.isArray(imgs) ? imgs : [];
         }

         return parsedContent;
      } catch (error: any) {
         console.error("Erro ao analisar link:", error);

         // Retornar erro estruturado ao invés de produto falso
         throw new Error(`Falha na análise do produto: ${error.message}`);
      }
   }

   // Método auxiliar para tentar limpar JSON malformado
   private tryCleanJson(content: string): string | null {
      try {
         // Remove caracteres de controle e espaços extras
         let cleaned = content.replace(/[\x00-\x1F\x7F]/g, "").trim();

         // Se não começa com {, tenta encontrar o primeiro {
         const startIndex = cleaned.indexOf("{");
         if (startIndex > 0) {
            cleaned = cleaned.substring(startIndex);
         }

         // Se não termina com }, tenta encontrar o último }
         const endIndex = cleaned.lastIndexOf("}");
         if (endIndex > 0 && endIndex < cleaned.length - 1) {
            cleaned = cleaned.substring(0, endIndex + 1);
         }

         // Tenta validar se é um JSON válido
         JSON.parse(cleaned);
         return cleaned;
      } catch (error) {
         return null;
      }
   }

   // Parser robusto com fallback para tryCleanJson
   private safeParseJson(content: string): any {
      try {
         return JSON.parse(content);
      } catch (err) {
         const cleaned = this.tryCleanJson(content);
         if (cleaned) {
            return JSON.parse(cleaned);
         }
         throw err;
      }
   }

   private truncateString(text: string, max: number): string {
      if (typeof text !== "string") return "";
      if (text.length <= max) return text;
      return text.slice(0, max);
   }

   /**
    * Extrai dados de link preview estilo WhatsApp usando SEO meta tags
    * Funciona como apps de mensagem fazem para mostrar preview de links
    * @param url URL para extrair dados
    * @returns Dados do link preview (título, descrição, imagem)
    */
   async extractWhatsAppStyleLinkPreview(url: string): Promise<any> {
      try {
         console.info("🔗 [Link Preview]: Extraindo dados estilo WhatsApp para:", url);

         // Usar o extractor SEO via API
         const extractorUrl = process.env.EXTRACTOR;
         const response = await fetch(`${extractorUrl}/extract-seo`, {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
            },
            body: JSON.stringify({ url }),
         });

         if (!response.ok) {
            throw new Error(`Extractor API error: ${response.status}`);
         }

         const seoData = await response.json();
         console.info("✅ [Link Preview]: Dados SEO extraídos com sucesso");

         // Formatar dados para uso consistente
         const linkPreview = {
            url: seoData.url || url,
            title: seoData.title || "Link",
            description: seoData.description || "",
            image: seoData.image || null,
            source: seoData.source || "unknown",
            extractedAt: new Date().toISOString(),
            // Campos adicionais úteis
            domain: new URL(url).hostname,
            hasImage: !!seoData.image,
            hasDescription: !!seoData.description,
            previewQuality: this.calculatePreviewQuality(seoData),
         };

         console.info("📋 [Link Preview]: Preview gerado:", {
            title: linkPreview.title.substring(0, 50) + "...",
            hasImage: linkPreview.hasImage,
            hasDescription: linkPreview.hasDescription,
            quality: linkPreview.previewQuality,
         });

         return linkPreview;
      } catch (error: any) {
         console.error("❌ [Link Preview]: Erro ao extrair dados:", error);

         // Fallback básico usando apenas a URL
         return {
            url,
            title: new URL(url).hostname,
            description: `Link para ${new URL(url).hostname}`,
            image: null,
            source: "fallback",
            extractedAt: new Date().toISOString(),
            domain: new URL(url).hostname,
            hasImage: false,
            hasDescription: false,
            previewQuality: "low",
            error: error.message,
         };
      }
   }

   /**
    * Calcula a qualidade do preview baseado nos dados disponíveis
    * @private
    */
   private calculatePreviewQuality(seoData: any): string {
      let score = 0;

      if (seoData.title && seoData.title.length > 10) score += 30;
      if (seoData.description && seoData.description.length > 20) score += 30;
      if (seoData.image) score += 40;

      if (score >= 80) return "high";
      if (score >= 50) return "medium";
      return "low";
   }

   /**
    * Extrai dados completos de um link (SEO + imagens de produto se aplicável)
    * Combina link preview com extração de produto quando possível
    * @param url URL para extrair dados completos
    * @returns Dados completos do link
    */
   async extractComprehensiveLinkData(url: string): Promise<any> {
      try {
         console.info("🔍 [Comprehensive]: Extraindo dados completos para:", url);

         // 1. Extrair dados básicos de link preview
         const linkPreview = await this.extractWhatsAppStyleLinkPreview(url);

         // 2. Verificar se é um link de e-commerce e extrair dados de produto
         const isEcommerce = this.isEcommerceUrl(url);
         let productData = null;

         if (isEcommerce) {
            try {
               console.info("🛍️ [Comprehensive]: Detectado e-commerce, extraindo dados de produto...");
               productData = await this.analyzeAffiliateLinkWithOpenAI(url);
               console.info("✅ [Comprehensive]: Dados de produto extraídos");
            } catch (error) {
               console.warn("⚠️ [Comprehensive]: Falha na extração de produto, continuando com SEO apenas");
            }
         }

         // 3. Combinar dados
         const comprehensiveData = {
            ...linkPreview,
            isEcommerce,
            productData,
            extractionType: productData ? "product_and_seo" : "seo_only",
            // Se temos dados de produto, usar imagens do produto
            images: productData?.images || (linkPreview.image ? [linkPreview.image] : []),
            // Usar título do produto se disponível
            title: productData?.name || linkPreview.title,
            // Usar descrição do produto se disponível
            description: productData?.description || linkPreview.description,
            // Dados específicos de produto (se disponível)
            price: productData?.price || null,
            brand: productData?.brand || null,
            category: productData?.category || null,
         };

         console.info("🎯 [Comprehensive]: Extração completa finalizada:", {
            type: comprehensiveData.extractionType,
            hasProduct: !!productData,
            imagesCount: comprehensiveData.images.length,
         });

         return comprehensiveData;
      } catch (error: any) {
         console.error("❌ [Comprehensive]: Erro na extração completa:", error);
         throw error;
      }
   }

   /**
    * Verifica se uma URL é de e-commerce
    * @private
    */
   private isEcommerceUrl(url: string): boolean {
      const hostname = new URL(url).hostname.toLowerCase();
      const ecommercePatterns = [
         "amazon.com",
         "mercadolivre.com",
         "mercadolibre.com",
         "aliexpress.com",
         "shopee.com",
         "shein.com",
         "americanas.com",
         "casasbahia.com",
         "kabum.com",
         "magazineluiza.com",
         "extra.com",
         "submarino.com",
      ];

      return ecommercePatterns.some((pattern) => hostname.includes(pattern));
   }

   /**
    * Garante que o produto tenha exatamente 10 tags
    * Obrigatório ter: 1 tag de marca, 2 tags de cor, 1 tag de segmento, as demais conforme conteúdo
    * @private
    */
   private ensureExactly10Tags(productInfo: any) {
      if (!productInfo.suggestedTags || !Array.isArray(productInfo.suggestedTags)) {
         productInfo.suggestedTags = [];
      }

      // Apenas normaliza e deduplica as tags vindas do modelo e limita a 10.
      const seen = new Set<string>();
      const normalized: string[] = [];
      for (const t of productInfo.suggestedTags) {
         const val = (t || "").toString().trim();
         if (!val) continue;
         const isRoman = /^[ivxlcdm]+$/i.test(val);
         if (isRoman) continue;
         const key = val.toLowerCase();
         if (!seen.has(key)) {
            seen.add(key);
            normalized.push(val);
         }
      }

      productInfo.suggestedTags = normalized.slice(0, 10);
      return productInfo;
   }

   /**
    * Prepara array de mídias para o produto
    * @private
    */
   private prepareMedias(images: string[] = []): any[] {
      const validImages = images.filter((url) => url && url.startsWith("http"));

      if (validImages.length === 0) {
         return [
            {
               url: "https://via.placeholder.com/800x800?text=Produto+Afiliado",
            },
         ];
      }

      // Priorizar imagens de alta qualidade
      const prioritizedImages = validImages
         .map((url) => {
            let score = 0;
            const lowerUrl = url.toLowerCase();

            // Pontuar baseado na URL
            if (lowerUrl.includes("1200") || lowerUrl.includes("1000")) score += 30;
            else if (lowerUrl.includes("800") || lowerUrl.includes("high")) score += 25;
            else if (lowerUrl.includes("SX679") || lowerUrl.includes("high")) score += 25;
            else if (lowerUrl.includes("600") || lowerUrl.includes("medium")) score += 20;
            else if (lowerUrl.includes("400") || lowerUrl.includes("small")) score += 15;
            else score += 10;

            // Bonus para URLs que indicam alta qualidade
            if (lowerUrl.includes("original") || lowerUrl.includes("full")) score += 15;
            if (lowerUrl.includes("hd") || lowerUrl.includes("high")) score += 10;
            if (lowerUrl.includes("zoom") || lowerUrl.includes("detail")) score += 8;

            // Penalizar URLs de baixa qualidade
            if (lowerUrl.includes("thumb") || lowerUrl.includes("mini")) score -= 10;
            if (lowerUrl.includes("icon") || lowerUrl.includes("logo")) score -= 15;

            return { url, score };
         })
         .sort((a, b) => b.score - a.score) // Ordenar por score decrescente
         .slice(0, 100) // Pegar as 10 melhores
         .map((item) => ({ url: item.url }));

      return prioritizedImages;
   }

   /**
    * Procura ou cria exatamente 10 tags com categorias obrigatórias e retorna apenas seus IDs
    * ETAPA 1: Cria tags exatamente como a LLM sugeriu (não altera)
    * ETAPA 2: Usa LLM novamente para categorizar perfeitamente as tags
    * @private
    */
   private async findOrCreateExactly10TagIds(suggestedTags: string[] = [], productContext?: string): Promise<number[]> {
      const tagIds: number[] = [];
      const createdTagNames: string[] = [];
      const tagsToCategorizeName: string[] = [];

      console.info(`🏷️ [Tag Processing]: ETAPA 1 - Criando ${suggestedTags.length} tags da LLM (SEM ALTERAÇÃO)`);

      // ETAPA 1: Criar tags EXATAMENTE como a LLM sugeriu (não alterar nada)
      for (let i = 0; i < suggestedTags.length; i++) {
         const tagName = suggestedTags[i];
         try {
            // Procurar tag existente
            let tag = await this.prismaClient.tag.findFirst({
               where: { name: tagName },
               include: { category: true, subcategory: true },
            });

            if (!tag) {
               // Criar tag SEM categoria (será atribuída na etapa 2)
               tag = await this.prismaClient.tag.create({
                  data: {
                     name: tagName,
                  },
                  include: { category: true, subcategory: true },
               });
               console.info(`✅ [Tag Processing]: Nova tag criada: "${tagName}" (ID: ${tag.id})`);
               createdTagNames.push(tagName);
               tagsToCategorizeName.push(tagName);
            } else {
               console.info(
                  `🔄 [Tag Processing]: Tag existente encontrada: "${tagName}" (ID: ${tag.id}) - Categoria: ${
                     tag.category?.name || "Sem categoria"
                  }`
               );

               // Se a tag existente não tem categoria, adicionar para categorização
               if (!tag.categoryId || !tag.subcategoryId) {
                  tagsToCategorizeName.push(tagName);
                  console.info(`📝 [Tag Processing]: Tag "${tagName}" sem categoria - será categorizada na ETAPA 2`);
               }
            }

            tagIds.push(tag.id);
         } catch (error) {
            console.error(`❌ [Tag Processing]: Erro ao processar tag "${tagName}":`, error);

            // Fallback para tag genérica
            try {
               const fallbackTag = await this.prismaClient.tag.create({
                  data: {
                     name: `Tag_${Math.floor(Math.random() * 10000)}`,
                  },
               });
               tagIds.push(fallbackTag.id);
               createdTagNames.push(fallbackTag.name);
               tagsToCategorizeName.push(fallbackTag.name);
            } catch (fallbackError) {
               console.error("❌ [Tag Processing]: Erro crítico ao criar tag alternativa:", fallbackError);
            }
         }
      }

      console.info(`✅ [Tag Processing]: ETAPA 1 COMPLETA - ${tagIds.length} tags criadas/encontradas`);

      // ETAPA 2: Usar LLM para categorizar PERFEITAMENTE as tags sem categoria
      if (tagsToCategorizeName.length > 0) {
         console.info(
            `🤖 [Tag Processing]: ETAPA 2 - Categorizando ${tagsToCategorizeName.length} tags com IA inteligente`
         );

         try {
            // Chamar LLM para categorização inteligente
            const categorizations = await intelligentTagCategorization(this.openai, {
               tags: tagsToCategorizeName,
               productContext,
            });

            // Aplicar categorizações ao banco
            const categorizationMap = await applyTagCategorization(categorizations);

            // Atualizar tags com categorias e subcategorias
            for (const tagName of tagsToCategorizeName) {
               const categorization = categorizationMap.get(tagName);
               if (categorization) {
                  try {
                     await this.prismaClient.tag.updateMany({
                        where: { name: tagName },
                        data: {
                           categoryId: categorization.categoryId,
                           subcategoryId: categorization.subcategoryId,
                        },
                     });

                     console.info(
                        `✅ [Tag Processing]: Tag "${tagName}" categorizada com sucesso (Category ID: ${categorization.categoryId}, Subcategory ID: ${categorization.subcategoryId})`
                     );
                  } catch (updateError) {
                     console.error(`❌ [Tag Processing]: Erro ao atualizar tag "${tagName}":`, updateError);
                  }
               }
            }

            console.info(`✅ [Tag Processing]: ETAPA 2 COMPLETA - Tags categorizadas com IA`);
         } catch (error) {
            console.error("❌ [Tag Processing]: Erro na categorização inteligente:", error);
            console.warn("⚠️ [Tag Processing]: Continuando sem categorização inteligente");
         }
      }

      // Pós-processamento: para categoria "Nome de produto", prefixar subcategoria ao nome da tag
      try {
         const detailedTags = await this.prismaClient.tag.findMany({
            where: { id: { in: tagIds } },
            include: { category: true, subcategory: true },
         });

         const idReplacementMap = new Map<number, number>();

         for (const tag of detailedTags) {
            const categoryName = tag.category?.name || "";
            const subcategoryName = tag.subcategory?.name?.trim();
            if (subcategoryName && categoryName.toLowerCase().includes("nome do produto")) {
               const alreadyPrefixed = tag.name.toLowerCase().startsWith(`${subcategoryName.toLowerCase()} `);
               const newName = alreadyPrefixed ? tag.name : `${subcategoryName} ${tag.name}`;

               if (!alreadyPrefixed) {
                  try {
                     await this.prismaClient.tag.update({
                        where: { id: tag.id },
                        data: { name: newName },
                     });
                     console.info(`🔧 [Tag Processing]: Renamed product name tag "${tag.name}" -> "${newName}"`);
                  } catch (e: any) {
                     // Conflito de nome (único). Reutilizar tag existente, se houver
                     try {
                        const existing = await this.prismaClient.tag.findFirst({
                           where: { name: newName },
                           select: { id: true },
                        });
                        if (existing) {
                           idReplacementMap.set(tag.id, existing.id);
                           console.info(`♻️ [Tag Processing]: Using existing tag id ${existing.id} for "${newName}"`);
                        }
                     } catch (_) {}
                  }
               }
            }
         }

         if (idReplacementMap.size > 0) {
            for (let i = 0; i < tagIds.length; i++) {
               const replacement = idReplacementMap.get(tagIds[i]);
               if (replacement) tagIds[i] = replacement;
            }
         }
      } catch (postError) {
         console.warn("⚠️ [Tag Processing]: Post-processing product name tags failed:", postError);
      }

      console.info(`🎉 [Tag Processing]: PROCESSO COMPLETO - ${tagIds.length} tags prontas: ${tagIds.join(", ")}`);
      return tagIds;
   }

   /**
    * Determina a categoria apropriada para uma tag de produto
    */
   private determineProductTagCategory(tagName: string, index: number, defaultTags: any[]): string {
      // Normalizações e heurísticas para valores sem prefixo
      const raw = (tagName || "").trim();
      const lower = raw.toLowerCase();

      // Tamanho: manter padrão "Tamanho X"
      if (raw.startsWith("Tamanho ")) return "Tamanho";

      // Cores comuns em PT-BR
      const colors = new Set([
         "preto",
         "branco",
         "cinza",
         "vermelho",
         "azul",
         "verde",
         "amarelo",
         "rosa",
         "roxo",
         "marrom",
         "laranja",
         "bege",
         "dourado",
         "prata",
         "turquesa",
         "bordô",
         "vinho",
         "off white",
      ]);
      if (colors.has(lower)) return "Cor";

      // Segmento de preço
      const priceSegments = new Set([
         "econômico",
         "economico",
         "intermediário",
         "intermediario",
         "luxo",
         "premium",
         "prime",
      ]);
      if (priceSegments.has(lower)) return "Segmento de Preço";

      // Heurística simples p/ Fabricante e Marca
      const manufacturerHints = [
         "group",
         "corp",
         "co.",
         "company",
         "industria",
         "indústria",
         "fabricante",
         "ltda",
         "s.a.",
      ];
      if (manufacturerHints.some((h) => lower.includes(h))) return "Fabricante";

      // Heurística: palavra com inicial maiúscula única → provável Marca
      const isSingleWord = raw.split(/\s+/).length === 1;
      const looksLikeProperNoun = /^[A-ZÁÂÃÀÉÊÍÎÓÔÕÚÇ][a-záâãàéêíîóôõúç0-9\-]+$/.test(raw);
      if (isSingleWord && looksLikeProperNoun) return "Marca";

      // Mapeamento de tags para categorias específicas de produtos
      const tagCategoryMapping: { [key: string]: string } = {
         // Tipos de Colaboração
         Afiliado: "Tipos de Colaboração",
         Oferta: "Tipos de Colaboração",
         Parceria: "Tipos de Colaboração",
         Promoção: "Tipos de Colaboração",
         Desconto: "Tipos de Colaboração",
         Cupom: "Tipos de Colaboração",

         // Tipo de Conteúdo
         Produto: "Tipo de Conteúdo",
         Importado: "Tipo de Conteúdo",
         Nacional: "Tipo de Conteúdo",
         Digital: "Tipo de Conteúdo",
         Físico: "Tipo de Conteúdo",

         // Especialidades
         Qualidade: "Especialidades",
         Premium: "Especialidades",
         Exclusivo: "Especialidades",
         Limitado: "Especialidades",
         "Edição Especial": "Especialidades",

         // Nicho de Atuação
         Tecnologia: "Nicho de Atuação",
         Moda: "Nicho de Atuação",
         Beleza: "Nicho de Atuação",
         Saúde: "Nicho de Atuação",
         Gastronomia: "Nicho de Atuação",
         Turismo: "Nicho de Atuação",
         Lifestyle: "Nicho de Atuação",
         Jogos: "Nicho de Atuação",
         Educação: "Nicho de Atuação",
         Negócios: "Nicho de Atuação",
         Empreendedorismo: "Nicho de Atuação",
         Arte: "Nicho de Atuação",
         Cultura: "Nicho de Atuação",
         Música: "Nicho de Atuação",
         Cinema: "Nicho de Atuação",
         Esportes: "Nicho de Atuação",
         Automóveis: "Nicho de Atuação",
         Pets: "Nicho de Atuação",
         Decoração: "Nicho de Atuação",
         Arquitetura: "Nicho de Atuação",
         Família: "Nicho de Atuação",
         Finanças: "Nicho de Atuação",
         Investimentos: "Nicho de Atuação",
         Produtividade: "Nicho de Atuação",
         "Desenvolvimento Pessoal": "Nicho de Atuação",
         "Bem-estar": "Nicho de Atuação",
         Sustentabilidade: "Nicho de Atuação",
         Comédia: "Nicho de Atuação",
         Humor: "Nicho de Atuação",

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

         // Plataformas
         Amazon: "Plataformas",
         "Mercado Livre": "Plataformas",
         Shopee: "Plataformas",
         AliExpress: "Plataformas",
         Shein: "Plataformas",
         "Magazine Luiza": "Plataformas",
         Americanas: "Plataformas",
         "Casas Bahia": "Plataformas",
         Extra: "Plataformas",
         "Ponto Frio": "Plataformas",
         Netshoes: "Plataformas",
         Dafiti: "Plataformas",
         Zattini: "Plataformas",
         Walmart: "Plataformas",
         Carrefour: "Plataformas",
         Hotmart: "Plataformas",
         Eduzz: "Plataformas",
         Monetizze: "Plataformas",
      };

      // Verificar se a tag tem categoria mapeada
      if (tagCategoryMapping[tagName]) {
         return tagCategoryMapping[tagName];
      }

      // Se não tem mapeamento, usar categoria padrão baseada no índice
      const defaultCategories = [
         "Marca",
         "Cor",
         "Segmento de Preço",
         "Fabricante",
         "Tamanho",
         "Tipos de Colaboração",
         "Tipo de Conteúdo",
         "Nicho de Atuação",
         "Especialidades",
         "Plataformas",
      ];
      return defaultCategories[index % defaultCategories.length];
   }

   /**
    * Método que cria um vídeo e retorna links de produtos detectados sem criar os produtos
    * @param {User} user - Usuário autenticado
    * @param {object} body - { videoLink: string, description?: string }
    * @returns {Promise<{video: object, productLinks: string[], message: string}>}
    */
   async productAndVideo(user: any, body: any) {
      const { videoLink, description = null } = body;
      let videoMetadata = null;

      if (videoLink.includes("youtube.com")) {
         videoMetadata = await this.ytServices.fetchVideoData(videoLink);
      }

      try {
         const video = await this.createDexdTvVideoWithAIAndTags(user, videoLink, description, videoMetadata);
         const productLinks = await this.extractProductLinksFromVideoContent(videoLink, video, videoMetadata);

         return {
            video: video,
            productLinks: productLinks || [],
            message:
               productLinks && productLinks.length > 0
                  ? `Vídeo criado com sucesso! ${productLinks.length} link(s) de produto detectado(s).`
                  : "Vídeo criado com sucesso!",
         };
      } catch (error) {
         console.error("❌ [AffiliateLink]: Video processing error:", error);
         throw error;
      }
   }

   /**
    * Cria um vídeo na tabela dexd_tv_videos usando IA com sistema de tags
    * @private
    */
   private async createDexdTvVideoWithAIAndTags(
      user: any,
      videoLink: string,
      description?: string,
      videoMetadata?: any
   ): Promise<any> {
      try {
         // Extrair conteúdo da página do vídeo
         let pageContent = null;
         if (!videoMetadata) {
            try {
               pageContent = await this.extractPageContent(videoLink);
            } catch (error) {
               console.warn("⚠️ [AffiliateLink]: Error extracting page content:", error);
            }
         } else {
            pageContent = videoMetadata;
         }

         // Usar IA para extrair informações do vídeo
         const videoInfo = await this.analyzeVideoContentWithAI(videoLink, description, pageContent);

         // Procurar ou criar exatamente 10 tags para o vídeo
         // ETAPA 1: LLM cria as tags (tags já foram criadas pela LLM)
         // ETAPA 2: LLM categoriza as tags perfeitamente
         const videoContext = `${videoInfo.title || ""} - ${videoInfo.description || ""}`.trim();
         const tagIds = await this.findOrCreateExactly10TagIds(videoInfo.tags, videoContext);

         // Tags connected to video

         // ✅ VERIFICAR LIMITES ANTES DE CRIAR VÍDEO
         const usageCheck = await this.usageLimitsService.canCreateVideo(user.id);
         if (!usageCheck.canProceed) {
            console.error(`⚠️ [Affiliate Link]: Video limit exceeded for user ${user.id}`);
            throw new Error(usageCheck.message || "Limite de vídeos excedido");
         }

         // Extrair a melhor thumbnail - PRIORIZA YouTube direto da URL!
         const platformThumbnail = this.getBestThumbnail(videoMetadata, videoLink);
         console.info(`🖼️ [AffiliateLink]: Thumbnail: ${platformThumbnail || "NULL"}`);

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
            tags: tagIds, // Usar os IDs das tags criadas
            value: videoInfo.price || 0,
            isPaid: false,
         };

         // Usar o método store do DexdTvVideosService
         const result = await this.dexdTvVideosService.store(videoData);
         const video = result.video;

         // ✅ REGISTRAR USO APÓS CRIAÇÃO
         await this.usageLimitsService.recordUsage(user.id, "videosPerMonth", "video", video.id);

         return video;
      } catch (error: any) {
         console.error("❌ [AffiliateLink]: Error creating video:", error.message);
         throw new Error(`Falha ao criar vídeo: ${error.message}`);
      }
   }

   /**
    * Extrai múltiplos links de produtos do conteúdo do vídeo usando IA (sem criar os produtos)
    * @private
    */
   private async extractProductLinksFromVideoContent(
      videoLink: string,
      video: any,
      videoMetadata?: any
   ): Promise<string[]> {
      try {

         // Tentar extrair conteúdo adicional da página
         let additionalContent = "";
         if (!videoMetadata) {
            try {
               const pageData = await this.extractPageContent(videoLink);
               additionalContent = JSON.stringify(pageData, null, 2);
            } catch (error) {
               console.warn("Não foi possível extrair conteúdo adicional da página");
            }
         } else {
            additionalContent = JSON.stringify(videoMetadata, null, 2);
         }

         const prompt = `
Analise este vídeo e seu conteúdo para detectar todos os links de produtos específicos mencionados.

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
            max_tokens: 4000,
         });

         this.calculateCost(MODEL_SELECTED, startTime, response);
         this.getOpenAIStats();

         const content = response.choices[0].message.content || "{}";

         try {
            const analysis = JSON.parse(content);

            if (analysis.hasProducts && analysis.productLinks && analysis.productLinks.length > 0) {
               return analysis.productsInfo;
            }

            return [];
         } catch (parseError) {
            console.error("Erro ao fazer parse da análise de produtos:", parseError);
            return [];
         }
      } catch (error) {
         console.error("Erro ao analisar produtos no vídeo:", error);
         return [];
      }
   }

   /**
    * Usa IA para analisar o conteúdo do vídeo e extrair informações
    * @private
    */
   private async analyzeVideoContentWithAI(videoLink: string, description?: string, pageContent?: any): Promise<any> {
      try {
         const contextInfo = pageContent ? JSON.stringify(pageContent, null, 2) : "Nenhum conteúdo extraído";

         const prompt = `
Analise este link de vídeo e extraia todas as informações possíveis para criar um registro completo.

🔗 LINK DO VÍDEO: ${videoLink}
📝 DESCRIÇÃO ADICIONAL: ${description || "Nenhuma"}
📄 CONTEÚDO EXTRAÍDO DA PÁGINA: ${contextInfo}

INSTRUÇÕES:
1. Analise o link e conteúdo fornecido
2. Extraia informações sobre o vídeo
3. Identifique a plataforma (YouTube, Vimeo, TikTok, etc.)
4. Capture título, descrição, thumbnail se disponível
5. Estime duração se possível
6. Identifique categoria/tema do vídeo
7. Sugira tags relevantes

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

REGRAS:
- Se não conseguir extrair informações específicas, crie baseado na URL
- Sempre inclua exatamente 10 tags relevantes
- Título deve ser claro e descritivo
- Descrição deve ser útil para busca
- Identifique corretamente a plataforma
- Se for vídeo educacional/tutorial, marque isEducational como true
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
            return videoInfo;
         } catch (parseError) {
            console.error("Erro ao fazer parse da análise do vídeo:", parseError);
            return this.getFallbackVideoInfo(videoLink, description);
         }
      } catch (error) {
         console.error("Erro na análise do vídeo com IA:", error);
         return this.getFallbackVideoInfo(videoLink, description);
      }
   }

   /**
    * Verifica se há link de produto no conteúdo do vídeo usando IA
    * @private
    */
   private async extractProductLinkFromVideoContent(
      videoLink: string,
      video: any,
      videoMetadata?: any
   ): Promise<string | null> {
      try {

         // Tentar extrair conteúdo adicional da página
         let additionalContent = "";
         if (!videoMetadata) {
            try {
               const pageData = await this.extractPageContent(videoLink);
               additionalContent = JSON.stringify(pageData, null, 2);
            } catch (error) {
               console.warn("Não foi possível extrair conteúdo adicional da página");
            }
         } else {
            additionalContent = JSON.stringify(videoMetadata, null, 2);
         }

         const prompt = `
Analise este vídeo e seu conteúdo para detectar se há menção ou link de produto específico.

INFORMAÇÕES DO VÍDEO:
- Link: ${videoLink}
- Título: ${video.title}
- Descrição: ${video.description}
- Conteúdo da página: ${additionalContent}

OBJETIVO:
Detectar se este vídeo menciona, review, ou apresenta algum produto específico que pode ser comprado online.

INSTRUÇÕES:
1. Analise o título, descrição e conteúdo
2. Procure por menções de produtos específicos
3. Identifique se há links de compra, afiliados, ou referências a lojas monte um array com os links
4. Determine se é um review, unboxing, demonstração de produto

TIPOS DE CONTEÚDO QUE INDICAM PRODUTO:
- Reviews de produtos específicos
- Unboxing de itens
- Tutoriais usando produtos específicos  
- Demonstrações de gadgets/eletrônicos
- Comparações entre produtos
- "Onde comprar" ou links de afiliado

RETORNE UM JSON:
{
  "hasProduct": true ou false,
  "productLinks": "Array de URL_do_produto_se_encontrado" ou [],
  "productName": "Nome do produto se identificado" ou null,
  "productCategory": "Categoria do produto" ou null,
  "confidence": 0.0 a 1.0,
  "reasoning": "Explicação do porquê detectou ou não produto"
}

REGRAS:
- Só retorne o array de productLinks se tiver certeza que é um produto comprável
- Confiança deve ser alta (>0.7) para retornar link
- Se for apenas menção genérica, não considere como produto
- Procure por links específicos de e-commerce
      `;

         const startTime = new Date();
         const response = await this.openai.chat.completions.create({
            model: MODEL_SELECTED,
            messages: [
               {
                  role: "system",
                  content: "Você é especialista em identificar produtos em conteúdo de vídeo.",
               },
               {
                  role: "user",
                  content: prompt,
               },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 1000,
         });

         this.calculateCost(MODEL_SELECTED, startTime, response);
         this.getOpenAIStats();

         const content = response.choices[0].message.content || "{}";

         try {
            const analysis = JSON.parse(content);

            if (analysis.hasProduct && analysis.productLinks && analysis.confidence > 0.7) {
               return analysis.productLinks;
            }

            return null;
         } catch (parseError) {
            console.error("Erro ao fazer parse da análise de produto:", parseError);
            return null;
         }
      } catch (error) {
         console.error("Erro ao analisar produto no vídeo:", error);
         return null;
      }
   }

   /**
    * Busca o produto recém-criado para retornar nos dados
    * @private
    */
   private async getLatestCreatedProduct(user: any, productLink: string): Promise<any> {
      try {
         const userStore = await this.prismaClient.store.findFirst({
            where: { userId: user.id },
         });

         if (!userStore) {
            console.warn("Store do usuário não encontrada");
            return null;
         }

         const latestProduct = await this.prismaClient.product.findFirst({
            where: {
               storeId: userStore.id,
               url: productLink,
            },
            orderBy: { createdAt: "desc" },
            include: {
               medias: true,
               tags: true,
               store: {
                  include: {
                     user: {
                        select: {
                           id: true,
                           name: true,
                        },
                     },
                  },
               },
            },
         });

         return latestProduct;
      } catch (error) {
         console.error("Erro ao buscar produto criado:", error);
         return null;
      }
   }

   /**
    * Informações de fallback para vídeo quando IA falha
    * @private
    */
   private getFallbackVideoInfo(videoLink: string, description?: string): any {
      return {
         title: this.extractTitleFromUrl(videoLink),
         description: description || "Vídeo importado automaticamente",
         platform: this.extractPlatformFromUrl(videoLink),
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
    * @private
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
    * Extrai plataforma da URL
    * @private
    */
   private extractPlatformFromUrl(url: string): string {
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
    * Fecha o browser do scraper melhorado
    */
   async closeEnhancedScraper() {
      if (this.enhancedChineseScraper) {
         await this.enhancedChineseScraper.closeBrowser();
      }
   }
}
