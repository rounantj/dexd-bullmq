import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export interface DataProcessingJobData {
  userId: string;
  data: Record<string, any>;
  operation: "create" | "update" | "delete";
}

export const dataProcessingQueue = new Queue("data-processing-queue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

console.log("Data Processing Queue criada com sucesso!");
