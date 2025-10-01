import { config } from "dotenv";
import Redis from "ioredis";

// Carrega variáveis de ambiente do arquivo .env
config();

// Cria a conexão Redis baseada em REDIS_URL ou REDIS_HOST/PORT/PASSWORD
export const redisConnection = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
    })
  : new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "25061"),
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      tls: process.env.REDIS_HOST ? {} : undefined, // Usa TLS se for cloud
    });
