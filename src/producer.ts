import { emailQueue, EmailJobData } from "./queues/emailQueue";
import {
  dataProcessingQueue,
  DataProcessingJobData,
} from "./queues/dataProcessingQueue";

async function addJobs() {
  console.log("🚀 Adicionando jobs nas filas...\n");

  // Adicionar jobs de email
  const emailJobs: EmailJobData[] = [
    {
      to: "user1@example.com",
      subject: "Bem-vindo!",
      body: "Obrigado por se cadastrar em nossa plataforma.",
      priority: 1,
    },
    {
      to: "user2@example.com",
      subject: "Confirmação de Pedido",
      body: "Seu pedido #12345 foi confirmado.",
      priority: 2,
    },
    {
      to: "user3@example.com",
      subject: "Newsletter Semanal",
      body: "Confira as novidades desta semana!",
      priority: 3,
    },
  ];

  for (const emailData of emailJobs) {
    const job = await emailQueue.add("send-email" as any, emailData as any, {
      priority: emailData.priority,
    });
    console.log(`✅ Email job adicionado: ${job.id} (Para: ${emailData.to})`);
  }

  console.log("");

  // Adicionar jobs de processamento de dados
  const dataJobs: DataProcessingJobData[] = [
    {
      userId: "user-123",
      operation: "create",
      data: {
        name: "João Silva",
        email: "joao@example.com",
        role: "admin",
      },
    },
    {
      userId: "user-456",
      operation: "update",
      data: {
        status: "active",
        lastLogin: new Date().toISOString(),
      },
    },
    {
      userId: "user-789",
      operation: "delete",
      data: {
        reason: "User requested account deletion",
      },
    },
  ];

  for (const dataJobData of dataJobs) {
    const job = await dataProcessingQueue.add(
      "process-data" as any,
      dataJobData as any
    );
    console.log(
      `✅ Data processing job adicionado: ${job.id} (Usuário: ${dataJobData.userId})`
    );
  }

  console.log("\n🎉 Todos os jobs foram adicionados às filas!");

  // Mostrar estatísticas das filas
  setTimeout(async () => {
    const emailStats = await emailQueue.getJobCounts();
    const dataStats = await dataProcessingQueue.getJobCounts();

    console.log("\n📊 Estatísticas das filas:");
    console.log("Email Queue:", emailStats);
    console.log("Data Processing Queue:", dataStats);

    process.exit(0);
  }, 1000);
}

addJobs().catch((error) => {
  console.error("❌ Erro ao adicionar jobs:", error);
  process.exit(1);
});
