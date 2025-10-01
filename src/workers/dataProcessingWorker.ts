import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { DataProcessingJobData } from "../queues/dataProcessingQueue";

async function processData(data: DataProcessingJobData): Promise<void> {
  console.log(`\n⚙️  Processando dados...`);
  console.log(`   Usuário: ${data.userId}`);
  console.log(`   Operação: ${data.operation}`);
  console.log(`   Dados:`, JSON.stringify(data.data, null, 2));

  // Simula processamento pesado
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`✅ Dados processados com sucesso para usuário ${data.userId}\n`);
}

export const dataProcessingWorker = new Worker<DataProcessingJobData>(
  "data-processing-queue",
  async (job: Job<DataProcessingJobData>) => {
    console.log(
      `🔄 Processando job ${job.id} (Tentativa ${job.attemptsMade + 1})`
    );

    try {
      await processData(job.data);
      return {
        success: true,
        timestamp: new Date().toISOString(),
        processedBy: "dataProcessingWorker",
      };
    } catch (error) {
      console.error(`❌ Erro ao processar job ${job.id}:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

dataProcessingWorker.on("completed", (job) => {
  console.log(`✨ Job ${job.id} completado!`);
});

dataProcessingWorker.on("failed", (job, err) => {
  console.error(`💥 Job ${job?.id} falhou:`, err.message);
});

dataProcessingWorker.on("error", (err) => {
  console.error("❌ Erro no worker:", err);
});

console.log("🔧 Data Processing Worker iniciado e aguardando jobs...");
