import { Worker, Job } from "bullmq";
import axios from "axios";
import { redisConnection } from "../config/redis";
import { ProductProcessingJobData } from "../queues/productProcessingQueue";

// URL da API do dexd-api (onde a extração real acontece)
const DEXD_API_URL = process.env.DEXD_API_URL || "http://localhost:3333";

/**
 * Worker de processamento de produtos
 *
 * Este worker NÃO faz a extração diretamente - ele chama o dexd-api
 * para manter TODA a lógica de extração centralizada lá.
 *
 * Fluxo:
 * 1. Recebe job com productLink e userId
 * 2. Chama endpoint de extração no dexd-api
 * 3. Retorna os dados extraídos (productInfo)
 * 4. Quando o status é consultado, dexd-api cria o produto
 */
async function processProductWithExtraction(
  data: ProductProcessingJobData
): Promise<any> {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📦 [Product Worker]: Processing product extraction...`);
  console.log(`   Link: ${data.productLink}`);
  console.log(`   User: ${data.userId}`);
  console.log(`   VideoId: ${data.dexdVideoId || "N/A"}`);
  console.log(`${"=".repeat(80)}\n`);

  try {
    console.log("🔄 [Product Worker]: Calling dexd-api extraction endpoint...");

    // Chamar o endpoint de extração no dexd-api
    // Este endpoint FAZ A EXTRAÇÃO mas NÃO cria o produto
    const response = await axios.post(
      `${DEXD_API_URL}/system/extract-product-info`,
      {
        productLink: data.productLink,
        userId: data.userId,
        options: data.options || {},
      },
      {
        timeout: 120000, // 2 minutos - extração pode demorar
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.data?.success) {
      throw new Error(response.data?.error || "Extraction failed");
    }

    const productInfo = response.data.productInfo;

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ [Product Worker]: Extraction completed!`);
    console.log(`   Name: ${productInfo?.name || "N/A"}`);
    console.log(`   Price: ${productInfo?.price || 0}`);
    console.log(`   Images: ${productInfo?.images?.length || 0}`);
    console.log(`   Tags: ${productInfo?.suggestedTags?.length || 0}`);
    console.log(`${"=".repeat(80)}\n`);

    return {
      productInfo,
      productLink: data.productLink,
      userId: data.userId,
      dexdVideoId: data.dexdVideoId,
      options: data.options,
    };
  } catch (error: any) {
    console.error(`\n💥 [Product Worker]: Extraction FAILED!`);
    console.error(`   Error: ${error.message}`);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data: ${JSON.stringify(error.response.data)}`);
    }

    throw error;
  }
}

export const productProcessingWorker = new Worker<ProductProcessingJobData>(
  "product-processing-queue",
  async (job: Job<ProductProcessingJobData>) => {
    const startTime = Date.now();
    let timeoutId: NodeJS.Timeout | undefined;

    // Timeout de 3 minutos para extração de produto
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(`Job ${job.id} timeout after 180 seconds (3 minutes)`)
        );
      }, 180000);
    });

    try {
      console.log("\n" + "📦".repeat(40));
      console.log(
        `🔄 [Product Worker]: JOB PICKED UP! Job ID: ${job.id} (Attempt ${
          job.attemptsMade + 1
        }/${job.opts.attempts || 3})`
      );
      console.log(`   📝 Job Data:`, JSON.stringify(job.data, null, 2));
      console.log(`   ⏰ Started at: ${new Date().toISOString()}`);
      console.log("📦".repeat(40) + "\n");

      // Race entre processamento e timeout
      const result = (await Promise.race([
        processProductWithExtraction(job.data),
        timeoutPromise,
      ])) as any;

      if (timeoutId) clearTimeout(timeoutId);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log("\n" + "✨".repeat(40));
      console.log(`✅ [Product Worker]: JOB COMPLETED! Job ID: ${job.id}`);
      console.log(`   ⏱️  Duration: ${duration}s`);
      console.log("✨".repeat(40) + "\n");

      return {
        success: true,
        timestamp: new Date().toISOString(),
        result,
        duration: `${duration}s`,
      };
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.error("\n" + "💥".repeat(40));
      console.error(`❌ [Product Worker]: JOB FAILED! Job ID: ${job.id}`);
      console.error(`   ⏱️  Duration: ${duration}s`);
      console.error(`   Error: ${error.message}`);
      console.error("💥".repeat(40) + "\n");

      throw error;
    }
  },
  {
    connection: redisConnection,
    // ⚠️ Concorrência BAIXA para extração de produtos:
    // - Cada extração usa Puppeteer (pesado)
    // - Mercado Livre bloqueia muitas requisições simultâneas
    // - OpenAI tem rate limits
    // Para 2000 usuários: a fila gerencia, não a concorrência
    concurrency: 5,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  }
);

// Event listeners
productProcessingWorker.on("completed", (job) => {
  console.log(`\n🎉 [Product Event]: Job ${job.id} completed!`);
});

productProcessingWorker.on("failed", (job, err) => {
  console.error(
    `\n💀 [Product Event]: Job ${job?.id} failed! Error: ${err.message}`
  );
});

productProcessingWorker.on("active", (job) => {
  console.log(`\n⚡ [Product Event]: Job ${job.id} is now ACTIVE`);
  console.log(`   🔗 Product Link: ${job.data.productLink}`);
});

console.log("\n" + "📦".repeat(40));
console.log("📦 [PRODUCT WORKER INITIALIZATION]");
console.log(`   Concurrency: 5 (limited - Puppeteer + ML blocking)`);
console.log(`   Queue handles 2000 users, not concurrency`);
console.log(`   Max jobs in memory: 1000 completed, 500 failed`);
console.log("📦".repeat(40));
console.log("\n📦 Product Processing Worker started!");
console.log("✅ Worker is ready and listening for product jobs...\n");
