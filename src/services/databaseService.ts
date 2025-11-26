import axios from "axios";
import { AnalyzedProduct } from "./openaiProductAnalyzer";

/**
 * Serviço de banco de dados para o Worker
 * Comunica com dexd-api via REST (sem Prisma direto)
 */

const DEXD_API_URL = process.env.DEXD_API_URL || "http://localhost:3333";

export interface CreateProductDTO {
  name: string;
  description: string;
  price: number;
  originalPrice?: number | null;
  images: string[];
  tagIds: number[];
  userId: number;
  storeId?: number;
  dexdVideoId?: number | null;
  productUrl: string;
  platform: string;
  seller?: string | null;
}

export interface CreatedProduct {
  id: number;
  name: string;
  price: number;
  description: string;
  medias: { url: string }[];
  createdAt: Date;
}

export class DatabaseService {
  /**
   * Cria um produto via API do dexd-api
   */
  static async createProduct(data: CreateProductDTO): Promise<CreatedProduct> {
    console.log(`\n💾 [Database]: Creating product via dexd-api...`);
    console.log(`   Name: ${data.name?.substring(0, 50)}...`);
    console.log(`   Price: R$ ${data.price}`);
    console.log(`   Images: ${data.images?.length || 0}`);
    console.log(`   Tags: ${data.tagIds?.length || 0}`);

    try {
      // Chamar endpoint interno do dexd-api para criar produto
      const response = await axios.post(
        `${DEXD_API_URL}/internal/create-product-from-worker`,
        {
          name: data.name,
          description: data.description,
          price: data.price,
          originalPrice: data.originalPrice,
          medias: data.images.slice(0, 10).map((url) => ({ url })),
          tags: data.tagIds,
          userId: data.userId,
          storeId: data.storeId,
          dexdTvVideoId: data.dexdVideoId,
          link: data.productUrl,
          platform: data.platform,
          seller: data.seller,
        },
        {
          timeout: 30000,
          headers: {
            "Content-Type": "application/json",
            "X-Worker-Secret": process.env.WORKER_SECRET || "dexd-worker-internal",
          },
        }
      );

      if (!response.data?.success) {
        throw new Error(response.data?.error || "Failed to create product");
      }

      const product = response.data.product;
      console.log(`✅ [Database]: Product created with ID: ${product.id}`);

      return {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        description: product.description || "",
        medias: product.medias || [],
        createdAt: new Date(product.createdAt),
      };
    } catch (error: any) {
      console.error(`❌ [Database]: Failed to create product`);
      console.error(`   Error: ${error.message}`);
      
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data: ${JSON.stringify(error.response.data)}`);
      }
      
      throw error;
    }
  }

  /**
   * Busca ou cria tags via API
   */
  static async findOrCreateTags(tagNames: string[]): Promise<number[]> {
    console.log(`🏷️ [Database]: Processing ${tagNames.length} tags via API...`);

    try {
      const response = await axios.post(
        `${DEXD_API_URL}/internal/find-or-create-tags`,
        { tagNames: tagNames.slice(0, 10) },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
            "X-Worker-Secret": process.env.WORKER_SECRET || "dexd-worker-internal",
          },
        }
      );

      if (!response.data?.tagIds) {
        throw new Error("No tag IDs returned");
      }

      console.log(`✅ [Database]: ${response.data.tagIds.length} tags processed`);
      return response.data.tagIds;
    } catch (error: any) {
      console.error(`❌ [Database]: Failed to process tags: ${error.message}`);
      // Fallback: retornar array vazio
      return [];
    }
  }

  /**
   * Busca dados do usuário via API
   */
  static async getUser(userId: number): Promise<{
    id: number;
    storeId: number | null;
    subscriptionId: number | null;
  } | null> {
    try {
      const response = await axios.get(
        `${DEXD_API_URL}/internal/user/${userId}`,
        {
          timeout: 10000,
          headers: {
            "X-Worker-Secret": process.env.WORKER_SECRET || "dexd-worker-internal",
          },
        }
      );

      return response.data?.user || null;
    } catch (error: any) {
      console.error(`❌ [Database]: Failed to get user: ${error.message}`);
      return null;
    }
  }

  /**
   * Verifica limite de produtos do usuário via API
   */
  static async checkProductLimit(userId: number): Promise<{
    canCreate: boolean;
    used: number;
    limit: number;
    message?: string;
  }> {
    try {
      const response = await axios.get(
        `${DEXD_API_URL}/internal/check-product-limit/${userId}`,
        {
          timeout: 10000,
          headers: {
            "X-Worker-Secret": process.env.WORKER_SECRET || "dexd-worker-internal",
          },
        }
      );

      return response.data || { canCreate: true, used: 0, limit: 10 };
    } catch (error: any) {
      console.error(`❌ [Database]: Failed to check limit: ${error.message}`);
      // Em caso de erro, permitir criação
      return { canCreate: true, used: 0, limit: 10 };
    }
  }

  /**
   * Registra uso de produto via API
   */
  static async recordProductUsage(userId: number, productId: number): Promise<void> {
    try {
      await axios.post(
        `${DEXD_API_URL}/internal/record-usage`,
        {
          userId,
          featureKey: "productsPerMonth",
          entityType: "product",
          entityId: productId,
        },
        {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            "X-Worker-Secret": process.env.WORKER_SECRET || "dexd-worker-internal",
          },
        }
      );
      console.log(`📊 [Database]: Usage recorded for user ${userId}, product ${productId}`);
    } catch (error: any) {
      console.warn(`⚠️ [Database]: Could not record usage: ${error.message}`);
    }
  }

  /**
   * Disconnect (no-op para REST)
   */
  static async disconnect(): Promise<void> {
    // Nada a fazer para REST
  }
}
