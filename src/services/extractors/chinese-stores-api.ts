import { PageHTMLFetcher } from "./extractors/unit-extractors/full-page";
import { EnhancedChineseScraper } from "./extractors/enhanced-chinese-scraper";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

interface ChineseStoreProductData {
   title: string;
   price: string;
   originalPrice?: string;
   images: string[];
   description?: string;
   store: string;
   url: string;
}

export class ChineseStoresApiExtractor {
   private htmlFetcher: PageHTMLFetcher;
   private enhancedScraper: EnhancedChineseScraper;

   constructor() {
      this.htmlFetcher = new PageHTMLFetcher();
      this.enhancedScraper = new EnhancedChineseScraper();
   }

   /**
    * Configuração do proxy para requisições
    */
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

   /**
    * Agente HTTPS para proxy
    */
   private getHttpsAgentForProxy(): any {
      const host = process.env.PROXY_HOST || "proxy.smartproxy.net";
      const port = Number(process.env.PROXY_PORT || 3120);
      const user = process.env.PROXY_USER || "smart-rsrg25meix8s_area-BR_city-aracruz";
      const pass = process.env.PROXY_PASS || "OGf8dvp75MD79qUN";
      const url = `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
      return new HttpsProxyAgent(url);
   }

   /**
    * Detecta se a URL é de uma das lojas chinesas suportadas
    */
   detectStore(url: string): "aliexpress" | "shein" | "shopee" | null {
      const lowerUrl = url.toLowerCase();

      if (lowerUrl.includes("aliexpress.com")) {
         return "aliexpress";
      }
      if (lowerUrl.includes("shein.com")) {
         return "shein";
      }
      if (lowerUrl.includes("shopee.com")) {
         return "shopee";
      }

      return null;
   }

   /**
    * Extrai o ID do produto da URL
    */
   private extractProductId(url: string, store: string): string | null {
      try {
         const urlObj = new URL(url);

         switch (store) {
            case "aliexpress":
               // AliExpress: /item/{productId}.html
               const aliexpressMatch = url.match(/\/item\/(\d+)\.html/);
               return aliexpressMatch ? aliexpressMatch[1] : null;

            case "shein":
               // Shein: diferentes formatos de URL
               // Formato 1: p-{goodsSn}.html
               let sheinMatch = url.match(/p-(\d+)\.html/);
               if (sheinMatch) return sheinMatch[1];

               // Formato 2: goodsSn= parameter
               sheinMatch = url.match(/goodsSn=([^&]+)/);
               if (sheinMatch) return sheinMatch[1];

               // Formato 3: goods_id= parameter
               sheinMatch = url.match(/goods_id=([^&]+)/);
               if (sheinMatch) return sheinMatch[1];

               // Formato 4: extrair da URL do exemplo
               sheinMatch = url.match(/p-(\d+)\.html/);
               if (sheinMatch) return sheinMatch[1];

               console.warn("⚠️ [Shein]: Could not extract product ID from URL:", url);
               return null;

            case "shopee":
               // Shopee: i.{shopId}.{itemId}
               const shopeeMatch = url.match(/i\.(\d+)\.(\d+)/);
               if (shopeeMatch) {
                  // Retornar ambos os IDs separados por vírgula para processamento posterior
                  return `${shopeeMatch[1]},${shopeeMatch[2]}`;
               }
               return null;

            default:
               return null;
         }
      } catch (error) {
         console.error("Erro ao extrair ID do produto:", error);
         return null;
      }
   }

   /**
    * Extrai dados do AliExpress usando a API oficial com proxy
    */
   private async extractAliExpressData(url: string, productId: string): Promise<ChineseStoreProductData | null> {
      try {
         const apiUrl = `https://pt.aliexpress.com/aeglodetailweb/api/msite/item?productId=${productId}`;

         // Configurar se deve usar proxy (padrão: true para evitar bloqueios)
         const useProxy = process.env.USE_PROXY !== "false";

         console.log(`🔍 [AliExpress]: Extraindo dados com ${useProxy ? "proxy" : "conexão direta"}...`);

         const response = await axios.get(apiUrl, {
            headers: {
               accept: "*/*",
               "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
               cookie:
                  "_m_h5_tk=8c0e0e-48d9-8ed7-9193814c9b62; _ga=GA1.1.959061638.1748827251; aep_history=keywords%5E%0Akeywords%09%0A%0Aproduct_selloffer%5E%0Aproduct_selloffer%091005005738665255%091005006875471685%091005008529982572; __rtbh.lid=%7B%22eventType%22%3A%22lid%22%2C%22id%22%3A%22XRWmZAzHE3Bl2k8u9vgq%22%2C%22expiryDate%22%3A%222026-07-06T22%3A17%3A59.611Z%22%7D; _uetsid=049a84805ab711f090d341490e1971e6; _uetvid=d50f57b03f4f11f0980e5f3c0b8b3178; xman_f=POSsoSIWnq0Tp0AQUOzpxs1Q7guEmtzB9b3MppKtUMAIcUPqU2g9kOqHt0x6Qv/acJk67xKw7M48j8jRiNM1IbzYq3GhlS1TRPSsli/lRX3sh75z5OI/Jg==; cto_bundle=zWtrxF93ZHloM2NuRVJPQTBZUWt6ZVlGbTRtdUxza1NVREdoWVQlMkZBMG1qWmtmUUlEYWVyejFrU2VhUE0zREE2QU93UGNPMFNIMm5IOHBWTmNvdUpCRG1ZYUxQT2klMkZIRGxUalJOMHRKSmRlZjMzbzJYcTlJQm1VWEd4eklzTG1Mc29INjBDa3VKSHRHVTRRaHphbW1NdjU3NVRYYjdmMGtwbm52V0JOR0hzaUJqVEpVJTNE; JSESSIONID=7280F1BD9AD863AF4D755594035F83DB; intl_common_forever=gph7k1uWJvDATpj4fJZifdYLRinYY6zne3k2MDgxZfpIo0qoXWMkXg==; _ga_VED1YSGNC7=GS2.1.s1751840254$o3$g1$t1751840413$j60$l0$h0; epssw=9*mmCu-mCSaN9IF2aimms3VxQE-0lr5cV7miL7uIom_2oemQPEtCtY7immdSemmmTa3gZR24YmWsEJkeLuuEeJNQ2I8mLuyu5Anv5zVAwK3LeOmeZ7uecPBEgHuq3KzYgp1EMOlpcuUKmdVtyHIANVGaJwn1oruuuuu_LQT0J8HmLutu0ZxcgXtl7ugRNMgZgMas1IFQPcDATbnpA3HaL_jbpSZzhXgAQmpw3LYu0vut_HX-5rdYA3uAakLmk4muzp7MXNp7QB2b0_yDbacxV3umjauRfXdYlWnWmTxShqilHXs2HE5FSSwLCynDyN2J4ba3AWx67mHtUBJBAkM3Xf324yDlVH7c1iLBd.; isg=BHJyqXzaTucu6nKNkMrbDAqfw75UA3ado6J76DxLniUQzxLJJJPGrXgsv3Pzv-41; tfstk=gJWoZAXQGEg61n4vMt97_2xbRXPAVL9B-wHpJpLUgE8XJvIUNk2hWg8pvuTJ8sbFlQLrepCmxG_DpwjQVH8F8wYdwSeOVg9BLPQ3BRISFXZcJTvEJiJWvU81xJwOVgi2LPUTBRn3tcVc8e7eaIJ2AE8eLb7euI-wX4JF8wRqgHK6YvJe8IrDAE8eLp7e3oxpue8ydA8RDGX4k0oMaCTtnTKkZFSyuwQd33097g8mLv8kqQqc4EDELtfHSbJkS-02kMS1TIX3FYpCD1bhTZrELef2jNxOy-kkLs7cICSbSYTlga6HeCwnxnfG0aXWK5mWDTjVCBX7rx8lli59FOzjKNSAXTOfKP02R_K633f0Yj8yTgosgflOcvt4vtcIOQ-XmFE9O2e8lHy_9oqmsYOycns4mocIOQ-XmFE0mfDWantf0",
               priority: "u=1, i",
               referer:
                  "https://pt.aliexpress.com/item/1005008529982572.html?spm=a2g0o.tm1000013488.d0.1.5dbf31c65PmliE&pvid=f393b68a-2329-4c8a-bf11-0884f7f99816&pdp_ext_f=%7B%22ship_from%22:%22BR%22,%22sku_id%22:%2212000045581459366%22%7D&scm=1007.39065.416354.0&scm-url=1007.39065.416354.0&scm_id=1007.39065.416354.0&pdp_npi=4%40dis%21BRL%21R%24%20335%2C20%21R%24%20238%2C25%21%21%2157.22%2140.67%21%402101e07217518402605994366eb226%2112000045581459366%21gdf%21BR%212609839789%21X&aecmd=true",
               "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
               "sec-ch-ua-mobile": "?1",
               "sec-ch-ua-platform": '"Android"',
               "sec-fetch-dest": "empty",
               "sec-fetch-mode": "cors",
               "sec-fetch-site": "same-origin",
               "user-agent":
                  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
            },
            timeout: 30000,
            httpsAgent: useProxy ? this.getHttpsAgentForProxy() : undefined,
            proxy: useProxy ? false : undefined,
         });

         if (response.status !== 200) {
            console.error(`Erro na API do AliExpress: ${response.status}`);
            return null;
         }

         const data = response.data;

         // Extrair dados da resposta da API
         const globalData = data.GLOBAL_DATA?.globalData;
         const priceData = data.PRICE?.targetSkuPriceInfo;
         const imageData = data.HEADER_IMAGE_PC;
         const ratingData = data.PC_RATING;
         const shopData = data.SHOP_CARD_PC;

         if (!globalData || !priceData) {
            console.error("Dados essenciais não encontrados na resposta do AliExpress");
            return null;
         }

         // Extrair imagens
         const images: string[] = [];
         if (imageData?.mainImages) {
            images.push(...imageData.mainImages.map((img: any) => img.imageUrl));
         }
         if (imageData?.imagePathList && images.length === 0) {
            images.push(...imageData.imagePathList);
         }

         // Extrair preços
         const currentPrice = priceData.salePriceString || priceData.salePriceLocal?.split("|")[0];
         const originalPrice = priceData.originalPrice?.formatedAmount;

         return {
            title: globalData.subject || "Produto AliExpress",
            price: currentPrice || "Preço não disponível",
            originalPrice: originalPrice,
            images: images.slice(0, 5), // Limitar a 5 imagens
            description: globalData.subject || "Descrição não disponível",
            store: "AliExpress",
            url: url,
         };
      } catch (error) {
         console.error("Erro ao extrair dados do AliExpress:", error);
         return null;
      }
   }

   /**
    * Extrai dados do Shein usando o scraper melhorado
    */
   private async extractSheinData(url: string, goodsSn: string): Promise<ChineseStoreProductData | null> {
      try {
         console.log("👗 [Shein]: Usando scraper melhorado para extrair dados...");

         // Usar o scraper melhorado que aguarda o carregamento da página
         const scrapedData = await this.enhancedScraper.extractProductData(url);

         if (scrapedData) {
            return {
               title: scrapedData.title,
               price: scrapedData.price,
               originalPrice: scrapedData.originalPrice,
               images: scrapedData.images,
               description: scrapedData.description,
               store: "Shein",
               url: url,
            };
         }

         console.warn("⚠️ [Shein]: Scraper melhorado falhou, usando fallback HTML...");
         return await this.extractFromHTML(url, "shein");
      } catch (error) {
         console.error("❌ [Shein]: Erro no scraper melhorado:", error);
         return await this.extractFromHTML(url, "shein");
      }
   }

   /**
    * Extrai dados do Shopee usando o scraper melhorado
    */
   private async extractShopeeData(url: string, itemId: string): Promise<ChineseStoreProductData | null> {
      try {
         console.log("🛍️ [Shopee]: Usando scraper melhorado para extrair dados...");

         // Usar o scraper melhorado que aguarda o carregamento da página
         const scrapedData = await this.enhancedScraper.extractProductData(url);

         if (scrapedData) {
            return {
               title: scrapedData.title,
               price: scrapedData.price,
               originalPrice: scrapedData.originalPrice,
               images: scrapedData.images,
               description: scrapedData.description,
               store: "Shopee",
               url: url,
            };
         }

         console.warn("⚠️ [Shopee]: Scraper melhorado falhou, usando fallback HTML...");
         return await this.extractFromHTML(url, "shopee");
      } catch (error) {
         console.error("❌ [Shopee]: Erro no scraper melhorado:", error);
         return await this.extractFromHTML(url, "shopee");
      }
   }

   /**
    * Extrai dados usando HTML como fallback
    */
   private async extractFromHTML(url: string, store: string): Promise<ChineseStoreProductData | null> {
      try {
         const html = await this.htmlFetcher.execute(url);

         // Extrair título
         const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
         const title = titleMatch ? titleMatch[1].trim() : "Produto " + store;

         // Extrair preço usando regex
         let price = "";
         let originalPrice = "";

         if (store === "shopee") {
            // Padrões específicos do Shopee
            const priceMatch = html.match(/"price":\s*(\d+)/);
            if (priceMatch) {
               price = `R$ ${(parseInt(priceMatch[1]) / 100000).toFixed(2)}`;
            }
         } else if (store === "shein") {
            // Padrões específicos do Shein
            const priceMatch = html.match(/"salePrice":\s*"([^"]+)"/);
            if (priceMatch) {
               price = priceMatch[1];
            }
         }

         // Extrair imagens
         const images: string[] = [];
         const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
         if (imgMatches) {
            for (const imgMatch of imgMatches) {
               const srcMatch = imgMatch.match(/src=["']([^"']+)["']/);
               if (srcMatch) {
                  const imgUrl = srcMatch[1];
                  if (imgUrl.includes("http") && (imgUrl.includes("product") || imgUrl.includes("image"))) {
                     images.push(imgUrl);
                  }
               }
            }
         }

         return {
            title: title,
            price: price || "Preço não disponível",
            originalPrice: originalPrice,
            images: images.slice(0, 5),
            description: title,
            store: store.charAt(0).toUpperCase() + store.slice(1),
            url: url,
         };
      } catch (error) {
         console.error(`Erro ao extrair dados HTML do ${store}:`, error);
         return null;
      }
   }

   /**
    * Extrai dados de produto de uma loja chinesa
    */
   async extractProductData(url: string): Promise<ChineseStoreProductData | null> {
      const store = this.detectStore(url);
      if (!store) {
         return null;
      }

      const productId = this.extractProductId(url, store);
      if (!productId) {
         console.error(`Não foi possível extrair ID do produto da URL: ${url}`);
         return await this.extractFromHTML(url, store);
      }

      console.log(`🔍 Extraindo dados do ${store} - ID: ${productId}`);

      try {
         switch (store) {
            case "aliexpress":
               return await this.extractAliExpressData(url, productId);
            case "shein":
               return await this.extractSheinData(url, productId);
            case "shopee":
               return await this.extractShopeeData(url, productId);
            default:
               return null;
         }
      } catch (error) {
         console.error(`Erro ao extrair dados do ${store}:`, error);
         return await this.extractFromHTML(url, store);
      }
   }

   /**
    * Normaliza preços para formato padrão
    */
   private normalizePrice(price: string): string {
      if (!price) return "Preço não disponível";

      // Remove símbolos de moeda e espaços extras
      return price.replace(/[^\d,.]/g, "").trim();
   }

   /**
    * Extrai URLs de imagens de uma string HTML
    */
   private extractImagesFromHTML(html: string): string[] {
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      const images: string[] = [];
      let match;

      while ((match = imgRegex.exec(html)) !== null) {
         const src = match[1];
         if (src && src.includes("http") && !src.includes("logo") && !src.includes("icon")) {
            images.push(src);
         }
      }

      return images.slice(0, 5); // Limitar a 5 imagens
   }

   /**
    * Fecha o browser do scraper melhorado
    */
   async closeBrowser() {
      if (this.enhancedScraper) {
         await this.enhancedScraper.closeBrowser();
      }
   }
}
