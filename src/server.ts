import express, { Request, Response, NextFunction } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "./queues/emailQueue";
import { dataProcessingQueue } from "./queues/dataProcessingQueue";
import {
  videoProcessingQueue,
  VideoProcessingJobData,
} from "./queues/videoProcessingQueue";
import {
  productProcessingQueue,
  ProductProcessingJobData,
} from "./queues/productProcessingQueue";
import {
  paymentProcessingQueue,
  PaymentWebhookJobData,
  isPaymentAlreadyProcessed,
  markPaymentAsProcessed,
  getProcessedPaymentInfo,
} from "./queues/paymentProcessingQueue";
import "./workers/emailWorker";
import "./workers/dataProcessingWorker";
import "./workers/videoProcessingWorker";
import "./workers/paymentProcessingWorker";
// NOTA: Worker de produtos está no dexd-api (usa todo o código existente)

const app = express();

// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICAÇÃO BÁSICA PARA O BULL BOARD DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

const BULL_BOARD_USER = process.env.BULL_BOARD_USER || "admin";
const BULL_BOARD_PASSWORD = process.env.BULL_BOARD_PASSWORD || "dexd@2025";

/**
 * Middleware de autenticação básica (Basic Auth)
 */
function basicAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Bull Board Dashboard"');
    return res.status(401).json({ error: "Autenticação necessária" });
  }

  // Decodificar credenciais Base64
  const base64Credentials = authHeader.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString(
    "utf-8"
  );
  const [username, password] = credentials.split(":");

  // Verificar credenciais
  if (username === BULL_BOARD_USER && password === BULL_BOARD_PASSWORD) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Bull Board Dashboard"');
  return res.status(401).json({ error: "Credenciais inválidas" });
}

// Middleware para parsear JSON
app.use(express.json());

// Porta dinâmica para Heroku, ou 5050 localmente
const PORT = process.env.PORT || 5050;

// Configurar Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue) as any,
    new BullMQAdapter(dataProcessingQueue) as any,
    new BullMQAdapter(videoProcessingQueue) as any,
    new BullMQAdapter(productProcessingQueue) as any,
    new BullMQAdapter(paymentProcessingQueue) as any,
  ],
  serverAdapter: serverAdapter,
});

