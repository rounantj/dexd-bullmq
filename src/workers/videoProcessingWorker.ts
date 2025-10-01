import { Worker, Job } from "bullmq";
import axios from "axios";
import { redisConnection } from "../config/redis";
import { VideoProcessingJobData } from "../queues/videoProcessingQueue";

// Função para processar o vídeo
async function processVideo(data: VideoProcessingJobData): Promise<any> {
  const apiUrl = process.env.DEXD_API_URL;

  if (!apiUrl) {
    throw new Error("DEXD_API_URL não está configurada no .env");
  }

  const endpoint = `${apiUrl}/system/link-to-product`;

  console.log(`\n🎬 Processando vídeo...`);
  console.log(`   Link: ${data.videoLink}`);
  console.log(`   Usuário: ${data.userId}`);
  console.log(`   Endpoint: ${endpoint}`);

  try {
    const response = await axios.post(endpoint, {
      videoLink: data.videoLink,
      isVideo: data.isVideo,
      userId: data.userId,
      type: data.type,
      fromBullMq: true,
    });

    console.log(`✅ Vídeo processado com sucesso!`);
    console.log(`   Status: ${response.status}`);

    return response.data;
  } catch (error: any) {
    console.error(`❌ Erro ao processar vídeo:`, error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    }
    throw error;
  }
}

export const videoProcessingWorker = new Worker<VideoProcessingJobData>(
  "video-processing-queue",
  async (job: Job<VideoProcessingJobData>) => {
    console.log(
      `🔄 Processando job ${job.id} (Tentativa ${job.attemptsMade + 1})`
    );

    try {
      const result = await processVideo(job.data);

      // Retorna o resultado que será armazenado no job
      return {
        success: true,
        timestamp: new Date().toISOString(),
        result: result,
      };
    } catch (error: any) {
      console.error(`❌ Erro ao processar job ${job.id}:`, error.message);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2, // Processa até 2 vídeos simultaneamente
  }
);

videoProcessingWorker.on("completed", (job) => {
  console.log(`✨ Job ${job.id} completado!`);
});

videoProcessingWorker.on("failed", (job, err) => {
  console.error(`💥 Job ${job?.id} falhou:`, err.message);
});

videoProcessingWorker.on("error", (err) => {
  console.error("❌ Erro no worker:", err);
});

console.log("🎬 Video Processing Worker iniciado e aguardando jobs...");
