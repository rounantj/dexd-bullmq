import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  PRODUCT PROCESSING WORKER V2
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Este worker processa produtos de forma ASSÍNCRONA, chamando o código
 * EXISTENTE do dexd-api através de um endpoint interno protegido.
 * 
 * Fluxo:
 * 1. Frontend envia link → dexd-api enfileira no BullMQ
 * 2. Este worker pega o job e chama /internal/extract-and-create-product
 * 3. O dexd-api processa usando o código existente (affiliate-link.ts)
 * 4. Worker retorna resultado
 * 
 * IMPORTANTE: Todo o código de extração (Puppeteer, Chinese stores, etc.)
 * continua no dexd-api - este worker apenas orquestra.
 * ════════════════════════════════════════════════════════════════════════════
 */

const DEXD_API_URL = process.env.DEXD_API_URL || "http://localhost:3333";
const WORKER_SECRET = process.env.WORKER_SECRET || "dexd-worker-internal";

interface ProductProcessingJobData {
  videoLink: string;
  userId: number;
  options?: {
    isMercadoLivre?: boolean;
    preferredCategory?: string;
    suggestedPrice?: number;
  };
}

interface ProductResult {
  success: boolean;
  product?: any;
  error?: string;
}

/**
 * Processa um produto chamando o endpoint interno do dexd-api
 */
async function processProduct(data: ProductProcessingJobData): Promise<ProductResult> {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`📦 [ProductWorkerV2]: Processing product`);
  console.log(`   Link: ${data.videoLink}`);
  console.log(`   User: ${data.userId}`);
  console.log(`${"═".repeat(70)}\n`);

  try {
    // Chamar o endpoint interno que usa o código EXISTENTE
    console.log(`🔧 [ProductWorkerV2]: Calling dexd-api internal endpoint...`);
    
    const response = await axios.post(
      `${DEXD_API_URL}/internal/extract-and-create-product`,
      {
        videoLink: data.videoLink,
        userId: data.userId,
        options: data.options || {},
      },
      {
        timeout: 180000, // 3 minutos - extração pode demorar
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": WORKER_SECRET,
        },
      }
    );

    if (!response.data?.success) {
      throw new Error(response.data?.error || "Failed to create product");
    }

    console.log(`✅ [ProductWorkerV2]: Product created successfully!`);
    console.log(`   Product ID: ${response.data.product?.id || "N/A"}`);

    return {
      success: true,
      product: response.data.product,
    };

  } catch (error: any) {
    console.error(`❌ [ProductWorkerV2]: Error processing product`);
    console.error(`   Message: ${error.message}`);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data: ${JSON.stringify(error.response.data)}`);

      // Se for erro de limite, propagar
      if (error.response.status === 403) {
        return {
          success: false,
          error: error.response.data?.error || "Limite excedido",
        };
      }
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  WORKER BULLMQ
// ════════════════════════════════════════════════════════════════════════════

const worker = new Worker<ProductProcessingJobData>(
  "product-processing-queue",
  async (job: Job<ProductProcessingJobData>) => {
    console.log(`\n🚀 [ProductWorkerV2]: Starting job ${job.id}`);
    console.log(`   Attempt: ${job.attemptsMade + 1}/${job.opts.attempts || 3}`);

    try {
      // Atualizar progresso
      await job.updateProgress(10);

      // Processar produto
      const result = await processProduct(job.data);

      await job.updateProgress(100);

      if (!result.success) {
        throw new Error(result.error || "Product processing failed");
      }

      console.log(`\n✅ [ProductWorkerV2]: Job ${job.id} completed successfully!`);

      return {
        success: true,
        result,
        processedAt: new Date().toISOString(),
      };

    } catch (error: any) {
      console.error(`\n❌ [ProductWorkerV2]: Job ${job.id} failed:`, error.message);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2, // Processa 2 produtos em paralelo
    limiter: {
      max: 10,
      duration: 60000, // Máximo 10 jobs por minuto
    },
  }
);

// ════════════════════════════════════════════════════════════════════════════
//  EVENT HANDLERS
// ════════════════════════════════════════════════════════════════════════════

worker.on("completed", (job, result) => {
  console.log(`\n🎉 [ProductWorkerV2]: Job ${job.id} completed`);
  console.log(`   Product: ${result?.result?.product?.name || "N/A"}`);
});

worker.on("failed", (job, err) => {
  console.error(`\n💥 [ProductWorkerV2]: Job ${job?.id} failed after ${job?.attemptsMade} attempts`);
  console.error(`   Error: ${err.message}`);
});

worker.on("error", (err) => {
  console.error(`\n🔥 [ProductWorkerV2]: Worker error:`, err.message);
});

worker.on("ready", () => {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`🏭 PRODUCT PROCESSING WORKER V2 READY`);
  console.log(`   Queue: product-processing-queue`);
  console.log(`   Concurrency: 2`);
  console.log(`   API: ${DEXD_API_URL}`);
  console.log(`${"═".repeat(70)}\n`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("\n⏳ [ProductWorkerV2]: Shutting down gracefully...");
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n⏳ [ProductWorkerV2]: Interrupted, shutting down...");
  await worker.close();
  process.exit(0);
});

console.log("🚀 [ProductWorkerV2]: Starting worker...");
