import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

/**
 * Interface do payload de webhook da Asaas
 */
export interface PaymentWebhookJobData {
  event: string;
  payment: {
    id: string;
    customer: string;
    value: number;
    netValue?: number;
    billingType: string;
    status: string;
    paymentDate?: string;
    dueDate?: string;
    invoiceUrl?: string;
    externalReference?: string;
    description?: string;
    creditCard?: any;
    discount?: any;
    fine?: any;
    interest?: any;
    postalService?: boolean;
    split?: any[];
  };
  receivedAt: string; // Timestamp de quando recebemos o webhook
  retryCount?: number; // Contador de retentativas
}

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTÊNCIA: Prevenir processamento duplicado
// ═══════════════════════════════════════════════════════════════════════════

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 horas em segundos
const IDEMPOTENCY_PREFIX = "payment:processed:";

/**
 * Verifica se um webhook já foi processado
 * @returns true se já foi processado, false se é novo
 */
export async function isPaymentAlreadyProcessed(
  paymentId: string,
  event: string
): Promise<boolean> {
  const key = `${IDEMPOTENCY_PREFIX}${paymentId}:${event}`;
  const exists = await redisConnection.get(key);
  return exists !== null;
}

/**
 * Marca um webhook como processado
 */
export async function markPaymentAsProcessed(
  paymentId: string,
  event: string,
  jobId: string
): Promise<void> {
  const key = `${IDEMPOTENCY_PREFIX}${paymentId}:${event}`;
  await redisConnection.setex(key, IDEMPOTENCY_TTL, JSON.stringify({
    jobId,
    processedAt: new Date().toISOString(),
  }));
}

/**
 * Obtém informações de um webhook já processado
 */
export async function getProcessedPaymentInfo(
  paymentId: string,
  event: string
): Promise<{ jobId: string; processedAt: string } | null> {
  const key = `${IDEMPOTENCY_PREFIX}${paymentId}:${event}`;
  const data = await redisConnection.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Fila dedicada para processamento de webhooks de pagamento da Asaas
 * 
 * Objetivo: Garantir que NENHUMA notificação da Asaas seja perdida
 * - Resposta imediata 200 OK para a Asaas
 * - Processamento assíncrono com retentativas
 * - Persistência em caso de falha
 */
export const paymentProcessingQueue = new Queue<PaymentWebhookJobData>(
  "payment-processing-queue",
  {
    connection: redisConnection,
    defaultJobOptions: {
      // Configuração agressiva de retentativas para garantir processamento
      attempts: 10, // 10 tentativas antes de falhar definitivamente
      backoff: {
        type: "exponential",
        delay: 5000, // Começa com 5 segundos, dobra a cada tentativa
      },
      removeOnComplete: {
        count: 500, // Manter últimos 500 jobs completos para auditoria
        age: 7 * 24 * 60 * 60, // Manter por 7 dias
      },
      removeOnFail: {
        count: 1000, // Manter últimos 1000 jobs falhos para análise
        age: 30 * 24 * 60 * 60, // Manter por 30 dias
      },
    },
  }
);

console.log("💳 Payment Processing Queue criada com sucesso!");
console.log("   └── 10 tentativas com backoff exponencial");
console.log("   └── Persistência: 7 dias (sucesso), 30 dias (falha)");

