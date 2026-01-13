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
  console.log(`🔎 [PLATFORM DETECTION]: Analyzing URL...`);
  console.log(`   URL: ${link}`);

  try {
    // Detecção rápida por URL antes de usar IA (mais rápido e confiável)
    if (link.includes("youtube.com") || link.includes("youtu.be")) {
      const platform = link.includes("/shorts/") ? "youtube-shorts" : "youtube";
      console.log(`   ✅ Detected by URL: ${platform}`);
      return platform;
    }
    if (link.includes("instagram.com")) {
      console.log(`   ✅ Detected by URL: instagram`);
      return "instagram";
    }
    if (link.includes("facebook.com") || link.includes("fb.watch")) {
      console.log(`   ✅ Detected by URL: facebook`);
      return "facebook";
    }
    if (link.includes("vimeo.com")) {
      console.log(`   ✅ Detected by URL: vimeo`);
      return "vimeo";
    }
    if (link.includes("tiktok.com")) {
      console.log(`   ✅ Detected by URL: tiktok`);
      return "tiktok";
    }

    // Fallback para IA se não detectar pela URL
    const prompt = `Detecte qual plataforma o link pertence e devolva apenas a palavra correspondente a plataforma sendo possiveis: tiktok, instagram, facebook, youtube-shorts, youtube, vimeo, outros. Link: ${link}`;

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

    console.log("\n" + "📺".repeat(40));
    console.log("🔍 [Worker]: YouTube metadata response COMPLETA:");
    console.log("📺".repeat(40));
    console.log(JSON.stringify(response.data, null, 2));
    console.log("📺".repeat(40) + "\n");

    if (response.data?.items && response.data.items.length > 0) {
      const video = response.data.items[0];
      const snippet = video.snippet;
      const statistics = video.statistics;
      const contentDetails = video.contentDetails;

      console.log("\n" + "📋".repeat(40));
      console.log("📋 [YouTube]: SNIPPET (detalhes do vídeo):");
      console.log("📋".repeat(40));
      console.log(JSON.stringify(snippet, null, 2));
      console.log("📋".repeat(40) + "\n");

      console.log("\n" + "📊".repeat(40));
      console.log("📊 [YouTube]: STATISTICS (estatísticas):");
      console.log("📊".repeat(40));
      console.log(JSON.stringify(statistics, null, 2));
      console.log("📊".repeat(40) + "\n");

      console.log("\n" + "⏱️".repeat(40));
      console.log("⏱️ [YouTube]: CONTENT DETAILS (detalhes do conteúdo):");
      console.log("⏱️".repeat(40));
      console.log(JSON.stringify(contentDetails, null, 2));
      console.log("⏱️".repeat(40) + "\n");

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
 * Extrai metadados de meta tags HTML (Open Graph, Twitter Cards, etc)
 */
function extractMetaTagsFromHTML(html: string): any {
  console.log("🔍 [HTML PARSER]: Extraindo meta tags do HTML...");

  const metadata: any = {
    title: null,
    description: null,
    image: null,
    author: null,
    video: null,
  };

  try {
    // Extrair og:title
    const ogTitleMatch = html.match(
      /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i
    );
    if (ogTitleMatch) {
      metadata.title = ogTitleMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#xc1;/g, "Á")
        .replace(/&#xe1;/g, "á")
        .replace(/&#xe9;/g, "é")
        .replace(/&#xed;/g, "í")
        .replace(/&#xf3;/g, "ó")
        .replace(/&#xfa;/g, "ú")
        .replace(/&#xb7;/g, "·");
      console.log(
        `   ✅ og:title found: ${metadata.title.substring(0, 80)}...`
      );
    }

    // Extrair og:description
    const ogDescMatch = html.match(
      /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i
    );
    if (ogDescMatch) {
      metadata.description = ogDescMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#xc1;/g, "Á")
        .replace(/&#xe1;/g, "á")
        .replace(/&#xe9;/g, "é")
        .replace(/&#xed;/g, "í")
        .replace(/&#xf3;/g, "ó")
        .replace(/&#xfa;/g, "ú")
        .replace(/\n/g, " ")
        .trim();
      console.log(
        `   ✅ og:description found: ${metadata.description.substring(
          0,
          80
        )}...`
      );
    }

    // Extrair og:image
    const ogImageMatch = html.match(
      /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i
    );
    if (ogImageMatch) {
      metadata.image = ogImageMatch[1];
      console.log(
        `   ✅ og:image found: ${metadata.image.substring(0, 80)}...`
      );
    }

    // Extrair og:video
    const ogVideoMatch = html.match(
      /<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i
    );
    if (ogVideoMatch) {
      metadata.video = ogVideoMatch[1];
      console.log(`   ✅ og:video found`);
    }

    // Fallback: meta name="description"
    if (!metadata.description) {
      const metaDescMatch = html.match(
        /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
      );
      if (metaDescMatch) {
        metadata.description = metaDescMatch[1]
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#xc1;/g, "Á")
          .replace(/&#xe1;/g, "á")
          .replace(/&#xe9;/g, "é")
          .replace(/&#xed;/g, "í")
          .replace(/&#xf3;/g, "ó")
          .replace(/&#xfa;/g, "ú")
          .trim();
        console.log(
          `   ✅ meta description found (fallback): ${metadata.description.substring(
            0,
            80
          )}...`
        );
      }
    }

    // Fallback: <title> tag
    if (!metadata.title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        metadata.title = titleMatch[1]
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .trim();
        console.log(
          `   ✅ <title> found (fallback): ${metadata.title.substring(
            0,
            80
          )}...`
        );
      }
    }

    // Extrair autor do título (formato: "... | Nome do Autor")
    if (metadata.title && metadata.title.includes("|")) {
      const parts = metadata.title.split("|");
      if (parts.length > 1) {
        metadata.author = parts[parts.length - 1].trim();
        console.log(`   ✅ Author extracted from title: ${metadata.author}`);
      }
    }

    console.log(`   📊 Meta tags extraction complete:`);
    console.log(`      - Title: ${metadata.title ? "YES" : "NO"}`);
    console.log(`      - Description: ${metadata.description ? "YES" : "NO"}`);
    console.log(`      - Image: ${metadata.image ? "YES" : "NO"}`);
    console.log(`      - Author: ${metadata.author ? "YES" : "NO"}`);
  } catch (error: any) {
    console.error(`   ❌ Error parsing HTML: ${error.message}`);
  }

  return metadata;
}

/**
 * Busca metadados do Instagram usando oEmbed API (pública, sem autenticação)
 */
async function fetchInstagramMetadata(url: string): Promise<any> {
  try {
    console.log("📸 [Worker]: Fetching Instagram metadata via oEmbed...");
    console.log(`   📍 URL: ${url}`);

    // Tentar com oEmbed público (sem token)
    const publicOembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(
      url
    )}`;
    console.log(`   🔗 oEmbed URL: ${publicOembedUrl}`);
    console.log("   ⏳ Calling Instagram API... (timeout: 10s)");

    const response = await axios.get(publicOembedUrl, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    console.log(
      `   ✅ Instagram API responded with status: ${response.status}`
    );

    console.log("   📦 RAW Response Data:");
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data) {
      const metadata = {
        title:
          response.data.title ||
          response.data.author_name ||
          "Post do Instagram",
        description:
          response.data.title || `Post de ${response.data.author_name}`,
        fullDescription:
          response.data.title ||
          `Vídeo/Post do Instagram criado por ${response.data.author_name}`,
        author: response.data.author_name || "Usuário Instagram",
        channelTitle: response.data.author_name || "Usuário Instagram",
        authorUrl: response.data.author_url || null,
        thumbnails: {
          default: { url: response.data.thumbnail_url },
          medium: { url: response.data.thumbnail_url },
          high: { url: response.data.thumbnail_url },
        },
        thumbnail_url: response.data.thumbnail_url,
        width: response.data.thumbnail_width,
        height: response.data.thumbnail_height,
        provider: "Instagram",
        provider_name: response.data.provider_name,
        provider_url: response.data.provider_url,
      };

      console.log("   ✅ Processed Metadata:");
      console.log(`      - Title: ${metadata.title}`);
      console.log(`      - Description: ${metadata.description}`);
      console.log(`      - Author: ${metadata.author}`);
      console.log(`      - Thumbnail: ${metadata.thumbnail_url || "NULL"}`);
      console.log(`      - Dimensions: ${metadata.width}x${metadata.height}`);

      return metadata;
    }

    console.warn("   ⚠️ No data in response");
    return null;
  } catch (error: any) {
    console.error("   ❌ Instagram oEmbed failed:");
    console.error(`      - Status: ${error.response?.status || "N/A"}`);
    console.error(`      - Message: ${error.message}`);
    console.error(
      `      - Response: ${JSON.stringify(error.response?.data || {})}`
    );
    return null;
  }
}

/**
 * Busca metadados do Facebook usando oEmbed API (pública)
 */
async function fetchFacebookMetadata(url: string): Promise<any> {
  try {
    console.log("📘 [Worker]: Fetching Facebook metadata via oEmbed...");
    console.log(`   📍 URL: ${url}`);

    // Facebook oEmbed público
    const oembedUrl = `https://www.facebook.com/plugins/video/oembed.json/?url=${encodeURIComponent(
      url
    )}`;
    console.log(`   🔗 oEmbed URL: ${oembedUrl}`);

    const response = await axios.get(oembedUrl, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    console.log("   📦 RAW Response Data:");
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data) {
      const metadata = {
        title: response.data.title || "Vídeo do Facebook",
        description: response.data.title || "Vídeo compartilhado no Facebook",
        fullDescription:
          response.data.title ||
          `Vídeo do Facebook criado por ${response.data.author_name}`,
        author: response.data.author_name || "Facebook User",
        channelTitle: response.data.author_name || "Facebook User",
        authorUrl: response.data.author_url || null,
        thumbnails: {
          default: { url: response.data.thumbnail_url },
          medium: { url: response.data.thumbnail_url },
          high: { url: response.data.thumbnail_url },
        },
        thumbnail_url: response.data.thumbnail_url,
        width: response.data.width,
        height: response.data.height,
        provider: "Facebook",
      };

      console.log("   ✅ Processed Metadata:");
      console.log(`      - Title: ${metadata.title}`);
      console.log(`      - Description: ${metadata.description}`);
      console.log(`      - Author: ${metadata.author}`);
      console.log(`      - Thumbnail: ${metadata.thumbnail_url || "NULL"}`);
      console.log(`      - Dimensions: ${metadata.width}x${metadata.height}`);

      return metadata;
    }

    console.warn("   ⚠️ No data in response");
    return null;
  } catch (error: any) {
    console.error("   ❌ Facebook oEmbed failed:");
    console.error(`      - Status: ${error.response?.status || "N/A"}`);
    console.error(`      - Message: ${error.message}`);
    console.error(
      `      - Response: ${JSON.stringify(error.response?.data || {})}`
    );
    return null;
  }
}

/**
 * Busca metadados do Vimeo usando oEmbed API (pública, sem autenticação)
 */
async function fetchVimeoMetadata(url: string): Promise<any> {
  try {
    console.log("🎥 [Worker]: Fetching Vimeo metadata via oEmbed...");

    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
      url
    )}`;

    const response = await axios.get(oembedUrl, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (response.data) {
      console.log(
        `✅ [Worker]: Vimeo metadata fetched: ${response.data.title}`
      );

      return {
        title: response.data.title || "Vídeo do Vimeo",
        description: response.data.description || response.data.title,
        author: response.data.author_name || "Vimeo User",
        authorUrl: response.data.author_url || null,
        channelTitle: response.data.author_name,
        thumbnails: {
          default: { url: response.data.thumbnail_url },
          medium: { url: response.data.thumbnail_url },
          high: { url: response.data.thumbnail_url },
        },
        thumbnail_url: response.data.thumbnail_url,
        width: response.data.width,
        height: response.data.height,
        duration: response.data.duration || null,
        provider: "Vimeo",
      };
    }

    return null;
  } catch (error: any) {
    console.warn("⚠️ [Worker]: Vimeo oEmbed failed:", error.message);
    return null;
  }
}

/**
 * Busca metadados do vídeo com base na plataforma
 */
async function getVideoMetadata(link: string): Promise<any> {
  console.log("\n" + "📡".repeat(40));
  console.log("🔍 [METADATA FETCH]: Iniciando busca de metadados...");
  console.log(`   🔗 Link recebido: ${link}`);
  console.log("📡".repeat(40) + "\n");

  const platform = await detectVideoPlatform(link);
  console.log(
    `✅ [PLATFORM DETECTION]: Plataforma detectada: ${platform.toUpperCase()}`
  );

  let videoMetadata: any = {
    platform,
    url: link,
    title: null,
    description: null,
    tags: [],
  };

  // Buscar metadados específicos da plataforma
  // YOUTUBE - Mantém exatamente como estava (NÃO MEXER)
  if (platform === "youtube" || platform === "youtube-shorts") {
    console.log(
      "\n🎯 [YOUTUBE MODE]: Buscando metadados via YouTube Data API v3..."
    );
    const youtubeData = await fetchYouTubeMetadata(link);
    if (youtubeData) {
      console.log("✅ [YOUTUBE]: Metadados obtidos com sucesso!");
      videoMetadata = {
        ...videoMetadata,
        ...youtubeData,
      };
    } else {
      console.warn("⚠️ [YOUTUBE]: Falha ao obter metadados");
    }
  }
  // INSTAGRAM - Nova funcionalidade
  else if (platform === "instagram") {
    console.log("\n🎯 [INSTAGRAM MODE]: Buscando metadados via oEmbed API...");
    console.log("   🔍 Calling fetchInstagramMetadata...");
    try {
      const instagramData = await fetchInstagramMetadata(link);
      console.log("   📦 fetchInstagramMetadata returned:");
      console.log(`      - Has data: ${instagramData ? "YES" : "NO"}`);
      if (instagramData) {
        console.log("✅ [INSTAGRAM]: Metadados obtidos com sucesso!");
        videoMetadata = {
          ...videoMetadata,
          ...instagramData,
        };
      } else {
        console.warn("⚠️ [INSTAGRAM]: fetchInstagramMetadata retornou NULL");
      }
    } catch (error: any) {
      console.error("❌ [INSTAGRAM]: Exceção em fetchInstagramMetadata:");
      console.error(`   Error: ${error.message}`);
      console.warn("⚠️ [INSTAGRAM]: Continuando sem metadados da API...");
    }
  }
  // FACEBOOK - Nova funcionalidade
  else if (platform === "facebook") {
    console.log("\n🎯 [FACEBOOK MODE]: Buscando metadados via oEmbed API...");
    const facebookData = await fetchFacebookMetadata(link);
    if (facebookData) {
      console.log("✅ [FACEBOOK]: Metadados obtidos com sucesso!");
      videoMetadata = {
        ...videoMetadata,
        ...facebookData,
      };
    } else {
      console.warn("⚠️ [FACEBOOK]: Falha ao obter metadados");
    }
  }
  // VIMEO - Nova funcionalidade
  else if (platform === "vimeo" || link.includes("vimeo.com")) {
    console.log("\n🎯 [VIMEO MODE]: Buscando metadados via oEmbed API...");
    const vimeoData = await fetchVimeoMetadata(link);
    if (vimeoData) {
      console.log("✅ [VIMEO]: Metadados obtidos com sucesso!");
      videoMetadata = {
        ...videoMetadata,
        ...vimeoData,
      };
    } else {
      console.warn("⚠️ [VIMEO]: Falha ao obter metadados");
    }
  } else {
    console.warn(
      `⚠️ [UNKNOWN PLATFORM]: Plataforma '${platform}' não tem integração específica`
    );
  }

  // Tentar buscar metadados via API do Extractor (Python service)
  const extractorApiUrl =
    process.env.EXTRACTOR_API_URL ||
    process.env.EXTRACTOR ||
    "http://127.0.0.1:4000";
  console.log("\n" + "🐍".repeat(40));
  console.log(
    "🐍 [EXTRACTOR API]: Chamando serviço Python para extração SEO..."
  );
  console.log(`   🔗 API URL: ${extractorApiUrl}`);
  console.log(`   📍 Target URL: ${link}`);
  console.log(`   📤 Endpoint: POST ${extractorApiUrl}/extract-seo`);
  console.log(`   ⏳ Timeout: 20 segundos`);
  console.log(
    `   🌍 ENV EXTRACTOR_API_URL: ${process.env.EXTRACTOR_API_URL || "NOT SET"}`
  );
  console.log(`   🌍 ENV EXTRACTOR: ${process.env.EXTRACTOR || "NOT SET"}`);
  console.log("🐍".repeat(40));

  try {
    console.log("\n   📡 Enviando request para Extractor API...");
    console.log(`   📦 Payload: ${JSON.stringify({ url: link })}`);

    const extractorResponse = await axios.post(
      `${extractorApiUrl}/extract-seo`,
      { url: link },
      {
        timeout: 20000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      `\n   ✅ HTTP ${extractorResponse.status} - Extractor API respondeu!`
    );
    console.log("   📥 RESPONSE COMPLETA:");
    console.log(JSON.stringify(extractorResponse.data, null, 2));

    if (extractorResponse.data && extractorResponse.data.status === "success") {
      console.log("\n   ✅ Status: SUCCESS");
      console.log(`   🔍 Fonte dos dados: ${extractorResponse.data.source}`);

      const seoData = extractorResponse.data;

      console.log("\n   📊 Dados extraídos pela API Python:");
      console.log(
        `      📄 Title: ${
          seoData.title
            ? "PRESENTE (" + seoData.title.length + " chars)"
            : "NULL"
        }`
      );
      console.log(
        `      📝 Description: ${
          seoData.description
            ? "PRESENTE (" + seoData.description.length + " chars)"
            : "NULL"
        }`
      );
      console.log(`      🖼️  Image: ${seoData.image ? "PRESENTE" : "NULL"}`);

      // Mesclar dados: priorizar dados da API oEmbed, usar SEO como fallback
      console.log("\n   🔄 Mesclando dados com metadados existentes...");

      if (seoData.title && !videoMetadata.title) {
        videoMetadata.title = seoData.title;
        console.log(
          `      ✅ Título aplicado: ${seoData.title.substring(0, 80)}${
            seoData.title.length > 80 ? "..." : ""
          }`
        );
      } else if (videoMetadata.title) {
        console.log(`      ⏭️  Título já existe, mantendo o atual`);
      } else {
        console.log(`      ⚠️  Nenhum título disponível`);
      }

      if (seoData.description && !videoMetadata.description) {
        videoMetadata.description = seoData.description;
        videoMetadata.fullDescription = seoData.description;
        console.log(
          `      ✅ Descrição aplicada: ${seoData.description.substring(
            0,
            80
          )}${seoData.description.length > 80 ? "..." : ""}`
        );
      } else if (videoMetadata.description) {
        console.log(`      ⏭️  Descrição já existe, mantendo a atual`);
      } else {
        console.log(`      ⚠️  Nenhuma descrição disponível`);
      }

      // IMPORTANTE: Verificar se já temos thumbnail da API (YouTube retorna thumbnails, não thumbnail_url)
      const hasExistingThumbnail =
        videoMetadata.thumbnail_url ||
        videoMetadata.thumbnails?.high?.url ||
        videoMetadata.thumbnails?.default?.url;

      if (seoData.image && !hasExistingThumbnail) {
        // Verificar se a imagem NÃO é um logo genérico do YouTube
        const isGenericLogo =
          seoData.image.includes("yt_logo") ||
          seoData.image.includes("supported_browsers") ||
          seoData.image.includes("/img/desktop/");

        if (!isGenericLogo) {
          videoMetadata.thumbnail_url = seoData.image;
          videoMetadata.thumbnails = {
            default: { url: seoData.image },
            medium: { url: seoData.image },
            high: { url: seoData.image },
          };
          console.log(
            `      ✅ Thumbnail aplicada: ${seoData.image.substring(0, 60)}${
              seoData.image.length > 60 ? "..." : ""
            }`
          );
        } else {
          console.log(`      ⚠️  Imagem ignorada (logo genérico do YouTube)`);
        }
      } else if (hasExistingThumbnail) {
        console.log(
          `      ⏭️  Thumbnail já existe da API, mantendo: ${
            videoMetadata.thumbnails?.high?.url || videoMetadata.thumbnail_url
          }`
        );
      } else {
        console.log(`      ⚠️  Nenhuma thumbnail disponível`);
      }

      // Extrair autor do título se disponível (formato: "... | Nome do Autor")
      console.log("\n   👤 Tentando extrair autor do título...");
      if (
        seoData.title &&
        seoData.title.includes("|") &&
        !videoMetadata.author
      ) {
        const parts = seoData.title.split("|");
        if (parts.length > 1) {
          videoMetadata.author = parts[parts.length - 1].trim();
          videoMetadata.channelTitle = videoMetadata.author;
          console.log(
            `      ✅ Autor extraído do título: ${videoMetadata.author}`
          );
        } else {
          console.log(
            `      ℹ️ Título tem | mas não foi possível extrair autor`
          );
        }
      } else if (videoMetadata.author) {
        console.log(`      ⏭️  Autor já existe: ${videoMetadata.author}`);
      } else {
        console.log(`      ℹ️ Título não contém | para extrair autor`);
      }

      // Guardar conteúdo para extração de links de produtos
      videoMetadata.pageContent = seoData.title + " " + seoData.description;
      console.log(
        `\n   💾 PageContent atualizado (${videoMetadata.pageContent.length} bytes)`
      );
    } else {
      console.error("   ❌ Status diferente de 'success':");
      console.error(
        `      Status: ${extractorResponse.data?.status || "UNDEFINED"}`
      );
      console.error(`      Error: ${extractorResponse.data?.error || "N/A"}`);
    }
  } catch (error: any) {
    console.error("\n   💥 [EXTRACTOR API]: FALHOU!");
    console.error(`      Error Name: ${error.name}`);
    console.error(`      Error Message: ${error.message}`);
    console.error(`      Error Code: ${error.code || "N/A"}`);

    if (error.response) {
      console.error(`      HTTP Status: ${error.response.status}`);
      console.error(
        `      Response Data: ${JSON.stringify(error.response.data)}`
      );
    } else if (error.request) {
      console.error(`      Sem resposta do servidor`);
      console.error(`      Request foi feito mas não houve resposta`);
    }

    console.log("\n   ℹ️ Continuando sem extração SEO adicional...");

    // Fallback: tentar scraping direto apenas se Extractor falhar
    console.log("\n🌐 [FALLBACK]: Tentando scraping direto...");
    try {
      const response = await axios.get(link, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      videoMetadata.pageContent = response.data;
      console.log(`   ✅ Conteúdo obtido (${response.data.length} bytes)`);

      // Usar função local de extração
      if (typeof response.data === "string") {
        const htmlMetadata = extractMetaTagsFromHTML(response.data);
        if (htmlMetadata.title && !videoMetadata.title) {
          videoMetadata.title = htmlMetadata.title;
          console.log("   ✅ Título obtido do HTML");
        }
        if (htmlMetadata.description && !videoMetadata.description) {
          videoMetadata.description = htmlMetadata.description;
          videoMetadata.fullDescription = htmlMetadata.description;
          console.log("   ✅ Descrição obtida do HTML");
        }
        // Verificar se já temos thumbnail da API antes de usar HTML
        const hasExistingThumb =
          videoMetadata.thumbnail_url || videoMetadata.thumbnails?.high?.url;
        if (htmlMetadata.image && !hasExistingThumb) {
          // Verificar se NÃO é logo genérico
          const isGenericLogo =
            htmlMetadata.image.includes("yt_logo") ||
            htmlMetadata.image.includes("supported_browsers") ||
            htmlMetadata.image.includes("/img/desktop/");
          if (!isGenericLogo) {
            videoMetadata.thumbnail_url = htmlMetadata.image;
            videoMetadata.thumbnails = {
              default: { url: htmlMetadata.image },
              medium: { url: htmlMetadata.image },
              high: { url: htmlMetadata.image },
            };
            console.log("   ✅ Thumbnail obtida do HTML");
          } else {
            console.log("   ⚠️ Thumbnail do HTML ignorada (logo genérico)");
          }
        }
      }
    } catch (fallbackError: any) {
      console.warn(
        `   ⚠️ [FALLBACK]: Também falhou - ${fallbackError.message}`
      );
    }
  }

  // RESUMO FINAL DOS METADADOS OBTIDOS
  console.log("\n" + "📊".repeat(40));
  console.log("📊 [METADATA SUMMARY]: Resumo dos metadados obtidos:");
  console.log(`   🎯 Plataforma: ${videoMetadata.platform}`);
  console.log(`   📝 Título: ${videoMetadata.title || "NULO"}`);
  console.log(
    `   📄 Descrição: ${
      videoMetadata.description
        ? "PRESENTE (" + videoMetadata.description.length + " chars)"
        : "NULO"
    }`
  );
  console.log(
    `   👤 Autor: ${
      videoMetadata.author || videoMetadata.channelTitle || "NULO"
    }`
  );
  console.log(
    `   🖼️  Thumbnail: ${
      videoMetadata.thumbnail_url || videoMetadata.thumbnails?.high?.url
        ? "PRESENTE"
        : "NULO"
    }`
  );
  console.log(
    `   🔗 URL Thumbnail: ${
      videoMetadata.thumbnail_url ||
      videoMetadata.thumbnails?.high?.url ||
      "N/A"
    }`
  );
  console.log(`   ⏱️  Duração: ${videoMetadata.duration || "NULO"}`);
  console.log("📊".repeat(40) + "\n");

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

    // Excluir domínios que contenham "encrypted" ou "encripted"
    if (hostname.includes("encrypted") || hostname.includes("encripted")) {
      return false;
    }

    // Excluir domínios de imagens/thumbnails do YouTube e outros serviços de imagem
    const imageOnlyDomains = [
      "yt3.ggpht.com",
      "yt3.googleusercontent.com",
      "i.ytimg.com",
      "img.youtube.com",
      "ytimg.googleusercontent.com",
    ];

    // Excluir links de grupos de WhatsApp e Telegram
    const socialGroupDomains = [
      "whatsapp.com",
      "wa.me",
      "chat.whatsapp.com",
      "api.whatsapp.com",
      "t.me",
      "telegram.me",
      "telegram.org",
    ];

    if (imageOnlyDomains.some((domain) => hostname.includes(domain))) {
      return false;
    }

    if (socialGroupDomains.some((domain) => hostname.includes(domain))) {
      return false;
    }

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

    // Incluir a descrição completa se disponível
    const fullDescription = videoMetadata?.description || "";

    const prompt = `Analise a DESCRIÇÃO DO VÍDEO e correlacione cada link encontrado com o nome/título do produto que aparece ACIMA ou PRÓXIMO de cada link na descrição.

DESCRIÇÃO COMPLETA DO VÍDEO:
${fullDescription.substring(0, 3000)}

LINKS PARA CORRELACIONAR:
${JSON.stringify(linksInfo, null, 2)}

INSTRUÇÕES IMPORTANTES:
1. Na descrição, cada produto geralmente tem um NÚMERO, NOME DO PRODUTO e depois o LINK
2. Exemplo: "1. Eufy Self Emptying Robot Vacuum" seguido de "https://bit.ly/42NecTd"
3. Correlacione cada link com o nome que aparece IMEDIATAMENTE ANTES dele na descrição
4. Use EXATAMENTE o nome que está na descrição, não invente ou altere
5. Se não encontrar nome específico, use um nome descritivo baseado no contexto
6. NÃO use títulos genéricos como "Product Title X"

RETORNE UM JSON com esta estrutura:
{
  "links": [
    {
      "id": 1,
      "url": "https://bit.ly/...",
      "title": "Nome EXATO extraído da descrição",
      "type": "product",
      "description": "Breve descrição do produto"
    }
  ]
}

REGRAS:
- Use os nomes EXATOS da descrição
- Se o nome tiver número (ex: "1. Nome"), remova o número
- Seja preciso na correlação link <-> nome`;

    const response = await openai.chat.completions.create({
      model: MODEL_SELECTED,
      messages: [
        {
          role: "system",
          content:
            "Você é um especialista em extrair informações estruturadas de descrições de vídeos. Sua especialidade é correlacionar links com os nomes de produtos que aparecem na descrição.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 5000,
    });

    const content = response.choices[0].message.content || "{}";
    const result = JSON.parse(content);

    return links.map((link, index) => {
      const aiResult = result.links?.find((l: any) => l.id === index + 1);
      return {
        ...link,
        productName: aiResult?.title || extractProductNameFromUrl(link.url),
        type: aiResult?.type || "product",
        description: aiResult?.description || "",
      };
    });
  } catch (error) {
    console.error("❌ [Worker]: Error extracting titles:", error);
    return links.map((link) => ({
      ...link,
      productName: extractProductNameFromUrl(link.url),
      type: "product",
      description: "",
    }));
  }
}

async function analyzeVideoContentWithAI(
  videoMetadata: any,
  videoLink: string
): Promise<any> {
  try {
    console.log("\n🤖 [AI Analysis]: Starting analysis...");
    console.log("   📦 Video Metadata Received:");
    console.log(`      - Platform: ${videoMetadata?.platform || "N/A"}`);
    console.log(`      - Title: ${videoMetadata?.title || "N/A"}`);
    console.log(
      `      - Description: ${
        videoMetadata?.description
          ? videoMetadata.description.substring(0, 100) + "..."
          : "NULL"
      }`
    );
    console.log(
      `      - Author: ${
        videoMetadata?.author || videoMetadata?.channelTitle || "N/A"
      }`
    );
    console.log(
      `      - Thumbnail: ${
        videoMetadata?.thumbnail_url ||
        videoMetadata?.thumbnails?.high?.url ||
        "NULL"
      }`
    );

    const allExtractedLinks = extractAllProductLinksDirectly(
      videoLink,
      videoMetadata
    );
    const linksWithTitles = await extractTitlesFromLinksWithAI(
      allExtractedLinks,
      videoMetadata
    );

    // Se já temos metadados completos da API do YouTube, usar eles e complementar com IA
    // Instagram/Facebook/Vimeo NÃO tem description completa, então usar IA completa
    const hasYouTubeData =
      videoMetadata?.platform === "youtube" ||
      videoMetadata?.platform === "youtube-shorts";
    const hasFullDescription =
      videoMetadata?.description && videoMetadata.description.length > 50;

    console.log(`   🔍 Analysis Mode Decision:`);
    console.log(`      - hasYouTubeData: ${hasYouTubeData}`);
    console.log(`      - hasFullDescription: ${hasFullDescription}`);
    console.log(
      `      - Mode: ${
        hasYouTubeData && hasFullDescription
          ? "YouTube Optimized"
          : "Full AI Analysis"
      }`
    );

    if (hasYouTubeData && hasFullDescription) {
      console.log("   ✅ Using YouTube API metadata + AI for tags and summary");

      // Usar IA para gerar tags e resumo conciso
      const summaryPrompt = `Analise este vídeo do YouTube e gere:
1. Um resumo CONCISO e ATRATIVO da descrição (máximo 200 caracteres)
2. Exatamente 10 tags relevantes em português

Título: ${videoMetadata.title}
Descrição: ${videoMetadata.description?.substring(0, 1500)}
Canal: ${videoMetadata.channelTitle || "Desconhecido"}

Retorne JSON:
{
  "summary": "Resumo conciso e atrativo do vídeo em até 200 caracteres",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"]
}

Regras para o resumo:
- Máximo 200 caracteres
- Conciso e direto
- Capture a essência do vídeo
- Use linguagem atrativa
- Foque no conteúdo principal

Regras para tags:
- Exatamente 10 tags
- Tags em português brasileiro
- Tags relevantes ao conteúdo`;

      const summaryResponse = await openai.chat.completions.create({
        model: MODEL_SELECTED,
        messages: [
          {
            role: "system",
            content: "Você é especialista em categorização e resumo de vídeos.",
          },
          { role: "user", content: summaryPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 800,
      });

      const aiResult = JSON.parse(
        summaryResponse.choices[0].message.content || "{}"
      );

      const videoInfo: any = {
        title: videoMetadata.title,
        description: aiResult.summary || videoMetadata.title,
        fullDescription: videoMetadata.description,
        platform: videoMetadata.platform,
        thumbnail:
          videoMetadata.thumbnails?.high?.url ||
          videoMetadata.thumbnails?.default?.url ||
          null,
        duration: videoMetadata.duration || null,
        category: "Vídeo",
        tags: aiResult.tags || [
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
    console.log("   ⚠️ Using full AI analysis (Instagram/Facebook/Vimeo mode)");
    console.log(`      - Available Title: ${videoMetadata?.title || "NULL"}`);
    console.log(`      - Available Author: ${videoMetadata?.author || "NULL"}`);
    console.log(
      `      - Available Thumbnail: ${videoMetadata?.thumbnail_url || "NULL"}`
    );

    const prompt = `Analise este vídeo de ${videoMetadata.platform}:

INFORMAÇÕES DISPONÍVEIS:
- Título: ${videoMetadata?.title || "Não disponível"}
- Autor: ${
      videoMetadata?.author || videoMetadata?.channelTitle || "Não disponível"
    }
- Plataforma: ${videoMetadata.platform}
- Link: ${videoLink}

IMPORTANTE: Este é um vídeo do ${videoMetadata.platform}. 
Gere tags e descrição RELEVANTES e ESPECÍFICAS baseadas nas informações disponíveis.

RETORNE UM JSON:
{
  "title": "Use o título disponível ou melhore levemente",
  "description": "Descrição concisa e atrativa em 150-200 caracteres",
  "category": "Categoria apropriada para o conteúdo",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"],
  "language": "pt-BR",
  "isEducational": false,
  "targetAudience": "Público-alvo apropriado",
  "mainTopic": "Tópico principal do vídeo",
  "contentType": "entertainment|educational|promotional|review|tutorial|other"
}

REGRAS PARA TAGS:
- Exatamente 10 tags em português
- Tags específicas e relevantes
- Baseadas no título e contexto disponível
- NÃO use tags genéricas demais`;

    console.log("   🚀 Calling OpenAI for analysis...");
    const response = await openai.chat.completions.create({
      model: MODEL_SELECTED,
      messages: [
        {
          role: "system",
          content:
            "Você é especialista em análise e categorização de vídeos de redes sociais.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4000,
    });

    const aiResult: any = JSON.parse(
      response.choices[0].message.content || "{}"
    );

    console.log("   ✅ AI Analysis Complete:");
    console.log(
      `      - Generated Description: ${aiResult.description?.substring(
        0,
        80
      )}...`
    );
    console.log(`      - Generated Tags: ${aiResult.tags?.length || 0}`);
    console.log(`      - Tags: ${JSON.stringify(aiResult.tags || [])}`);

    // Montar resposta final usando dados do oEmbed + IA
    const videoInfo: any = {
      title:
        videoMetadata?.title ||
        aiResult.title ||
        `Vídeo do ${videoMetadata.platform}`,
      description:
        aiResult.description ||
        videoMetadata?.description ||
        `Vídeo compartilhado no ${videoMetadata.platform}`,
      fullDescription:
        videoMetadata?.fullDescription ||
        aiResult.description ||
        `Vídeo criado por ${videoMetadata?.author}`,
      platform: videoMetadata?.platform || "outros",
      thumbnail:
        videoMetadata?.thumbnail_url ||
        videoMetadata?.thumbnails?.high?.url ||
        null,
      duration: videoMetadata?.duration || null,
      category: aiResult.category || "Vídeo",
      tags: aiResult.tags || [
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
      author:
        videoMetadata?.author || videoMetadata?.channelTitle || "Desconhecido",
      price: 0,
      isEducational: aiResult.isEducational || false,
      targetAudience: aiResult.targetAudience || "Geral",
      mainTopic:
        aiResult.mainTopic || videoMetadata?.title || "Conteúdo de vídeo",
      hasProductMentions: linksWithTitles.length > 0,
      contentType: aiResult.contentType || "other",
      productAnalysis: {
        hasProducts: linksWithTitles.length > 0,
        productLinks: linksWithTitles.map((link: any) => link.url),
        productsInfo: [...linksWithTitles],
        totalFound: linksWithTitles.length,
      },
    };

    console.log("   📦 Final Video Info:");
    console.log(`      - Title: ${videoInfo.title}`);
    console.log(`      - Description: ${videoInfo.description}`);
    console.log(`      - Thumbnail: ${videoInfo.thumbnail || "NULL"}`);
    console.log(`      - Tags: ${videoInfo.tags.length}`);
    console.log(`      - Author: ${videoInfo.author}`);

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
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🎬 [Worker]: Processing video with LLM...`);
  console.log(`   Link: ${data.videoLink}`);
  console.log(`   User: ${data.userId}`);
  console.log(`${"=".repeat(80)}\n`);

  let videoMetadata;
  let videoInfo;

  try {
    console.log("🔄 [STEP 1/2]: Fetching video metadata...");
    videoMetadata = await getVideoMetadata(data.videoLink);
    console.log("✅ [STEP 1/2]: Metadata fetch completed!\n");
  } catch (error: any) {
    console.error("❌ [STEP 1/2]: FAILED to fetch metadata");
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    throw new Error(`Failed to fetch metadata: ${error.message}`);
  }

  try {
    console.log("🔄 [STEP 2/2]: Analyzing content with AI...");
    videoInfo = await analyzeVideoContentWithAI(videoMetadata, data.videoLink);
    console.log("✅ [STEP 2/2]: AI analysis completed!\n");
  } catch (error: any) {
    console.error("❌ [STEP 2/2]: FAILED in AI analysis");
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    throw new Error(`Failed in AI analysis: ${error.message}`);
  }

  console.log(`${"=".repeat(80)}`);
  console.log(`✨ [Worker]: ANALYSIS COMPLETED SUCCESSFULLY!`);
  console.log(`${"=".repeat(80)}`);
  console.log(`   📊 FINAL RESULTS:`);
  console.log(`      - Platform: ${videoInfo.platform}`);
  console.log(`      - Title: ${videoInfo.title}`);
  console.log(
    `      - Description: ${videoInfo.description?.substring(0, 100)}${
      videoInfo.description?.length > 100 ? "..." : ""
    }`
  );
  console.log(`      - Author: ${videoInfo.author}`);
  console.log(
    `      - Thumbnail: ${videoInfo.thumbnail ? "✅ Present" : "❌ Missing"}`
  );
  console.log(`      - Tags: ${videoInfo.tags?.length || 0} tags`);
  console.log(`      - Tags List: ${JSON.stringify(videoInfo.tags || [])}`);
  console.log(
    `      - Products Found: ${
      videoInfo.productAnalysis?.productsInfo?.length || 0
    }`
  );
  console.log(`${"=".repeat(80)}\n`);

  return { videoInfo, videoLink: data.videoLink, userId: data.userId };
}

export const videoProcessingWorker = new Worker<VideoProcessingJobData>(
  "video-processing-queue",
  async (job: Job<VideoProcessingJobData>) => {
    const startTime = Date.now();
    let timeoutId: NodeJS.Timeout | undefined;

    // Promise de timeout
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(`Job ${job.id} timeout after 120 seconds (2 minutes)`)
        );
      }, 120000); // 2 minutos
    });

    try {
      console.log("\n" + "🔥".repeat(40));
      console.log(
        `🔄 [Worker]: JOB PICKED UP! Job ID: ${job.id} (Attempt ${
          job.attemptsMade + 1
        }/${job.opts.attempts || 3})`
      );
      console.log(`   📝 Job Data:`, JSON.stringify(job.data, null, 2));
      console.log(`   ⏰ Started at: ${new Date().toISOString()}`);
      console.log(`   ⏱️  Timeout: 120 seconds (2 minutes)`);
      console.log("🔥".repeat(40) + "\n");

      // Race entre processamento e timeout
      const result = (await Promise.race([
        processVideoWithLLM(job.data),
        timeoutPromise,
      ])) as any;

      if (timeoutId) clearTimeout(timeoutId);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log("\n" + "✨".repeat(40));
      console.log(`✅ [Worker]: JOB COMPLETED SUCCESSFULLY! Job ID: ${job.id}`);
      console.log(`   ⏱️  Duration: ${duration}s`);
      console.log("✨".repeat(40) + "\n");

      return {
        success: true,
        timestamp: new Date().toISOString(),
        result,
        duration: `${duration}s`,
      };
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.error("\n" + "💥".repeat(40));
      console.error(`❌ [Worker]: JOB FAILED! Job ID: ${job.id}`);
      console.error(`   ⏱️  Duration: ${duration}s`);
      console.error(`   Error Name: ${error.name}`);
      console.error(`   Error Message: ${error.message}`);
      console.error(`   Error Stack:`);
      console.error(error.stack);
      console.error("💥".repeat(40) + "\n");
      throw error; // Re-throw para o BullMQ fazer retry
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // REDUZIR PARA 1 para debugar Instagram
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  }
);

videoProcessingWorker.on("completed", (job) => {
  console.log(`\n🎉 [Event]: Job ${job.id} completed event fired!`);
});

videoProcessingWorker.on("failed", (job, err) => {
  console.error(`\n💀 [Event]: Job ${job?.id} failed event fired!`);
  console.error(`   Error: ${err.message}`);
  console.error(`   Stack: ${err.stack}`);
});

videoProcessingWorker.on("error", (err) => {
  console.error(`\n🚨 [Event]: Worker error!`);
  console.error(`   Error: ${err.message}`);
  console.error(`   Stack: ${err.stack}`);
});

videoProcessingWorker.on("active", (job) => {
  console.log(`\n⚡ [Event]: Job ${job.id} is now ACTIVE and being processed!`);
  console.log(`   📝 Job Type: ${job.name}`);
  console.log(`   🔗 Video Link: ${job.data.videoLink}`);
});

videoProcessingWorker.on("stalled", (jobId) => {
  console.error(
    `\n⚠️ [Event]: Job ${jobId} STALLED! Worker may have crashed while processing.`
  );
});

// Verificar conexão do Redis
console.log("\n" + "🔌".repeat(40));
console.log("🔌 [WORKER INITIALIZATION]: Verificando conexão...");
console.log(`   Redis Host: ${redisConnection.options.host || "default"}`);
console.log(`   Redis Port: ${redisConnection.options.port || 6379}`);
console.log(`   Concurrency: 1 (only 1 job at time for debugging)`);
console.log("🔌".repeat(40));

console.log(
  "\n🎬 Video Processing Worker started with support for: YouTube, Instagram, Facebook, Vimeo!"
);
console.log("✅ Worker is ready and listening for jobs...\n");
