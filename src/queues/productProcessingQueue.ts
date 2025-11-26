import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export interface ProductProcessingJobData {
  productLink?: string;
  videoLink?: string; // Aceita ambos os nomes de campo
  userId: number;
  dexdVideoId?: number | null;
  options?: {
    isMercadoLivre?: boolean;
    preferredCategory?: string;
    suggestedPrice?: number;
  };
}

export const productProcessingQueue = new Queue("product-processing-queue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

console.log("📦 Product Processing Queue criada com sucesso!");

