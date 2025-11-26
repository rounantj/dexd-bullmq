import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  PRODUCT EXTRACTION SERVICE - AUTÔNOMO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Este serviço extrai produtos de links de afiliados e salva no banco.
 * Roda INTEIRAMENTE no worker, sem depender da API do dexd-api.
 *
 * Fluxo:
 * 1. Recebe link do produto
 * 2. Resolve URL final (redirects)
 * 3. Extrai HTML com Puppeteer
 * 4. Analisa com OpenAI para extrair dados estruturados
 * 5. Cria produto no banco com Prisma
 * ════════════════════════════════════════════════════════════════════════════
 */

const MODEL_SELECTED = "gpt-4o-mini";

interface ProductData {
  name: string;
  description: string;
  price: number;
  cost: number;
  images: string[];
  brand?: string;
  material?: string;
  benefits?: string;
  tags: string[];
  height?: number;
  width?: number;
  length?: number;
  weight?: number;
  ncm?: string;
}

interface ExtractionResult {
  success: boolean;
  productId?: number;
  productName?: string;
  error?: string;
}

export class ProductExtractionService {
  private prisma: PrismaClient;
  private openai: OpenAI;

  constructor() {
    this.prisma = new PrismaClient();
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * Método principal: extrai produto do link e salva no banco
   */
  async extractAndCreateProduct(
    productLink: string,
    userId: number,
    dexdVideoId?: number | null,
    options?: any
  ): Promise<ExtractionResult> {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`📦 [ProductExtraction]: Starting extraction`);
    console.log(`   Link: ${productLink}`);
    console.log(`   User: ${userId}`);
    console.log(`${"═".repeat(70)}\n`);

    try {
      // 1. Verificar se usuário tem loja
      const userStore = await this.prisma.store.findFirst({
        where: { userId },
      });

      if (!userStore) {
        throw new Error(`Usuário ${userId} não possui uma loja associada`);
      }

      // 2. Resolver URL final
      const finalUrl = await this.resolveUrl(productLink);
      console.log(`🔗 [ProductExtraction]: Final URL: ${finalUrl}`);

      // 3. Extrair HTML da página
      const pageContent = await this.extractPageContent(finalUrl);
      console.log(`📄 [ProductExtraction]: Page content extracted (${pageContent.length} chars)`);

      // 4. Analisar com OpenAI
      const productData = await this.analyzeWithOpenAI(finalUrl, pageContent, options);
      console.log(`🧠 [ProductExtraction]: AI analysis complete`);
      console.log(`   Name: ${productData.name}`);
      console.log(`   Price: ${productData.price}`);

      // 5. Criar/encontrar tags
      const tagIds = await this.findOrCreateTags(productData.tags);
      console.log(`🏷️ [ProductExtraction]: Tags created/found: ${tagIds.length}`);

      // 6. Criar produto no banco
      const product = await this.createProduct(
        productData,
        userStore.id,
        userId,
        productLink,
        tagIds,
        dexdVideoId
      );

      console.log(`✅ [ProductExtraction]: Product created! ID: ${product.id}`);

      return {
        success: true,
        productId: product.id,
        productName: product.name,
      };
    } catch (error: any) {
      console.error(`❌ [ProductExtraction]: Error:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Resolve redirects e retorna URL final
   */
  private async resolveUrl(url: string): Promise<string> {
    try {
      const response = await axios.head(url, {
        maxRedirects: 10,
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      return response.request?.res?.responseUrl || url;
    } catch (error) {
      // Se HEAD falhar, tentar GET
      try {
        const response = await axios.get(url, {
          maxRedirects: 10,
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        return response.request?.res?.responseUrl || url;
      } catch {
        return url;
      }
    }
  }

  /**
   * Extrai conteúdo HTML da página usando Puppeteer
   */
  private async extractPageContent(url: string): Promise<string> {
    let browser;
    try {
      console.log(`🌐 [ProductExtraction]: Launching Puppeteer...`);

      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
        ],
      });

      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      await page.setViewport({ width: 1920, height: 1080 });

      console.log(`🌐 [ProductExtraction]: Navigating to URL...`);
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Aguardar um pouco para JavaScript carregar
      await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

      const html = await page.content();
      await browser.close();

      // Limpar HTML para reduzir tokens
      const $ = cheerio.load(html);
      $("script").remove();
      $("style").remove();
      $("noscript").remove();
      $("iframe").remove();
      $("svg").remove();

      const cleanHtml = $.html();
      return cleanHtml.substring(0, 50000); // Limitar tamanho
    } catch (error: any) {
      if (browser) await browser.close();
      console.warn(`⚠️ [ProductExtraction]: Puppeteer failed, trying axios...`);

      // Fallback para axios
      const { data } = await axios.get(url, {
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      return data.substring(0, 50000);
    }
  }

  /**
   * Analisa conteúdo da página com OpenAI
   */
  private async analyzeWithOpenAI(
    url: string,
    content: string,
    options?: any
  ): Promise<ProductData> {
    console.log(`🧠 [ProductExtraction]: Calling OpenAI...`);

    // Extrair texto relevante do HTML
    const $ = cheerio.load(content);
    const textContent = $("body").text().replace(/\s+/g, " ").trim().substring(0, 15000);

    // Extrair imagens
    const images: string[] = [];
    $("img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (
        src &&
        !src.includes("logo") &&
        !src.includes("icon") &&
        (src.includes("http") || src.startsWith("//"))
      ) {
        const fullUrl = src.startsWith("//") ? `https:${src}` : src;
        if (!images.includes(fullUrl)) {
          images.push(fullUrl);
        }
      }
    });

    const prompt = `Analise o conteúdo desta página de produto e extraia as informações em JSON.

URL: ${url}

Conteúdo da página:
${textContent}

Retorne APENAS um objeto JSON válido com esta estrutura:
{
  "name": "Nome do produto (máximo 100 caracteres)",
  "description": "Descrição detalhada do produto (máximo 500 caracteres)",
  "price": número (preço em reais, apenas o número),
  "cost": número (custo estimado = price * 0.65),
  "brand": "Marca do produto ou vendedor",
  "material": "Material principal do produto",
  "benefits": "Principais benefícios",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"],
  "height": número (altura em cm),
  "width": número (largura em cm),
  "length": número (comprimento em cm),
  "weight": número (peso em gramas),
  "ncm": "código NCM se disponível, senão 00.00.00"
}

IMPORTANTE:
- Retorne APENAS o JSON, sem markdown ou explicações
- Se não encontrar uma informação, use valores padrão razoáveis
- Tags devem ser relevantes para o produto
- Preço deve ser um número válido`;

    const response = await this.openai.chat.completions.create({
      model: MODEL_SELECTED,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const responseText = response.choices[0]?.message?.content || "{}";

    // Limpar resposta e fazer parse
    let cleanJson = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      console.warn(`⚠️ [ProductExtraction]: Failed to parse AI response, using defaults`);
      parsed = {
        name: "Produto sem nome",
        description: "Descrição não disponível",
        price: 0,
        cost: 0,
        brand: "Desconhecido",
        tags: ["Produto", "E-commerce"],
      };
    }

    return {
      name: parsed.name || "Produto sem nome",
      description: parsed.description || "Descrição não disponível",
      price: Number(parsed.price) || 0,
      cost: Number(parsed.cost) || Number(parsed.price) * 0.65 || 0,
      images: images.slice(0, 10),
      brand: parsed.brand || "Desconhecido",
      material: parsed.material || "",
      benefits: parsed.benefits || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : ["Produto"],
      height: Number(parsed.height) || 10,
      width: Number(parsed.width) || 10,
      length: Number(parsed.length) || 10,
      weight: Number(parsed.weight) || 100,
      ncm: parsed.ncm || "00.00.00",
    };
  }

  /**
   * Encontra ou cria tags no banco
   */
  private async findOrCreateTags(tagNames: string[]): Promise<number[]> {
    const tagIds: number[] = [];

    for (const name of tagNames) {
      if (!name || typeof name !== "string") continue;

      const cleanName = name.trim().toLowerCase();
      if (cleanName.length < 2) continue;

      try {
        // Tentar encontrar tag existente
        let tag = await this.prisma.tag.findFirst({
          where: { name: { equals: cleanName } },
        });

        // Criar se não existir
        if (!tag) {
          tag = await this.prisma.tag.create({
            data: { name: cleanName },
          });
        }

        tagIds.push(tag.id);
      } catch (error) {
        // Ignorar erros de tags duplicadas
        console.warn(`⚠️ Tag "${cleanName}" skipped:`, error);
      }
    }

    return tagIds;
  }

  /**
   * Cria produto no banco de dados
   */
  private async createProduct(
    data: ProductData,
    storeId: number,
    userId: number,
    originalUrl: string,
    tagIds: number[],
    dexdVideoId?: number | null
  ): Promise<any> {
    // Criar produto
    const product = await this.prisma.product.create({
      data: {
        name: data.name.substring(0, 255),
        description: data.description,
        price: data.price,
        cost: data.cost,
        storeId,
        dexdVideoId: dexdVideoId || null,
        material: data.material || "",
        benefits: data.benefits || "",
        moreDetails: `Produto de afiliado - Link original: ${originalUrl}`,
        measurementUnitId: 1,
        measureHeight: data.height || 10,
        measureWidth: data.width || 10,
        measureLength: data.length || 10,
        weight: data.weight || 100,
        ncm: data.ncm || "00.00.00",
        measureHeightWithPackaging: (data.height || 10) + 2,
        measureWidthWithPackaging: (data.width || 10) + 2,
        measureLengthWithPackaging: (data.length || 10) + 2,
        weightWithPackaging: ((data.weight || 100) * 1.1),
        model: "affiliate",
        line: data.brand || "external",
        toFeed: true,
        type: "external",
        url: originalUrl,
        quantity: 999,
        blocked: false,
      },
    });

    // Criar mídias (imagens)
    if (data.images.length > 0) {
      await this.prisma.product_Media.createMany({
        data: data.images.map((url) => ({
          url,
          productId: product.id,
        })),
      });
    }

    // Conectar tags
    if (tagIds.length > 0) {
      await this.prisma.entity_Tag.createMany({
        data: tagIds.map((tagId) => ({
          tagId,
          productId: product.id,
        })),
        skipDuplicates: true,
      });
    }

    // Registrar uso
    const userSubscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
    });

    if (userSubscription) {
      await this.prisma.usage_tracking.create({
        data: {
          userId,
          userSubscriptionId: userSubscription.id,
          featureKey: "productsPerMonth",
          usageCount: 1,
          usageDate: new Date(),
          resourceId: product.id,
          resourceType: "product",
        },
      });
    }

    return product;
  }

  /**
   * Cleanup Prisma connection
   */
  async disconnect() {
    await this.prisma.$disconnect();
  }
}

