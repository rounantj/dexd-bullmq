import { Worker, Job } from "bullmq";
import axios from "axios";
import { redisConnection } from "../config/redis";
import { VideoProcessingJobData } from "../queues/videoProcessingQueue";
import OpenAI from "openai";

const MODEL_SELECTED = "gpt-4o-mini";

// Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Detecta qual plataforma o link pertence usando OpenAI
 */
async function detectVideoPlatform(link: string): Promise<string> {
  try {
    const prompt = `Detecte qual plataforma o link pertence e devolva apenas a palavra correspondente a plataforma sendo possiveis: tiktok, instagram, facebook, youtube-shorts, youtube, outros. Link: ${link}`;

    const response = await openai.chat.completions.create({
      model: MODEL_SELECTED,
      messages: [{ role: "system", content: prompt }],
      temperature: 0,
      max_tokens: 100,
    });

    return (
      response.choices[0].message.content?.toLowerCase().trim() || "outros"
    );
  } catch (error) {
    console.error("❌ [Worker]: Error detecting platform:", error);
    return "outros";
  }
}

/**
 * Extrai ID do vídeo do YouTube
 */
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Busca metadados do YouTube usando a API oficial do Google
 */
async function fetchYouTubeMetadata(url: string): Promise<any> {
  try {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      console.warn("⚠️ [Worker]: Could not extract YouTube video ID");
      return null;
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.warn("⚠️ [Worker]: GOOGLE_API_KEY not found");
      return null;
    }

    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    apiUrl.searchParams.append("part", "snippet,statistics,contentDetails");
    apiUrl.searchParams.append("id", videoId);
    apiUrl.searchParams.append("key", apiKey);

    const response = await axios.get(apiUrl.toString());

    if (response.data?.items && response.data.items.length > 0) {
      const video = response.data.items[0];
      const snippet = video.snippet;
      const statistics = video.statistics;
      const contentDetails = video.contentDetails;

      console.log(
        `✅ [Worker]: YouTube metadata fetched for video: ${snippet.title}`
      );

      return {
        id: video.id,
        title: snippet.title,
        description: snippet.description,
        channelTitle: snippet.channelTitle,
        publishedAt: snippet.publishedAt,
        thumbnails: snippet.thumbnails,
        tags: snippet.tags || [],
        categoryId: snippet.categoryId,
        duration: contentDetails.duration,
        viewCount: statistics.viewCount || "0",
        likeCount: statistics.likeCount || "0",
        commentCount: statistics.commentCount || "0",
      };
    }

    return null;
  } catch (error) {
    console.error("❌ [Worker]: Error fetching YouTube metadata:", error);
    return null;
  }
}

/**
 * Busca metadados do vídeo com base na plataforma
 */
