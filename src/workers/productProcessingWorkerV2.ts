import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  PRODUCT PROCESSING WORKER V2 - RATE LIMITED
 * ════════════════════════════════════════════════════════════════════════════
 *
 * PROBLEMA: Muitos jobs simultâneos sobrecarregam a API do dexd-api
 * SOLUÇÃO: Rate limiting - processa 1 job por vez com delay entre jobs
 *
 * Configuração via ENV:
 * - WORKER_CONCURRENCY: Quantos jobs simultâneos (default: 1)
 * - JOB_DELAY_MS: Delay entre jobs em ms (default: 5000 = 5 segundos)
 * - API_TIMEOUT_MS: Timeout da chamada à API (default: 300000 = 5 minutos)
 * ════════════════════════════════════════════════════════════════════════════
 */

const DEXD_API_URL = process.env.DEXD_API_URL || "http://localhost:3333";
const WORKER_SECRET = process.env.WORKER_SECRET || "dexd-worker-internal";

// Configurações de rate limiting
// 5 dynos da API = pode processar mais simultâneos
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "3");
const JOB_DELAY_MS = parseInt(process.env.JOB_DELAY_MS || "1000"); // 1 segundo entre jobs
const API_TIMEOUT_MS = parseInt(process.env.API_TIMEOUT_MS || "300000"); // 5 minutos

interface ProductProcessingJobData {
  videoLink: string;
  userId: number;
  dexdVideoId?: number | null;
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

// Controle de rate limiting manual
let lastJobTime = 0;

/**
 * Aguarda o delay mínimo entre jobs
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastJob = now - lastJobTime;

  if (timeSinceLastJob < JOB_DELAY_MS) {
    const waitTime = JOB_DELAY_MS - timeSinceLastJob;
    console.log(`⏳ [RateLimit]: Waiting ${waitTime}ms before next job...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  lastJobTime = Date.now();
}

/**
 * Processa um produto chamando o endpoint interno do dexd-api
 */
async function processProduct(
  data: ProductProcessingJobData,
  job: Job<ProductProcessingJobData>
): Promise<ProductResult> {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`📦 [ProductWorkerV2]: Processing product`);
  console.log(`   Job ID: ${job.id}`);
  console.log(`   Link: ${data.videoLink}`);
  console.log(`   User: ${data.userId}`);
  console.log(`   Timeout: ${API_TIMEOUT_MS / 1000}s`);
  console.log(`${"═".repeat(70)}\n`);

  try {
    await job.updateProgress(20);

    console.log(`🔧 [ProductWorkerV2]: Calling dexd-api internal endpoint...`);
    console.log(`   URL: ${DEXD_API_URL}/internal/extract-and-create-product`);

    const response = await axios.post(
      `${DEXD_API_URL}/internal/extract-and-create-product`,
      {
        videoLink: data.videoLink,
        userId: data.userId,
        dexdVideoId: data.dexdVideoId || null,
        options: data.options || {},
      },
      {
        timeout: API_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": WORKER_SECRET,
        },
      }
    );

    await job.updateProgress(90);

    // Verificar resposta
    const responseData = response.data?.data || response.data;

    if (!responseData?.success && !responseData?.product) {
      console.error(`❌ [ProductWorkerV2]: API returned unsuccessful response`);
      console.error(`   Response:`, JSON.stringify(responseData, null, 2));
      throw new Error(responseData?.error || "Failed to create product");
    }

    console.log(`✅ [ProductWorkerV2]: Product created successfully!`);
    console.log(`   Response success: ${responseData?.success}`);

