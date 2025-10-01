import { emailQueue, EmailJobData } from "./queues/emailQueue";
import {
  dataProcessingQueue,
  DataProcessingJobData,
} from "./queues/dataProcessingQueue";
import "./workers/emailWorker";
import "./workers/dataProcessingWorker";

async function main() {
  console.log("🚀 Aplicação BullMQ iniciada!\n");

  // Adiciona alguns jobs de exemplo
  console.log("📝 Adicionando jobs de exemplo...\n");

  // Email job
  const emailJob = await emailQueue.add(
    "send-welcome-email" as any,
    {
      to: "test@example.com",
      subject: "Teste BullMQ",
      body: "Este é um email de teste do sistema de filas!",
    } as any
  );
  console.log(`✅ Email job criado: ${emailJob.id}`);

  // Data processing job
  const dataJob = await dataProcessingQueue.add(
    "process-user-data" as any,
    {
      userId: "user-001",
      operation: "create",
      data: {
        name: "Usuário Teste",
        email: "teste@example.com",
        createdAt: new Date().toISOString(),
      },
    } as any
  );
  console.log(`✅ Data processing job criado: ${dataJob.id}`);

  console.log("\n🎯 Workers estão processando os jobs...");
  console.log("Pressione Ctrl+C para encerrar.\n");

  // Monitora eventos das filas
  emailQueue.on("waiting", (jobId) => {
    console.log(`⏳ Email job ${jobId} aguardando processamento`);
  });

  dataProcessingQueue.on("waiting", (jobId) => {
    console.log(`⏳ Data job ${jobId} aguardando processamento`);
  });
}

main().catch((error) => {
  console.error("❌ Erro na aplicação:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("\n👋 Encerrando aplicação...");
  await emailQueue.close();
  await dataProcessingQueue.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n👋 Encerrando aplicação...");
  await emailQueue.close();
  await dataProcessingQueue.close();
  process.exit(0);
});
