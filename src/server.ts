import express from "express";
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
import "./workers/emailWorker";
import "./workers/dataProcessingWorker";
import "./workers/videoProcessingWorker";
// NOTA: Worker de produtos está no dexd-api (usa todo o código existente)

const app = express();

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
      // Product endpoints (NEW!)
      addProductJob: "POST /api/product-processing",
      getProductJob: "GET /api/product-processing/:jobId",
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
    const { productLink, videoLink, userId, dexdVideoId, options }: ProductProcessingJobData =
      req.body;

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

// Montar o Bull Board
app.use("/admin/queues", serverAdapter.getRouter());

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
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n👋 Encerrando servidor...");
  await emailQueue.close();
  await dataProcessingQueue.close();
  await videoProcessingQueue.close();
  await productProcessingQueue.close();
  process.exit(0);
});
