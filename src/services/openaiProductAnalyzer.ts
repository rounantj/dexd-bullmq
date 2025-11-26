import OpenAI from "openai";
import { ExtractedProductData } from "./extractorClient";

/**
 * Serviço de análise de produtos usando OpenAI
 * Movido para o worker para não bloquear o dexd-api
 */

const MODEL_SELECTED = "gpt-4o-mini";

// Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AnalyzedProduct {
  name: string;
  description: string;
  shortDescription: string;
  price: number;
  originalPrice: number | null;
  category: string;
  tags: string[];
  suggestedTags: string[];
  images: string[];
  seller: string | null;
  platform: string;
  productUrl: string;
  isValidProduct: boolean;
  confidence: number;
}

export class OpenAIProductAnalyzer {
  /**
   * Analisa dados extraídos e gera informações estruturadas do produto
   */
  static async analyze(extractedData: ExtractedProductData): Promise<AnalyzedProduct> {
    console.log(`\n🤖 [OpenAI Analyzer]: Starting product analysis...`);
    console.log(`   Title: ${extractedData.title?.substring(0, 50)}...`);

    try {
      const prompt = this.buildAnalysisPrompt(extractedData);

      const startTime = Date.now();
      const response = await openai.chat.completions.create({
        model: MODEL_SELECTED,
        messages: [
          {
            role: "system",
            content: `Você é especialista em análise de produtos de e-commerce. 
Sua tarefa é analisar dados brutos de produtos e gerar informações estruturadas e otimizadas.
Sempre retorne JSON válido no formato especificado.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 2000,
      });

      const duration = Date.now() - startTime;
      console.log(`✅ [OpenAI Analyzer]: Analysis completed in ${duration}ms`);

      const content = response.choices[0].message.content || "{}";
      const analysis = JSON.parse(content);

      // Log de uso de tokens
      if (response.usage) {
        console.log(`📊 [OpenAI Analyzer]: Token usage:`, {
          input: response.usage.prompt_tokens,
          output: response.usage.completion_tokens,
          total: response.usage.total_tokens,
        });
      }

      return {
        name: analysis.name || extractedData.title || "Produto sem nome",
        description: analysis.description || extractedData.description || "",
        shortDescription: analysis.shortDescription || "",
        price: extractedData.price || analysis.suggestedPrice || 0,
        originalPrice: extractedData.originalPrice || null,
        category: analysis.category || "Geral",
        tags: analysis.tags || [],
        suggestedTags: analysis.suggestedTags || [],
        images: extractedData.images || [],
        seller: extractedData.seller || analysis.seller || null,
        platform: extractedData.platform,
        productUrl: extractedData.url,
        isValidProduct: analysis.isValidProduct !== false,
        confidence: analysis.confidence || 0.8,
      };
    } catch (error: any) {
      console.error(`❌ [OpenAI Analyzer]: Analysis failed`);
      console.error(`   Error: ${error.message}`);

      // Fallback: retornar dados básicos sem análise
      return this.buildFallbackProduct(extractedData);
    }
  }

  /**
   * Constrói o prompt de análise
   */
  private static buildAnalysisPrompt(data: ExtractedProductData): string {
    return `
Analise os dados deste produto extraído de ${data.platform}:

🔗 URL: ${data.url}
📦 Título Original: ${data.title || "Não disponível"}
💰 Preço: ${data.price ? `R$ ${data.price}` : "Não disponível"}
💵 Preço Original: ${data.originalPrice ? `R$ ${data.originalPrice}` : "Não disponível"}
📝 Descrição: ${data.description?.substring(0, 500) || "Não disponível"}
🏪 Vendedor: ${data.seller || "Não disponível"}
⭐ Avaliação: ${data.rating || "Não disponível"}
🖼️ Imagens: ${data.images?.length || 0} encontradas

INSTRUÇÕES:
1. Limpe e melhore o título (remover códigos, emojis excessivos, repetições)
2. Crie uma descrição concisa e atrativa (máx 300 caracteres)
3. Crie um resumo curto (máx 100 caracteres)
4. Sugira exatamente 10 tags relevantes em português
5. Identifique a categoria do produto
6. Avalie se é um produto válido (não é link quebrado, anúncio falso, etc)

RETORNE UM JSON:
{
  "name": "Nome limpo e otimizado do produto",
  "description": "Descrição concisa e atrativa do produto",
  "shortDescription": "Resumo em uma linha",
  "category": "Categoria principal do produto",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"],
  "suggestedTags": ["tags", "adicionais", "se", "relevantes"],
  "seller": "Nome do vendedor limpo",
  "suggestedPrice": null,
  "isValidProduct": true,
  "confidence": 0.9,
  "reasoning": "Breve explicação da análise"
}

REGRAS:
- Tags em português brasileiro
- Evite tags genéricas demais (ex: "produto", "venda")
- Se o título tiver código (ex: "MLB123456"), remova
- Se o preço não estiver disponível, defina suggestedPrice como null
- confidence deve refletir a qualidade dos dados (0.0 a 1.0)
`;
  }

  /**
   * Gera 10 tags baseadas na plataforma e categoria
   */
  static async generateTags(
    productName: string,
    description: string,
    platform: string
  ): Promise<string[]> {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL_SELECTED,
        messages: [
          {
            role: "system",
            content: "Você é especialista em categorização de produtos. Gere exatamente 10 tags relevantes em português.",
          },
          {
            role: "user",
            content: `
Produto: ${productName}
Descrição: ${description?.substring(0, 200) || "N/A"}
Plataforma: ${platform}

Gere exatamente 10 tags relevantes em português brasileiro para este produto.
Retorne apenas um array JSON: ["tag1", "tag2", ...]
`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 300,
      });

      const content = response.choices[0].message.content || "[]";
      const result = JSON.parse(content);
      return result.tags || result || [];
    } catch (error) {
      console.error("❌ [OpenAI Analyzer]: Tag generation failed");
      return this.getDefaultTags(platform);
    }
  }

  /**
   * Tags padrão por plataforma
   */
  private static getDefaultTags(platform: string): string[] {
    const platformTags: Record<string, string[]> = {
      mercadolivre: ["mercado livre", "compra online", "produto", "oferta", "promoção"],
      amazon: ["amazon", "prime", "produto importado", "eletrônicos", "tecnologia"],
      shopee: ["shopee", "frete grátis", "desconto", "loja online", "compra"],
      aliexpress: ["aliexpress", "importado", "china", "eletrônicos", "barato"],
      shein: ["shein", "moda", "roupa", "acessório", "tendência"],
      magazineluiza: ["magalu", "magazine luiza", "cashback", "oferta", "promoção"],
      kabum: ["kabum", "informática", "gamer", "hardware", "tecnologia"],
    };

    const baseTags = platformTags[platform] || ["produto", "compra", "online", "oferta", "loja"];
    const genericTags = ["qualidade", "novidade", "destaque", "recomendado", "popular"];

    return [...baseTags, ...genericTags].slice(0, 10);
  }

  /**
   * Produto fallback quando análise falha
   */
  private static buildFallbackProduct(data: ExtractedProductData): AnalyzedProduct {
    return {
      name: data.title || "Produto sem nome",
      description: data.description || "Descrição não disponível",
      shortDescription: data.title?.substring(0, 100) || "",
      price: data.price || 0,
      originalPrice: data.originalPrice || null,
      category: "Geral",
      tags: this.getDefaultTags(data.platform),
      suggestedTags: [],
      images: data.images || [],
      seller: data.seller || null,
      platform: data.platform,
      productUrl: data.url,
      isValidProduct: !!data.title,
      confidence: 0.3,
    };
  }
}