async function getVideoMetadata(link: string): Promise<any> {
  const platform = await detectVideoPlatform(link);
  console.log(`📱 [Worker]: Platform detected: ${platform}`);

  let videoMetadata: any = {
    platform,
    url: link,
    title: null,
    description: null,
    tags: [],
  };

  // Buscar metadados específicos da plataforma
  if (platform === "youtube" || platform === "youtube-shorts") {
    const youtubeData = await fetchYouTubeMetadata(link);
    if (youtubeData) {
      videoMetadata = {
        ...videoMetadata,
        ...youtubeData,
      };
    }
  }

  // Tentar buscar conteúdo da página como fallback
  try {
    const response = await axios.get(link, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    videoMetadata.pageContent = response.data;
  } catch (error) {
    console.warn("⚠️ [Worker]: Could not fetch page content");
  }

  return videoMetadata;
}

function extractAllLinksFromText(text: string): string[] {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
  return text.match(urlRegex) || [];
}

function isProductLink(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    const searchParams = urlObj.searchParams.toString().toLowerCase();

    // Lista de domínios de e-commerce conhecidos
    const productDomains = [
      "amazon",
      "mercadolivre",
      "mercadolibre",
      "magalu",
      "magazineluiza",
      "americanas",
      "submarino",
      "shopee",
      "aliexpress",
      "shein",
      "kabum",
      "amzn.to",
      "amzn.com",
      "netshoes",
      "dafiti",
      "zattini",
      "walmart",
      "carrefour",
      "hotmart",
      "eduzz",
      "monetizze",
      "pichau",
      "terabyteshop",
    ];

    // Verificar se é um domínio de produto conhecido
    if (productDomains.some((domain) => hostname.includes(domain))) {
      return true;
    }

    // Verificar se é um link encurtado (muitos links de produtos são encurtados)
    const shortenedLinkDomains = [
      "bit.ly",
      "tinyurl.com",
      "goo.gl",
      "t.co",
      "ow.ly",
      "is.gd",
      "buff.ly",
      "adf.ly",
    ];
    if (shortenedLinkDomains.some((domain) => hostname.includes(domain))) {
      return true;
    }

    // Palavras-chave que indicam produto
    const productKeywords = [
      "product",
      "produto",
      "item",
      "buy",
      "comprar",
      "purchase",
      "shop",
      "loja",
      "store",
      "cart",
      "carrinho",
      "checkout",
      "dp/",
      "gp/product",
    ];

    // Verificar se a URL contém palavras-chave de produto
    const hasProductKeyword = productKeywords.some(
      (keyword) => pathname.includes(keyword) || searchParams.includes(keyword)
    );

    // Verificar se tem parâmetros típicos de e-commerce/afiliados
    const hasEcommerceParams = [
      "ref=",
      "tag=",
      "camp=",
      "link=",
      "affiliate=",
      "partner=",
    ].some((param) => searchParams.includes(param));

    return hasProductKeyword || hasEcommerceParams;
  } catch {
    return false;
  }
}

function extractAllProductLinksDirectly(
  videoLink: string,
  videoMetadata: any
): any[] {
  const allLinks: any[] = [];

  // Extrair links da descrição (vem da API do YouTube)
  if (videoMetadata?.description) {
    const links = extractAllLinksFromText(videoMetadata.description);
    allLinks.push(
      ...links.map((link) => ({
        url: link,
        source: "description",
        confidence: 0.9,
        isProduct: isProductLink(link),
      }))
    );
  }

  // Extrair links do conteúdo da página
  if (videoMetadata?.pageContent) {
    const pageText =
      typeof videoMetadata.pageContent === "string"
        ? videoMetadata.pageContent
        : JSON.stringify(videoMetadata.pageContent);
    const links = extractAllLinksFromText(pageText);

    allLinks.push(
      ...links.map((link) => ({
        url: link,
        source: "page",
        confidence: 0.7,
        isProduct: isProductLink(link),
      }))
    );
  }

  const seen = new Set();
  const unique = allLinks.filter((link) => {
    const normalized = link.url.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  const productLinks = unique.filter((l) => l.isProduct);
  console.log(`✅ [Worker]: Found ${productLinks.length} product links`);

  return productLinks;
}

function extractProductNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split("/").filter((s) => s.length > 0);
    if (segments.length > 0) {
      return segments[segments.length - 1]
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
    }
    return "Produto";
  } catch {
    return "Produto";
  }
}

