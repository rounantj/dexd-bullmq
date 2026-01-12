import { Worker, Job } from "bullmq";
import axios from "axios";
import { redisConnection } from "../config/redis";
import { PaymentWebhookJobData } from "../queues/paymentProcessingQueue";

// URL da API do Dexd para processar pagamentos
const DEXD_API_URL = process.env.DEXD_API_URL || "http://localhost:3001";

/**
 * Processa o webhook de pagamento chamando a API do Dexd
 */
async function processPaymentWebhook(
  data: PaymentWebhookJobData
): Promise<any> {
  const startTime = Date.now();

  console.log("\n" + "💳".repeat(40));
  console.log("💳 [Payment Worker]: Processando webhook de pagamento...");
  console.log(`   📌 Event: ${data.event}`);
  console.log(`   💰 Payment ID: ${data.payment?.id}`);
  console.log(`   💵 Value: R$ ${data.payment?.value?.toFixed(2)}`);
  console.log(`   📋 Status: ${data.payment?.status}`);
  console.log(
    `   🔗 External Ref: ${data.payment?.externalReference || "N/A"}`
  );
  console.log(`   ⏰ Received At: ${data.receivedAt}`);
  console.log("💳".repeat(40) + "\n");

  try {
    // Chamar a rota interna do dexd-api para processar o webhook
    const response = await axios.post(
      `${DEXD_API_URL}/billing/payment/process-queued`,
      {
        event: data.event,
        payment: data.payment,
        processedAt: new Date().toISOString(),
        retryCount: data.retryCount || 0,
      },
      {
        timeout: 30000, // 30 segundos de timeout
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Worker": "payment-processing-worker",
          "X-Queue-Job": "true",
        },
      }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n✅ [Payment Worker]: Pagamento processado com sucesso!");
    console.log(`   ⏱️  Duração: ${duration}s`);
    console.log(`   📊 Resultado:`, JSON.stringify(response.data, null, 2));

    return {
      success: true,
      processedAt: new Date().toISOString(),
      duration: `${duration}s`,
      result: response.data,
    };
  } catch (error: any) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error("\n❌ [Payment Worker]: FALHA ao processar pagamento!");
    console.error(`   ⏱️  Duração: ${duration}s`);
    console.error(`   ❌ Error: ${error.message}`);

    if (error.response) {
      console.error(`   📊 Status: ${error.response.status}`);
      console.error(`   📊 Data:`, JSON.stringify(error.response.data));
    }

    // Re-throw para o BullMQ fazer retry
    throw error;
  }
}

/**
 * Worker dedicado para processamento de webhooks de pagamento da Asaas
 *
 * Características:
 * - Concorrência 5 (processa até 5 webhooks em paralelo)
 * - 10 tentativas com backoff exponencial
 * - Logs detalhados para auditoria
 */
export const paymentProcessingWorker = new Worker<PaymentWebhookJobData>(
  "payment-processing-queue",
  async (job: Job<PaymentWebhookJobData>) => {
    const startTime = Date.now();

    console.log("\n" + "🔔".repeat(40));
    console.log(
      `🔔 [Payment Worker]: JOB PICKED UP! Job ID: ${job.id} (Attempt ${
        job.attemptsMade + 1
      }/${job.opts.attempts || 10})`
    );
    console.log(`   📝 Event: ${job.data.event}`);
    console.log(`   💰 Payment: ${job.data.payment?.id}`);
    console.log(`   ⏰ Started at: ${new Date().toISOString()}`);
    console.log("🔔".repeat(40) + "\n");

    try {
      // Atualizar dados com contador de retry
      const dataWithRetry = {
        ...job.data,
        retryCount: job.attemptsMade,
      };

      const result = await processPaymentWebhook(dataWithRetry);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log("\n" + "✨".repeat(40));
      console.log(`✨ [Payment Worker]: JOB COMPLETED! Job ID: ${job.id}`);
      console.log(`   ⏱️  Duration: ${duration}s`);
      console.log("✨".repeat(40) + "\n");

      return {
        success: true,
        timestamp: new Date().toISOString(),
        result,
        duration: `${duration}s`,
      };
    } catch (error: any) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.error("\n" + "💥".repeat(40));
      console.error(`💥 [Payment Worker]: JOB FAILED! Job ID: ${job.id}`);
      console.error(`   ⏱️  Duration: ${duration}s`);
      console.error(
        `   ❌ Attempt: ${job.attemptsMade + 1}/${job.opts.attempts || 10}`
      );
      console.error(`   ❌ Error: ${error.message}`);
      console.error("💥".repeat(40) + "\n");

      // Logar informações detalhadas para debug
      if (job.attemptsMade >= 5) {
        console.error("⚠️ [ALERTA]: Job com muitas falhas consecutivas!");
        console.error(`   Payment ID: ${job.data.payment?.id}`);
        console.error(`   Event: ${job.data.event}`);
        console.error(
          `   External Ref: ${job.data.payment?.externalReference}`
        );
      }

      throw error; // Re-throw para o BullMQ fazer retry
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // Processa até 5 webhooks em paralelo
    removeOnComplete: { count: 500, age: 7 * 24 * 60 * 60 },
    removeOnFail: { count: 1000, age: 30 * 24 * 60 * 60 },
  }
);

// Event listeners para monitoramento
paymentProcessingWorker.on("completed", (job) => {
  console.log(`\n✅ [Event]: Payment job ${job.id} completed!`);
  console.log(`   Event: ${job.data.event}`);
  console.log(`   Payment: ${job.data.payment?.id}`);
});

paymentProcessingWorker.on("failed", (job, err) => {
  console.error(`\n❌ [Event]: Payment job ${job?.id} failed!`);
  console.error(`   Event: ${job?.data?.event}`);
  console.error(`   Payment: ${job?.data?.payment?.id}`);
  console.error(`   Error: ${err.message}`);
  console.error(
    `   Attempts: ${job?.attemptsMade}/${job?.opts?.attempts || 10}`
  );
});

paymentProcessingWorker.on("error", (err) => {
  console.error(`\n🚨 [Event]: Payment worker error!`);
  console.error(`   Error: ${err.message}`);
});

paymentProcessingWorker.on("active", (job) => {
  console.log(`\n⚡ [Event]: Payment job ${job.id} is now ACTIVE!`);
  console.log(`   Event: ${job.data.event}`);
  console.log(`   Payment: ${job.data.payment?.id}`);
});

paymentProcessingWorker.on("stalled", (jobId) => {
  console.error(`\n⚠️ [Event]: Payment job ${jobId} STALLED!`);
});

console.log("\n" + "💳".repeat(40));
console.log("💳 [PAYMENT WORKER INITIALIZATION]");
console.log(`   🌐 DEXD API URL: ${DEXD_API_URL}`);
console.log(`   🔄 Concurrency: 5 jobs in parallel`);
console.log(`   🔁 Max attempts: 10 with exponential backoff`);
console.log(`   💾 Keep completed: 500 jobs / 7 days`);
console.log(`   💾 Keep failed: 1000 jobs / 30 days`);
console.log("💳".repeat(40) + "\n");

console.log("💳 Payment Processing Worker started!");
console.log("✅ Worker is ready and listening for payment webhooks...\n");
