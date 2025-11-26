interface GenericVideoData {
   platform: string;
   id: string;
   title: string;
   description: string;
   authorName: string;
   publishedAt: string;
   thumbnailUrl: string;
   videoUrl: string;
   duration: number;
   viewCount: number;
   likeCount: number;
   commentCount: number;
   shareCount: number;
   aspectRatio: string;
   width: number;
   height: number;
   tags: string[];
   metadata: Record<string, any>;
   originalData: any;
}

export class GenericVideoService {
   private rapidApiKey: string;
   private openGraphApiKey: string;

   constructor() {
      this.rapidApiKey = process.env.RAPIDAPI_KEY || "";
      this.openGraphApiKey = process.env.OPENGRAPH_API_KEY || "";
   }

   /**
    * Detecta a plataforma baseada na URL
    */
   private detectPlatform(url: string): string {
      const platforms = {
         "youtube.com": "youtube",
         "youtu.be": "youtube",
         "tiktok.com": "tiktok",
         "instagram.com": "instagram",
         "facebook.com": "facebook",
         "fb.watch": "facebook",
         "twitter.com": "twitter",
         "x.com": "twitter",
         "vimeo.com": "vimeo",
         "dailymotion.com": "dailymotion",
         "twitch.tv": "twitch",
         "streamable.com": "streamable",
         "reddit.com": "reddit",
         "linkedin.com": "linkedin",
         "pinterest.com": "pinterest",
         "snapchat.com": "snapchat",
         "discord.com": "discord",
         "telegram.org": "telegram",
         "whatsapp.com": "whatsapp",
      };

      const hostname = new URL(url).hostname.toLowerCase();

      for (const [domain, platform] of Object.entries(platforms)) {
         if (hostname.includes(domain)) {
            return platform;
         }
      }

      return "unknown";
   }

