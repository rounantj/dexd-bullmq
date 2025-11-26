import puppeteer from "puppeteer-extra";
import { Browser, Page } from "puppeteer";
import { chromium } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { executablePath } from "puppeteer";
import axios from "axios";
import { JSDOM } from "jsdom";

// Configura plugins para evitar detecção
puppeteer.use(StealthPlugin());

interface PageFetchResult {
   success: boolean;
   html?: string;
   error?: string;
   method?: string;
}

export class PageHTMLFetcher {
   private readonly VALIDATION_TIMEOUT = 3000;
   private readonly DEFAULT_TIMEOUT = 20000; // Reduzido para 20s
   private readonly RETRY_DELAY = 1000;
   private readonly MAX_MEMORY_MB = 512; // Limite de memória
   private readonly MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB max

   constructor(private options: { maxRetries?: number } = {}) {}

   async execute(url: string): Promise<string> {
      // Timeout global para toda a operação
      return this.withTimeout(this.executeInternal(url), 60000); // 1 minuto máximo
   }

   private async playwrightRender(url: string): Promise<PageFetchResult> {
      let browser: any = null;
      try {
         browser = await chromium.launch({
            headless: true,
            args: [
               "--no-sandbox",
               "--disable-setuid-sandbox",
               "--disable-dev-shm-usage",
               "--disable-gpu",
               "--disable-extensions",
               `--max-old-space-size=${this.MAX_MEMORY_MB}`,
            ],
         });

         const context = await browser.newContext({
            userAgent:
               "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 800 },
         });
         const page = await context.newPage();

         // Bloquear recursos pesados
         await page.route("**/*", (route) => {
            const req = route.request();
            const resourceType = req.resourceType();
            if (["image", "media", "font", "stylesheet"].includes(resourceType)) {
               return route.abort();
            }
            return route.continue();
         });

         const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
         if (!response || !response.ok()) {
            throw new Error(`HTTP ${response?.status() || "unknown"} error`);
         }

         // Pequena espera para conteúdo dinâmico inicial
         await this.delay(800);

         const html = await page.content();
         await context.close();
         await browser.close();

         return { success: true, html, method: "playwrightRender" };
      } catch (error) {
         try {
            if (browser) await browser.close();
         } catch {}
         return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            method: "playwrightRender",
         };
      }
   }

   private async executeInternal(url: string): Promise<string> {
      const methods = [
         this.directFetch.bind(this), // Começa com o mais simples
         this.jsdomSimulation.bind(this),
         this.playwrightRender.bind(this),
         this.puppeteerBasicRender.bind(this),
         this.puppeteerFullRender.bind(this),
      ];

      let lastError: Error | null = null;
      const maxRetries = Math.min(this.options.maxRetries || 2, 3); // Máximo 3 tentativas

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
         // Verifica uso de memória antes de tentar
         if (this.isMemoryLimitExceeded()) {
            console.warn("Memory limit exceeded, forcing garbage collection");
            if (global.gc) global.gc();
            await this.delay(1000);
         }

         for (const method of methods) {
            try {
               const result: any = await this.withTimeout(method(url), this.DEFAULT_TIMEOUT);

               if (result.success && result.html) {
                  // Verifica tamanho do HTML
                  if (result.html.length > this.MAX_HTML_SIZE) {
                     console.warn(`HTML too large: ${result.html.length} bytes, truncating`);
                     result.html = result.html.substring(0, this.MAX_HTML_SIZE);
                  }

                  const block = this.detectBlockStatus(result.html);
                  const isComplete = await this.withTimeout(this.isPageComplete(result.html), this.VALIDATION_TIMEOUT);
                  console.info(
                     `🔎 [HTMLFetcher] Method=${result.method} len=${result.html.length} complete=${isComplete} block={captcha:${block.captcha},accountVerification:${block.accountVerification}} url=${url}`
                  );

                  if (isComplete && !block.captcha && !block.accountVerification) {
                     console.info(`✅ [HTMLFetcher] Success via ${result.method}`);
                     return result.html;
                  } else {
                     console.warn(`⚠️ [HTMLFetcher] HTML not usable from ${result.method}, trying next method...`);
                  }
               }
            } catch (error) {
               lastError = error instanceof Error ? error : new Error(String(error));
               console.warn(`❌ [HTMLFetcher] Method ${method.name} failed: ${lastError.message}`);

               // Se for erro de timeout ou memória, para de tentar métodos pesados
               if (this.isCriticalError(lastError)) {
                  break;
               }
            }
         }

         if (attempt < maxRetries) {
            await this.delay(this.RETRY_DELAY * (attempt + 1));
         }
      }

      console.error("❌ [HTMLFetcher] All methods failed, returning empty string");
      return ""; // Retorna string vazia em vez de throw
   }

   private async puppeteerFullRender(url: string): Promise<PageFetchResult> {
      let browser: Browser | null = null;
      let page: Page | null = null;

      try {
         browser = await puppeteer.launch({
            headless: "new",
            executablePath: executablePath(),
            args: [
               "--no-sandbox",
               "--disable-setuid-sandbox",
               "--disable-dev-shm-usage", // Importante para containers
               "--disable-extensions",
               "--disable-gpu",
               "--disable-background-timer-throttling",
               "--disable-backgrounding-occluded-windows",
               "--disable-renderer-backgrounding",
               "--memory-pressure-off",
               `--max-old-space-size=${this.MAX_MEMORY_MB}`,
               `--user-agent=${this.randomUserAgent()}`,
            ],
            ignoreHTTPSErrors: true,
            defaultViewport: { width: 1280, height: 800 },
         } as any);

         page = await browser.newPage();

         // Configura limites de recursos
         await page.setRequestInterception(true);
         page.on("request", (req) => {
            // Bloqueia recursos pesados desnecessários
            if (["image", "stylesheet", "font", "media"].includes(req.resourceType())) {
               req.abort();
            } else {
               req.continue();
            }
         });

         // Timeout mais agressivo para navegação
         const response = await page.goto(url, {
            waitUntil: "domcontentloaded", // Mais rápido que networkidle
            timeout: 15000,
         });

         if (!response || !response.ok()) {
            throw new Error(`HTTP ${response?.status() || "unknown"} error`);
         }

         // Espera mínima para conteúdo dinâmico
         await this.delay(1000);

         const html = await page.content();
         return { success: true, html, method: "puppeteerFullRender" };
      } catch (error) {
         return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            method: "puppeteerFullRender",
         };
      } finally {
         try {
            if (page) await page.close();
            if (browser) await browser.close();
         } catch (e) {
            console.warn("Error closing browser:", e);
         }
      }
   }

   private async puppeteerBasicRender(url: string): Promise<PageFetchResult> {
      let browser: Browser | null = null;
      let page: Page | null = null;

      try {
         browser = await puppeteer.launch({
            headless: "new",
            args: [
               "--no-sandbox",
               "--disable-setuid-sandbox",
               "--disable-dev-shm-usage",
               "--disable-extensions",
               "--disable-gpu",
               `--max-old-space-size=${this.MAX_MEMORY_MB}`,
            ],
         } as any);

         page = await browser.newPage();
         await page.setUserAgent(this.randomUserAgent());

         // Timeout reduzido
         await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 10000,
         });

         await this.delay(500); // Espera mínima

         const html = await page.content();
         return { success: true, html, method: "puppeteerBasicRender" };
      } catch (error) {
         return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            method: "puppeteerBasicRender",
         };
      } finally {
         try {
            if (page) await page.close();
            if (browser) await browser.close();
         } catch (e) {
            console.warn("Error closing browser:", e);
         }
      }
   }

   private async jsdomSimulation(url: string): Promise<PageFetchResult> {
      try {
         const response = await axios.get(url, {
            headers: {
               "User-Agent": this.randomUserAgent(),
               "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
               Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
            timeout: 8000,
            maxContentLength: this.MAX_HTML_SIZE,
            maxBodyLength: this.MAX_HTML_SIZE,
            proxy: this.getAxiosProxyConfig(),
         });

         // JSDOM simplificado - sem execução de scripts para evitar problemas
         const dom = new JSDOM(response.data, {
            runScripts: "outside-only", // Mais seguro
            resources: "usable",
            pretendToBeVisual: false, // Reduz overhead
         });

         const html = dom.serialize();
         dom.window.close(); // Limpa recursos

         return {
            success: true,
            html,
            method: "jsdomSimulation",
         };
      } catch (error) {
         return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            method: "jsdomSimulation",
         };
      }
   }

   private async directFetch(url: string): Promise<PageFetchResult> {
      try {
         const response = await axios.get(url, {
            headers: {
               "User-Agent": this.randomUserAgent(),
               "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
               Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
            timeout: 5000,
            maxContentLength: this.MAX_HTML_SIZE,
            maxBodyLength: this.MAX_HTML_SIZE,
            proxy: this.getAxiosProxyConfig(),
         });

         return {
            success: true,
            html: response.data,
            method: "directFetch",
         };
      } catch (error) {
         return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            method: "directFetch",
         };
      }
   }

   private async isPageComplete(html: string): Promise<boolean> {
      try {
         if (!html || html.length < 100) return false;

         const hasBody = /<body[\s\S]*?>[\s\S]*<\/body>/i.test(html);
         const hasContent = html.length > 1000; // Reduzido de 50k
         const isBlocked = /captcha|robot.check|request.denied|access.denied/i.test(html);

         return hasBody && hasContent && !isBlocked;
      } catch {
         return false;
      }
   }

   private detectBlockStatus(html: string): { captcha: boolean; accountVerification: boolean } {
      const lower = html.toLowerCase();
      // Mercado Livre interstitial de verificação de conta
      const accountVerification = lower.includes("/gz/account-verification") || lower.includes("account-verification");
      const captcha = /captcha|are you a human|hcaptcha|g-recaptcha/i.test(html);
      return { captcha, accountVerification };
   }

   private randomUserAgent(): string {
      const agents = [
         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
         "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
         "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      ];
      return agents[Math.floor(Math.random() * agents.length)];
   }

   private getAxiosProxyConfig(): any {
      const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
      if (!proxyUrl) return false;
      try {
         const parsed = new URL(proxyUrl.startsWith("http") ? proxyUrl : `http://${proxyUrl}`);
         return {
            protocol: parsed.protocol.replace(":", ""),
            host: parsed.hostname,
            port: parsed.port ? parseInt(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
            auth:
               parsed.username || parsed.password
                  ? { username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) }
                  : undefined,
         };
      } catch {
         return false;
      }
   }

   private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
      const timeoutPromise = new Promise<never>((_, reject) => {
         setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      return Promise.race([promise, timeoutPromise]);
   }

   private async delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
   }

   private isMemoryLimitExceeded(): boolean {
      try {
         const memUsage = process.memoryUsage();
         const memUsageMB = memUsage.heapUsed / 1024 / 1024;
         return memUsageMB > this.MAX_MEMORY_MB;
      } catch {
         return false;
      }
   }

   private isCriticalError(error: Error): boolean {
      const criticalMessages = ["timeout", "memory", "out of memory", "heap"];
      return criticalMessages.some((msg) => error.message.toLowerCase().includes(msg));
   }
}
