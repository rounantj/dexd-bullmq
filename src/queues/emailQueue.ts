import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
  priority?: number;
}

export const emailQueue = new Queue("email-queue", {
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

console.log("Email Queue criada com sucesso!");