   /**
    * Extrai metadados usando Open Graph
    */
   private async extractOpenGraphData(url: string): Promise<any> {
      try {
         const response = await fetch(url, {
            headers: {
               "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
         });

         if (!response.ok) {
            throw new Error(`Failed to fetch page: ${response.status}`);
         }

         const html = await response.text();
         const ogData: Record<string, string> = {};

         // Extrai tags Open Graph
         const ogTags = html.match(/<meta\s+property=["']og:([^"']+)["']\s+content=["']([^"']+)["']/g);
         if (ogTags) {
            ogTags.forEach((tag) => {
               const match = tag.match(/property=["']og:([^"']+)["']\s+content=["']([^"']+)["']/);
               if (match) {
                  ogData[match[1]] = match[2];
               }
            });
         }

         // Extrai meta tags Twitter
         const twitterTags = html.match(/<meta\s+name=["']twitter:([^"']+)["']\s+content=["']([^"']+)["']/g);
         if (twitterTags) {
            twitterTags.forEach((tag) => {
               const match = tag.match(/name=["']twitter:([^"']+)["']\s+content=["']([^"']+)["']/);
               if (match) {
                  ogData[`twitter_${match[1]}`] = match[2];
               }
            });
         }

         // Extrai título se não encontrou via OG
         if (!ogData.title) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
               ogData.title = titleMatch[1];
            }
         }

         return ogData;
      } catch (error) {
         console.error("Error extracting Open Graph data:", error);
         return {};
      }
   }

   /**
    * Usa API externa para extrair dados de vídeo
    */
   private async extractVideoDataWithAPI(url: string): Promise<any> {
      if (!this.rapidApiKey) {
         return null;
      }

      try {
         // Usando RapidAPI Generic Video Extractor
         const response = await fetch("https://video-metadata-extractor.p.rapidapi.com/extract", {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
               "X-RapidAPI-Key": this.rapidApiKey,
               "X-RapidAPI-Host": "video-metadata-extractor.p.rapidapi.com",
            },
            body: JSON.stringify({ url }),
         });

         if (!response.ok) {
            return null;
         }

         return await response.json();
      } catch (error) {
         console.error("Error with video extraction API:", error);
         return null;
      }
   }

   /**
    * Extrai dados de vídeo do Twitter/X
    */
   private async extractTwitterData(url: string): Promise<any> {
      try {
         const response = await fetch(url, {
            headers: {
               "User-Agent": "Mozilla/5.0 (compatible; Twitterbot/1.0)",
            },
         });

         const html = await response.text();

         // Procura por JSON do Twitter
         const jsonMatch = html.match(/window\.YTD\.pageData\s*=\s*({.*?});/);
         if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1]);
            return data;
         }

         return null;
      } catch (error) {
         console.error("Error extracting Twitter data:", error);
         return null;
      }
   }

   /**
    * Extrai dados de vídeo do Vimeo
    */
   private async extractVimeoData(url: string): Promise<any> {
      try {
         const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
         if (!videoId) return null;

         const apiUrl = `https://vimeo.com/api/v2/video/${videoId}.json`;
         const response = await fetch(apiUrl);

         if (!response.ok) return null;

         const data: any = await response.json();
         return data[0];
      } catch (error) {
         console.error("Error extracting Vimeo data:", error);
         return null;
      }
   }

   /**
    * Extrai dados de vídeo do Dailymotion
    */
   private async extractDailymotionData(url: string): Promise<any> {
      try {
         const videoId = url.match(/dailymotion\.com\/video\/([^_?]+)/)?.[1];
         if (!videoId) return null;

         const apiUrl = `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}`;
         const response = await fetch(apiUrl);

         if (!response.ok) return null;

         return await response.json();
      } catch (error) {
         console.error("Error extracting Dailymotion data:", error);
         return null;
      }
   }

   /**
    * Método principal para extrair dados de qualquer plataforma
    */
   async fetchVideoData(url: string): Promise<GenericVideoData | null> {
      try {
         const platform = this.detectPlatform(url);
         let platformData: any = null;
         let ogData: any = {};

         // Tenta extrair dados específicos da plataforma
         switch (platform) {
            case "twitter":
               platformData = await this.extractTwitterData(url);
               break;
            case "vimeo":
               platformData = await this.extractVimeoData(url);
               break;
            case "dailymotion":
               platformData = await this.extractDailymotionData(url);
               break;
            default:
               // Tenta usar API externa
               platformData = await this.extractVideoDataWithAPI(url);
               break;
         }

         // Sempre tenta extrair Open Graph como fallback
         ogData = await this.extractOpenGraphData(url);

         // Combina dados de diferentes fontes
         const combinedData = { ...ogData, ...platformData };

         // Normaliza os dados para o formato padrão
         const videoData: GenericVideoData = {
            platform: platform,
            id: combinedData.id || combinedData.video_id || this.extractIdFromUrl(url) || "",
            title: combinedData.title || combinedData.name || ogData.title || "",
            description: combinedData.description || ogData.description || "",
            authorName: combinedData.author_name || combinedData.user_name || combinedData.channel || "",
            publishedAt: combinedData.upload_date || combinedData.created_time || new Date().toISOString(),
            thumbnailUrl: combinedData.thumbnail_url || ogData.image || "",
            videoUrl: combinedData.video_url || combinedData.url || url,
            duration: this.parseDuration(combinedData.duration) || 0,
            viewCount: parseInt(combinedData.view_count) || 0,
            likeCount: parseInt(combinedData.like_count) || 0,
            commentCount: parseInt(combinedData.comment_count) || 0,
            shareCount: parseInt(combinedData.share_count) || 0,
            aspectRatio: this.determineAspectRatio(combinedData, platform),
            width: parseInt(combinedData.width) || 1280,
            height: parseInt(combinedData.height) || 720,
            tags: this.extractTags(combinedData.description || combinedData.title || ""),
            metadata: {
               platform_specific: platformData,
               open_graph: ogData,
               detected_platform: platform,
            },
            originalData: combinedData,
         };

         return videoData;
      } catch (error) {
         console.error("Error fetching generic video data:", error);
         throw error;
      }
   }

   /**
    * Extrai ID básico da URL
    */
   private extractIdFromUrl(url: string): string {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      return pathParts[pathParts.length - 1] || urlObj.searchParams.get("v") || "";
   }

   /**
    * Converte duração para segundos
    */
   private parseDuration(duration: any): number {
      if (!duration) return 0;

      if (typeof duration === "number") return duration;

      const str = duration.toString();

      // Formato ISO 8601 (PT1M30S)
      if (str.startsWith("PT")) {
         const match = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
         if (match) {
            const hours = parseInt(match[1] || "0");
            const minutes = parseInt(match[2] || "0");
            const seconds = parseInt(match[3] || "0");
            return hours * 3600 + minutes * 60 + seconds;
         }
      }

      // Formato MM:SS ou HH:MM:SS
      if (str.includes(":")) {
         const parts = str.split(":").map(Number);
         if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
         } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
         }
      }

      // Apenas número (segundos)
      const numericDuration = parseInt(str);
      return isNaN(numericDuration) ? 0 : numericDuration;
   }

   /**
    * Determina aspect ratio baseado na plataforma e dados
    */
   private determineAspectRatio(data: any, platform: string): string {
      // Plataformas conhecidamente verticais
      if (["tiktok", "instagram"].includes(platform) && (data.type === "reel" || data.product_type === "clips")) {
         return "9:16";
      }

      // Se temos dimensões, calcula
      if (data.width && data.height) {
         const ratio = data.width / data.height;
         if (ratio > 1.5) return "16:9";
         if (ratio < 0.7) return "9:16";
         return "1:1";
      }

      // Padrão
      return "16:9";
   }

   /**
    * Extrai hashtags do texto
    */
   private extractTags(text: string): string[] {
      const hashtags = text.match(/#[\w\u4e00-\u9fff]+/g) || [];
      return hashtags.map((tag) => tag.substring(1));
   }

   /**
    * Busca múltiplos vídeos se a URL for de um canal/perfil
    */
   async fetchChannelVideos(url: string, limit: number = 10): Promise<GenericVideoData[]> {
      // Esta funcionalidade dependeria de APIs específicas de cada plataforma
      // Por enquanto, retorna apenas o vídeo individual
      const videoData = await this.fetchVideoData(url);
      return videoData ? [videoData] : [];
   }
}

// Como usar:
/*
const genericService = new GenericVideoService();

// Funciona com qualquer plataforma
const videoData1 = await genericService.fetchVideoData('https://vimeo.com/123456789');
const videoData2 = await genericService.fetchVideoData('https://twitter.com/user/status/123456789');
const videoData3 = await genericService.fetchVideoData('https://dailymotion.com/video/abc123');


*/
