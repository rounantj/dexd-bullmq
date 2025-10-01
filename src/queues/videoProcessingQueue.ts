import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export interface VideoProcessingJobData {
  videoLink: string;
  isVideo: boolean;
  userId: number;
  type: string;
}

export const videoProcessingQueue = new Queue("video-processing-queue", {
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

console.log("Video Processing Queue criada com sucesso!");
