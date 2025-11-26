import axios from "axios";

/**
 * Cliente para comunicação com o serviço Extractor (Python)
 * Responsável por scraping pesado usando Selenium
 */

const EXTRACTOR_URL = process.env.EXTRACTOR_URL || process.env.EXTRACTOR || "http://localhost:4000";

export interface ExtractedProductData {
  url: string;
  platform: string;
  title: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  description: string | null;
  images: string[];
  seller: string | null;
  rating: number | null;
  reviewCount: number | null;
  specifications: Record<string, string>;
  rawHtml?: string;
  extractionMethod: string;
}

export interface SEOExtractedData {
  url: string;
  title: string;
  description: string;
  image: string | null;
  source: string;
  status: string;
}

export class ExtractorClient {
  private static timeout = 90000; // 90 segundos para scraping pesado

  /**
   * Extrai dados completos de um produto
   * Usa Selenium no Python para scraping robusto
   */
  static async extractProduct(url: string): Promise<ExtractedProductData> {
    console.log(`\n📦 [ExtractorClient]: Requesting product extraction...`);
    console.log(`   URL: ${url}`);
    console.log(`   Extractor: ${EXTRACTOR_URL}`);

    try {
      const response = await axios.post(
        `${EXTRACTOR_URL}/extract-product`,
        { url },
        {
          timeout: this.timeout,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.data || response.data.status === "error") {
        throw new Error(response.data?.error || "Extraction failed");
      }

      console.log(`✅ [ExtractorClient]: Product extracted successfully`);
      console.log(`   Title: ${response.data.title?.substring(0, 50)}...`);
      console.log(`   Price: ${response.data.price}`);
      console.log(`   Images: ${response.data.images?.length || 0}`);

      return {
        url: response.data.url || url,
        platform: response.data.platform || "unknown",
        title: response.data.title || null,
        price: this.parsePrice(response.data.price),
        originalPrice: this.parsePrice(response.data.original_price),
        currency: response.data.currency || "BRL",
        description: response.data.description || null,
        images: response.data.images || [],
        seller: response.data.seller || null,
        rating: response.data.rating || null,
        reviewCount: response.data.review_count || null,
        specifications: response.data.specifications || {},
        rawHtml: response.data.raw_html,
        extractionMethod: response.data.extraction_method || "selenium",
      };
    } catch (error: any) {
      console.error(`❌ [ExtractorClient]: Extraction failed`);
      console.error(`   Error: ${error.message}`);

      // Tentar fallback com extração SEO
      console.log(`🔄 [ExtractorClient]: Trying SEO fallback...`);
      return await this.extractProductWithSEOFallback(url);
    }
  }

  /**
   * Fallback: Extrai dados básicos usando meta tags SEO
   */
  static async extractProductWithSEOFallback(url: string): Promise<ExtractedProductData> {
    try {
      const seoData = await this.extractSEO(url);

      return {
        url,
        platform: this.detectPlatform(url),
        title: seoData.title || null,
        price: null,
        originalPrice: null,
        currency: "BRL",
        description: seoData.description || null,
        images: seoData.image ? [seoData.image] : [],
        seller: null,
        rating: null,
        reviewCount: null,
        specifications: {},
        extractionMethod: "seo_fallback",
      };
    } catch (error: any) {
      console.error(`❌ [ExtractorClient]: SEO fallback also failed`);
      throw new Error(`All extraction methods failed: ${error.message}`);
    }
  }

  /**
   * Extrai meta tags SEO (estilo WhatsApp link preview)
   */
  static async extractSEO(url: string): Promise<SEOExtractedData> {
    console.log(`🔍 [ExtractorClient]: Extracting SEO data...`);

    const response = await axios.post(
      `${EXTRACTOR_URL}/extract-seo`,
      { url },
      {
        timeout: 20000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  }

  /**
   * Extrai imagens de produto
   */
  static async extractImages(url: string, storeName?: string): Promise<string[]> {
    console.log(`🖼️ [ExtractorClient]: Extracting images...`);

    const response = await axios.post(
      `${EXTRACTOR_URL}/extract-images`,
      { url, store_name: storeName },
      {
        timeout: 30000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.data?.top_15_images) {
      return [];
    }

    return response.data.top_15_images.map((img: any) => img.url);
  }

  /**
   * Detecta plataforma pela URL
   */
  private static detectPlatform(url: string): string {
    const urlLower = url.toLowerCase();

    if (urlLower.includes("mercadolivre") || urlLower.includes("mercadolibre")) return "mercadolivre";
    if (urlLower.includes("amazon")) return "amazon";
    if (urlLower.includes("shopee")) return "shopee";
    if (urlLower.includes("aliexpress")) return "aliexpress";
    if (urlLower.includes("shein")) return "shein";
    if (urlLower.includes("magalu") || urlLower.includes("magazineluiza")) return "magazineluiza";
    if (urlLower.includes("americanas")) return "americanas";
    if (urlLower.includes("kabum")) return "kabum";

    return "unknown";
  }

  /**
   * Parse de preço para número
   */
  private static parsePrice(price: any): number | null {
    if (!price) return null;
    if (typeof price === "number") return price;

    const priceStr = String(price)
      .replace(/[R$\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");

    const parsed = parseFloat(priceStr);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Health check do serviço Extractor
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${EXTRACTOR_URL}/health`, {
        timeout: 5000,
      });
      return response.data?.status === "healthy";
    } catch {
      return false;
    }
  }
}