    return {
      success: true,
      product: responseData?.product || responseData,
    };
  } catch (error: any) {
    console.error(`\n❌ [ProductWorkerV2]: Error processing product`);
    console.error(`   Message: ${error.message}`);

    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      console.error(`   ⏱️ TIMEOUT after ${API_TIMEOUT_MS / 1000} seconds`);
      return {
        success: false,
        error: `Timeout: API demorou mais de ${API_TIMEOUT_MS / 1000}s`,
      };
    }

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data: ${JSON.stringify(error.response.data)}`);

      // Erro de limite
      if (error.response.status === 403) {
        return {
          success: false,
          error: error.response.data?.error || "Limite excedido",
        };
      }

      // Erro de servidor sobrecarregado
      if (error.response.status === 503 || error.response.status === 502) {
        throw new Error("API sobrecarregada - retry automático");
      }
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  WORKER BULLMQ COM RATE LIMITING
// ════════════════════════════════════════════════════════════════════════════

const worker = new Worker<ProductProcessingJobData>(
  "product-processing-queue",
  async (job: Job<ProductProcessingJobData>) => {
    console.log(`\n🚀 [ProductWorkerV2]: Starting job ${job.id}`);
    console.log(
      `   Attempt: ${job.attemptsMade + 1}/${job.opts.attempts || 3}`
    );
    console.log(`   Queue position: Processing now...`);

    try {
      // RATE LIMITING: Aguarda delay entre jobs
      await waitForRateLimit();

      await job.updateProgress(10);

      // Processar produto
      const result = await processProduct(job.data, job);

      await job.updateProgress(100);

      if (!result.success) {
        // Se for erro de limite ou timeout, não fazer retry
        if (
          result.error?.includes("Limite") ||
          result.error?.includes("Timeout")
        ) {
          console.warn(
            `⚠️ [ProductWorkerV2]: Job ${job.id} failed (no retry): ${result.error}`
          );
          return {
            success: false,
            error: result.error,
            processedAt: new Date().toISOString(),
          };
        }
        throw new Error(result.error || "Product processing failed");
      }

      console.log(
        `\n✅ [ProductWorkerV2]: Job ${job.id} completed successfully!`
      );

      return {
        success: true,
        result,
        processedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error(
        `\n❌ [ProductWorkerV2]: Job ${job.id} failed:`,
        error.message
      );
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: WORKER_CONCURRENCY, // DEFAULT: 3 (5 dynos da API)
    limiter: {
      max: 3, // Máximo de 3 jobs simultâneos
      duration: JOB_DELAY_MS, // A cada X ms
    },
  }
);

// ════════════════════════════════════════════════════════════════════════════
//  EVENT HANDLERS
// ════════════════════════════════════════════════════════════════════════════

worker.on("completed", (job, result) => {
  console.log(`\n🎉 [ProductWorkerV2]: Job ${job.id} completed`);
  if (result?.result?.product) {
    console.log(
      `   Product ID: ${
        result.result.product.id || result.result.product.productId || "N/A"
      }`
    );
  }
});

worker.on("failed", (job, err) => {
  console.error(
    `\n💥 [ProductWorkerV2]: Job ${job?.id} failed after ${job?.attemptsMade} attempts`
  );
  console.error(`   Error: ${err.message}`);
});

worker.on("error", (err) => {
  console.error(`\n🔥 [ProductWorkerV2]: Worker error:`, err.message);
});

worker.on("ready", () => {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`🏭 PRODUCT PROCESSING WORKER V2 READY (RATE LIMITED)`);
  console.log(`${"═".repeat(70)}`);
  console.log(`   Queue: product-processing-queue`);
  console.log(`   Concurrency: ${WORKER_CONCURRENCY} job(s) at a time`);
  console.log(`   Rate Limit: 1 job every ${JOB_DELAY_MS / 1000}s`);
  console.log(`   API Timeout: ${API_TIMEOUT_MS / 1000}s`);
  console.log(`   API URL: ${DEXD_API_URL}`);
  console.log(`${"═".repeat(70)}\n`);
  console.log(`💡 Para ajustar, configure no Heroku:`);
  console.log(`   WORKER_CONCURRENCY=1`);
  console.log(`   JOB_DELAY_MS=5000`);
  console.log(`   API_TIMEOUT_MS=300000`);
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

console.log("🚀 [ProductWorkerV2]: Starting worker with rate limiting...");
