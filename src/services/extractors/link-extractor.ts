/**
 * Resolve links encurtados seguindo redirecionamentos HTTP
 * para obter a URL final de destino
 */

interface UrlResolverOptions {
   maxRedirects?: number;
   timeout?: number;
   userAgent?: string;
}

interface UrlResolverResult {
   originalUrl: string;
   finalUrl: string;
   redirectCount: number;
   redirectChain: string[];
   success: boolean;
   error?: string;
}

export class UrlResolver {
   private defaultOptions: Required<UrlResolverOptions> = {
      maxRedirects: 10,
      timeout: 5000,
      userAgent:
         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
   };

   /**
    * Resolve um link encurtado para sua URL final
    * @param url - URL encurtada para resolver
    * @param options - Opções de configuração
    * @returns Promise com o resultado da resolução
    */
   async resolveUrl(url: string, options: UrlResolverOptions = {}): Promise<UrlResolverResult> {
      const config = { ...this.defaultOptions, ...options };
      const redirectChain: string[] = [url];
      let currentUrl = url;
      let redirectCount = 0;

      try {
         // Valida se a URL é válida
         new URL(url);
      } catch (error) {
         return {
            originalUrl: url,
            finalUrl: url,
            redirectCount: 0,
            redirectChain,
            success: false,
            error: "URL inválida",
         };
      }

      try {
         while (redirectCount < config.maxRedirects) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            try {
               const response = await fetch(currentUrl, {
                  method: "HEAD", // Usa HEAD para economizar bandwidth
                  redirect: "manual", // Não segue redirecionamentos automaticamente
                  signal: controller.signal,
                  headers: {
                     "User-Agent": config.userAgent,
                  },
               });

               clearTimeout(timeoutId);

               // Verifica se há redirecionamento
               if (response.status >= 300 && response.status < 400) {
                  const location = response.headers.get("location");

                  if (!location) {
                     break; // Sem header Location, para aqui
                  }

                  // Resolve URL relativa se necessário
                  const nextUrl = new URL(location, currentUrl).href;

                  if (redirectChain.includes(nextUrl)) {
                     // Detecta loop de redirecionamento
                     return {
                        originalUrl: url,
                        finalUrl: currentUrl,
                        redirectCount,
                        redirectChain,
                        success: false,
                        error: "Loop de redirecionamento detectado",
                     };
                  }

                  currentUrl = nextUrl;
                  redirectChain.push(currentUrl);
                  redirectCount++;
               } else {
                  // Não há mais redirecionamentos
                  break;
               }
            } catch (fetchError: any) {
               clearTimeout(timeoutId);

               if (fetchError.name === "AbortError") {
                  return {
                     originalUrl: url,
                     finalUrl: currentUrl,
                     redirectCount,
                     redirectChain,
                     success: false,
                     error: "Timeout na requisição",
                  };
               }

               throw fetchError;
            }
         }

         if (redirectCount >= config.maxRedirects) {
            return {
               originalUrl: url,
               finalUrl: currentUrl,
               redirectCount,
               redirectChain,
               success: false,
               error: "Máximo de redirecionamentos atingido",
            };
         }

         return {
            originalUrl: url,
            finalUrl: currentUrl,
            redirectCount,
            redirectChain,
            success: true,
         };
      } catch (error) {
         return {
            originalUrl: url,
            finalUrl: currentUrl,
            redirectCount,
            redirectChain,
            success: false,
            error: error instanceof Error ? error.message : "Erro desconhecido",
         };
      }
   }

   /**
    * Resolve múltiplas URLs de uma vez
    * @param urls - Array de URLs para resolver
    * @param options - Opções de configuração
    * @returns Promise com array de resultados
    */
   async resolveMultipleUrls(urls: string[], options: UrlResolverOptions = {}): Promise<UrlResolverResult[]> {
      const promises = urls.map((url) => this.resolveUrl(url, options));
      return Promise.all(promises);
   }

   /**
    * Método simplificado que retorna apenas a URL final
    * @param url - URL encurtada
    * @param options - Opções de configuração
    * @returns Promise com a URL final ou null se falhar
    */
   async getFinalUrl(url: string, options: UrlResolverOptions = {}): Promise<string | null> {
      const result = await this.resolveUrl(url, options);
      return result.success ? result.finalUrl : null;
   }

   /**
    * Verifica se uma URL é um link encurtado comum
    * @param url - URL para verificar
    * @returns boolean indicando se é um serviço de encurtamento conhecido
    */
   isShortUrl(url: string): boolean {
      const shortUrlDomains = [
         "bit.ly",
         "tinyurl.com",
         "goo.gl",
         "t.co",
         "ow.ly",
         "is.gd",
         "buff.ly",
         "amzn.to",
         "youtu.be",
         "fb.me",
         "lnkd.in",
         "short.link",
         "tiny.cc",
         "rebrand.ly",
      ];

      try {
         const urlObj = new URL(url);
         const domain = urlObj.hostname.toLowerCase();

         return shortUrlDomains.some((shortDomain) => domain === shortDomain || domain.endsWith("." + shortDomain));
      } catch {
         return false;
      }
   }
}