// Rotas
app.get("/", (req, res) => {
  res.json({
    message: "🚀 BullMQ Server está rodando!",
    dashboard: `http://localhost:${PORT}/admin/queues`,
    endpoints: {
      dashboard: "/admin/queues",
      health: "/health",
      // Video endpoints
      addVideoJob: "POST /api/video-processing",
      getVideoJob: "GET /api/video-processing/:jobId",
      // Product endpoints
      addProductJob: "POST /api/product-processing",
      getProductJob: "GET /api/product-processing/:jobId",
      // Payment endpoints (Asaas webhooks)
      addPaymentJob: "POST /api/payment-processing",
      getPaymentJob: "GET /api/payment-processing/:jobId",
      getPaymentStats: "GET /api/payment-processing/stats",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// POST - Adicionar job de processamento de vídeo
app.post("/api/video-processing", async (req, res) => {
  try {
    const { videoLink, isVideo, userId, type }: VideoProcessingJobData =
      req.body;

    // Validação básica
    if (!videoLink || !userId) {
      return res.status(400).json({
        error: "Campos obrigatórios faltando",
        required: ["videoLink", "userId"],
      });
    }

    // Adiciona o job na fila
    const job = await videoProcessingQueue.add("process-video", {
      videoLink,
      isVideo: isVideo ?? true,
      userId,
      type: type || "video",
    });

    console.log(`✅ Job de vídeo criado: ${job.id}`);

    res.status(201).json({
      success: true,
      jobId: job.id,
      message: "Job adicionado à fila de processamento",
      data: {
        videoLink,
        userId,
        type: type || "video",
      },
    });
  } catch (error: any) {
    console.error("❌ Erro ao criar job:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao adicionar job à fila",
      message: error.message,
    });
  }
});

// GET - Consultar status e resultado do job
app.get("/api/video-processing/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await videoProcessingQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job não encontrado",
        jobId,
      });
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnValue = job.returnvalue;

    res.json({
      success: true,
      jobId: job.id,
      status: state,
      progress,
      data: {
        input: job.data,
        result: returnValue,
      },
      timestamps: {
        created: job.timestamp,
        processed: job.processedOn,
        finished: job.finishedOn,
      },
      attempts: {
        made: job.attemptsMade,
        total: job.opts.attempts,
      },
    });
  } catch (error: any) {
    console.error("❌ Erro ao buscar job:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao buscar job",
      message: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT PROCESSING ENDPOINTS (NEW!)
// ═══════════════════════════════════════════════════════════════════════════

// POST - Adicionar job de processamento de produto
app.post("/api/product-processing", async (req, res) => {
  try {
    const {
      productLink,
      videoLink,
      userId,
      dexdVideoId,
      options,
    }: ProductProcessingJobData = req.body;

    // Aceita tanto productLink quanto videoLink (compatibilidade com dexd-api)
    const link = productLink || videoLink;

    // Validação básica
    if (!link || !userId) {
      return res.status(400).json({
        error: "Campos obrigatórios faltando",
        required: ["productLink ou videoLink", "userId"],
      });
    }

    console.log(`\n📦 [Server]: Creating product job...`);
    console.log(`   Link: ${link}`);
    console.log(`   User: ${userId}`);
    console.log(`   VideoId: ${dexdVideoId || "N/A"}`);

    // Adiciona o job na fila (usando videoLink para o worker)
    const job = await productProcessingQueue.add("process-product", {
      videoLink: link, // Worker espera videoLink
      userId,
      dexdVideoId: dexdVideoId || null,
      options: options || {},
    });

    console.log(`✅ [Server]: Product job created: ${job.id}`);

    res.status(201).json({
      success: true,
      jobId: job.id,
      message: "Produto adicionado à fila de processamento",
      data: {
        productLink: link,
        userId,
        dexdVideoId,
      },
    });
  } catch (error: any) {
    console.error("❌ [Server]: Erro ao criar job de produto:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao adicionar job à fila",
      message: error.message,
    });
  }
});

// GET - Consultar status e resultado do job de produto
app.get("/api/product-processing/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    console.log(`\n📦 [Server]: Querying product job ${jobId}...`);

    const job = await productProcessingQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job não encontrado",
        jobId,
      });
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnValue = job.returnvalue;

    console.log(`   State: ${state}`);
    console.log(`   Has Result: ${!!returnValue}`);

    res.json({
      success: true,
      jobId: job.id,
      status: state,
      progress,
      data: {
        input: job.data,
        result: returnValue,
      },
      timestamps: {
        created: job.timestamp,
        processed: job.processedOn,
        finished: job.finishedOn,
      },
      attempts: {
        made: job.attemptsMade,
        total: job.opts.attempts,
      },
    });
  } catch (error: any) {
    console.error("❌ [Server]: Erro ao buscar job de produto:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao buscar job",
      message: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT PROCESSING ENDPOINTS (Asaas Webhooks)
// ═══════════════════════════════════════════════════════════════════════════

// POST - Adicionar job de processamento de pagamento (webhook Asaas)
app.post("/api/payment-processing", async (req, res) => {
  try {
    const { event, payment }: PaymentWebhookJobData = req.body;

    // Validação básica
    if (!event || !payment) {
      return res.status(400).json({
        error: "Campos obrigatórios faltando",
        required: ["event", "payment"],
      });
    }

    console.log(`\n💳 [Server]: Recebendo webhook de pagamento...`);
    console.log(`   Event: ${event}`);
    console.log(`   Payment ID: ${payment.id}`);
    console.log(`   Value: R$ ${payment.value?.toFixed(2)}`);
    console.log(`   Status: ${payment.status}`);

    // ═══════════════════════════════════════════════════════════════════════
    // IDEMPOTÊNCIA: Verificar se já processamos este webhook
    // ═══════════════════════════════════════════════════════════════════════
    const alreadyProcessed = await isPaymentAlreadyProcessed(payment.id, event);

    if (alreadyProcessed) {
      const previousInfo = await getProcessedPaymentInfo(payment.id, event);
      console.log(`⚠️ [Server]: Webhook DUPLICADO ignorado!`);
      console.log(`   Payment ID: ${payment.id}`);
      console.log(`   Event: ${event}`);
      console.log(`   Processado anteriormente: ${previousInfo?.processedAt}`);
      console.log(`   Job anterior: ${previousInfo?.jobId}`);

      // Retornar 200 OK para a Asaas não tentar novamente
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: "Webhook já foi processado anteriormente",
        previousJobId: previousInfo?.jobId,
        previouslyProcessedAt: previousInfo?.processedAt,
        data: {
          event,
          paymentId: payment.id,
        },
      });
    }

    // Adiciona o job na fila com prioridade baseada no evento
    const priority =
      event.includes("RECEIVED") || event.includes("CONFIRMED")
        ? 1 // Alta prioridade para pagamentos confirmados
        : event.includes("OVERDUE") || event.includes("FAILED")
        ? 2 // Média prioridade para problemas
        : 3; // Baixa prioridade para outros

    const job = await paymentProcessingQueue.add(
      "process-payment-webhook",
      {
        event,
        payment,
        receivedAt: new Date().toISOString(),
      },
      { priority }
    );

    // Marcar como processado IMEDIATAMENTE após enfileirar
    await markPaymentAsProcessed(payment.id, event, job.id!);

    console.log(
      `✅ [Server]: Payment job criado: ${job.id} (priority: ${priority})`
    );
    console.log(`   🔒 Marcado como processado para evitar duplicatas`);

    // Resposta rápida para a Asaas (importante!)
    res.status(200).json({
      success: true,
      jobId: job.id,
      message: "Webhook recebido e enfileirado para processamento",
      data: {
        event,
        paymentId: payment.id,
        priority,
      },
    });
  } catch (error: any) {
    console.error(
      "❌ [Server]: Erro ao enfileirar webhook de pagamento:",
      error
    );

    // IMPORTANTE: Retornar 500 para a Asaas tentar novamente
    res.status(500).json({
      success: false,
      error: "Erro ao processar webhook",
      message: error.message,
    });
  }
});

// GET - Consultar status e resultado do job de pagamento
app.get("/api/payment-processing/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await paymentProcessingQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job não encontrado",
        jobId,
      });
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnValue = job.returnvalue;

    res.json({
      success: true,
      jobId: job.id,
      status: state,
      progress,
      data: {
        input: {
          event: job.data.event,
          paymentId: job.data.payment?.id,
          value: job.data.payment?.value,
          status: job.data.payment?.status,
        },
        result: returnValue,
      },
      timestamps: {
        received: job.data.receivedAt,
        created: job.timestamp,
        processed: job.processedOn,
        finished: job.finishedOn,
      },
      attempts: {
        made: job.attemptsMade,
        total: job.opts.attempts,
      },
    });
  } catch (error: any) {
    console.error("❌ [Server]: Erro ao buscar job de pagamento:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao buscar job",
      message: error.message,
    });
  }
});

