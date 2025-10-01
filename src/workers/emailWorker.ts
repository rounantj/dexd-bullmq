import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { EmailJobData } from "../queues/emailQueue";

// Simulação de envio de email
async function sendEmail(data: EmailJobData): Promise<void> {
  console.log(`\n📧 Enviando email...`);
  console.log(`   Para: ${data.to}`);
  console.log(`   Assunto: ${data.subject}`);
  console.log(`   Corpo: ${data.body}`);

  // Simula delay de envio
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`✅ Email enviado com sucesso para ${data.to}\n`);
}

export const emailWorker = new Worker<EmailJobData>(
  "email-queue",
  async (job: Job<EmailJobData>) => {
    console.log(
      `🔄 Processando job ${job.id} (Tentativa ${job.attemptsMade + 1})`
    );

    try {
      await sendEmail(job.data);
      return { success: true, timestamp: new Date().toISOString() };
    } catch (error) {
      console.error(`❌ Erro ao processar job ${job.id}:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // Processa até 5 jobs simultaneamente
  }
);

emailWorker.on("completed", (job) => {
  console.log(`✨ Job ${job.id} completado!`);
});

emailWorker.on("failed", (job, err) => {
  console.error(`💥 Job ${job?.id} falhou:`, err.message);
});

emailWorker.on("error", (err) => {
  console.error("❌ Erro no worker:", err);
});

console.log("📬 Email Worker iniciado e aguardando jobs...");