async function extractTitlesFromLinksWithAI(
  links: any[],
  videoMetadata: any
): Promise<any[]> {
  if (links.length === 0) return [];

  try {
    const linksInfo = links.map((link, index) => ({
      id: index + 1,
      url: link.url,
      source: link.source,
    }));

    const prompt = `Analise os links encontrados e extraia títulos descritivos para cada um.

CONTEÚDO DO VÍDEO:
${videoMetadata?.title ? `Título: ${videoMetadata.title}` : ""}
${
  videoMetadata?.description
    ? `Descrição: ${videoMetadata.description?.substring(0, 500)}`
    : ""
}

LINKS ENCONTRADOS:
${JSON.stringify(linksInfo, null, 2)}

Retorne JSON: { "links": [{ "id": 1, "url": "...", "title": "...", "type": "product", "description": "..." }] }`;

    const response = await openai.chat.completions.create({
      model: MODEL_SELECTED,
      messages: [
        {
          role: "system",
          content: "Você é especialista em análise de links de produtos.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 4000,
    });

    const content = response.choices[0].message.content || "{}";
    const result = JSON.parse(content);

    return links.map((link, index) => {
      const aiResult = result.links?.find((l: any) => l.id === index + 1);
      return {
        ...link,
        productName: aiResult?.title || extractProductNameFromUrl(link.url),
        type: aiResult?.type || "unknown",
        description: aiResult?.description || "",
      };
    });
  } catch (error) {
    console.error("❌ [Worker]: Error extracting titles:", error);
    return links.map((link) => ({
      ...link,
      productName: extractProductNameFromUrl(link.url),
      type: "unknown",
      description: "",
    }));
  }
}

async function analyzeVideoContentWithAI(
  videoMetadata: any,
  videoLink: string
): Promise<any> {
  try {
    const allExtractedLinks = extractAllProductLinksDirectly(
      videoLink,
      videoMetadata
    );
    const linksWithTitles = await extractTitlesFromLinksWithAI(
      allExtractedLinks,
      videoMetadata
    );

    // Se já temos metadados da API do YouTube, usar eles e complementar com IA
    const hasYouTubeData = videoMetadata?.title && videoMetadata?.description;

    if (hasYouTubeData) {
      console.log("✅ [Worker]: Using YouTube API metadata + AI for tags");

      // Usar IA apenas para gerar tags baseadas no conteúdo
      const tagsPrompt = `Analise este vídeo do YouTube e gere exatamente 10 tags relevantes em português.

Título: ${videoMetadata.title}
Descrição: ${videoMetadata.description?.substring(0, 1000)}
Canal: ${videoMetadata.channelTitle || "Desconhecido"}

Retorne JSON: { "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"] }

Regras:
- Exatamente 10 tags
- Tags em português brasileiro
- Tags relevantes ao conteúdo`;

      const tagsResponse = await openai.chat.completions.create({
        model: MODEL_SELECTED,
        messages: [
          {
            role: "system",
            content: "Você é especialista em categorização de vídeos.",
          },
          { role: "user", content: tagsPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 500,
      });

      const tagsResult = JSON.parse(
        tagsResponse.choices[0].message.content || "{}"
      );

      const videoInfo: any = {
        title: videoMetadata.title,
        description: videoMetadata.description,
        platform: videoMetadata.platform,
        thumbnail:
          videoMetadata.thumbnails?.high?.url ||
          videoMetadata.thumbnails?.default?.url ||
          null,
        duration: videoMetadata.duration || null,
        category: "Vídeo",
        tags: tagsResult.tags || [
          "video",
          "conteudo",
          "midia",
          "digital",
          "importado",
          "automatico",
          "social",
          "plataforma",
          "compartilhamento",
          "online",
        ],
        language: "pt-BR",
        author: videoMetadata.channelTitle || "Desconhecido",
        price: 0,
        isEducational: false,
        targetAudience: "Geral",
        mainTopic: videoMetadata.title || "Conteúdo de vídeo",
        hasProductMentions: linksWithTitles.length > 0,
        contentType: "other",
        productAnalysis: {
          hasProducts: linksWithTitles.length > 0,
          productLinks: linksWithTitles.map((link: any) => link.url),
          productsInfo: [...linksWithTitles],
          totalFound: linksWithTitles.length,
        },
      };

      return videoInfo;
    }

    // Se não tem dados da API, usar IA completa
    console.log("⚠️ [Worker]: No YouTube data, using full AI analysis");

    const prompt = `Analise este link de vídeo: ${videoLink}
Plataforma: ${videoMetadata.platform}

RETORNE UM JSON:
{
  "title": "Título do vídeo",
  "description": "Descrição detalhada",
  "platform": "youtube|tiktok|instagram|facebook|other",
  "thumbnail": null,
  "duration": null,
  "category": "Categoria",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"],
  "language": "pt-BR",
  "author": "Nome do autor",
  "price": 0,
  "isEducational": false,
  "targetAudience": "Público-alvo",
  "mainTopic": "Tópico principal",
  "hasProductMentions": false,
  "contentType": "tutorial|review|entertainment|educational|promotional|other"
}

Sempre inclua exatamente 10 tags relevantes.`;

    const response = await openai.chat.completions.create({
      model: MODEL_SELECTED,
      messages: [
        {
          role: "system",
          content: "Você é especialista em análise de vídeos.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 4000,
    });

    const videoInfo: any = JSON.parse(
      response.choices[0].message.content || "{}"
    );

    videoInfo.productAnalysis = {
      hasProducts: linksWithTitles.length > 0,
      productLinks: linksWithTitles.map((link: any) => link.url),
      productsInfo: [...linksWithTitles],
      totalFound: linksWithTitles.length,
    };

    return videoInfo;
  } catch (error) {
    console.error("❌ [Worker]: Error analyzing video:", error);
    return {
      title: videoMetadata?.title || `Vídeo de ${new URL(videoLink).hostname}`,
      description:
        videoMetadata?.description || "Vídeo importado automaticamente",
      platform: videoMetadata?.platform || "outros",
      thumbnail: videoMetadata?.thumbnails?.high?.url || null,
      duration: null,
      category: "Geral",
      tags: [
        "video",
        "conteudo",
        "midia",
        "digital",
        "importado",
        "automatico",
        "social",
        "plataforma",
        "compartilhamento",
        "online",
      ],
      language: "pt-BR",
      author: videoMetadata?.channelTitle || "Desconhecido",
      price: 0,
      isEducational: false,
      targetAudience: "Geral",
      mainTopic: "Conteúdo de vídeo",
      hasProductMentions: false,
      contentType: "other",
      productAnalysis: {
        hasProducts: false,
        productLinks: [],
        productsInfo: [],
        totalFound: 0,
      },
    };
  }
}

async function processVideoWithLLM(data: VideoProcessingJobData): Promise<any> {
  console.log(`\n🎬 [Worker]: Processing video with LLM...`);
  console.log(`   Link: ${data.videoLink}`);
  console.log(`   User: ${data.userId}`);

  const videoMetadata = await getVideoMetadata(data.videoLink);
  const videoInfo = await analyzeVideoContentWithAI(
    videoMetadata,
    data.videoLink
  );

  console.log(`✅ [Worker]: Analysis completed!`);
  console.log(`   Title: ${videoInfo.title}`);
  console.log(`   Tags: ${videoInfo.tags?.length || 0}`);
  console.log(
    `   Products: ${videoInfo.productAnalysis?.productsInfo?.length || 0}`
  );

  return { videoInfo, videoLink: data.videoLink, userId: data.userId };
}

export const videoProcessingWorker = new Worker<VideoProcessingJobData>(
  "video-processing-queue",
  async (job: Job<VideoProcessingJobData>) => {
    console.log(
      `🔄 [Worker]: Processing job ${job.id} (Attempt ${job.attemptsMade + 1})`
    );

    const result = await processVideoWithLLM(job.data);
    return { success: true, timestamp: new Date().toISOString(), result };
  },
  { connection: redisConnection, concurrency: 2 }
);

videoProcessingWorker.on("completed", (job) => {
  console.log(`✨ [Worker]: Job ${job.id} completed!`);
});

videoProcessingWorker.on("failed", (job, err) => {
  console.error(`💥 [Worker]: Job ${job?.id} failed:`, err.message);
});

console.log(
  "🎬 Video Processing Worker started with LLM + YouTube API support!"
);