// GET - Estatísticas da fila de pagamentos
app.get("/api/payment-processing/stats", async (req, res) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      paymentProcessingQueue.getWaitingCount(),
      paymentProcessingQueue.getActiveCount(),
      paymentProcessingQueue.getCompletedCount(),
      paymentProcessingQueue.getFailedCount(),
      paymentProcessingQueue.getDelayedCount(),
    ]);

    res.json({
      success: true,
      stats: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("❌ [Server]: Erro ao buscar stats:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao buscar estatísticas",
      message: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════

// Montar o Bull Board COM AUTENTICAÇÃO
app.use("/admin/queues", basicAuth, serverAdapter.getRouter());

console.log(`🔐 Bull Board protegido com autenticação básica`);
console.log(`   User: ${BULL_BOARD_USER}`);
console.log(`   Password: ${"*".repeat(BULL_BOARD_PASSWORD.length)}`);

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor iniciado!`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/admin/queues`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log(`\n📬 Workers estão rodando e processando jobs...`);
  console.log(`Pressione Ctrl+C para encerrar.\n`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("\n👋 Encerrando servidor...");
  await emailQueue.close();
  await dataProcessingQueue.close();
  await videoProcessingQueue.close();
  await productProcessingQueue.close();
  await paymentProcessingQueue.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n👋 Encerrando servidor...");
  await emailQueue.close();
  await dataProcessingQueue.close();
  await videoProcessingQueue.close();
  await productProcessingQueue.close();
  await paymentProcessingQueue.close();
  process.exit(0);
});
