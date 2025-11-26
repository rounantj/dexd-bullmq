interface TikTokVideoData {
   id: string;
   title: string;
   description: string;
   authorName: string;
   authorUsername: string;
   publishedAt: string;
   thumbnailUrl: string;
   videoUrl: string;
   duration: number;
   viewCount: number;
   likeCount: number;
   commentCount: number;
   shareCount: number;
   tags: string[];
   musicTitle?: string;
   musicAuthor?: string;
   aspectRatio: string;
   width: number;
   height: number;
}

export class TikTokService {
   //  private apiKey: string;
   private baseUrl = "https://api.tiktokv.com/aweme/v1";
   private rapidApiKey: string;
   private rapidApiHost = "tiktok-scraper7.p.rapidapi.com";

   constructor() {
      // TikTok não tem API pública oficial, então usamos RapidAPI
      this.rapidApiKey = process.env.RAPIDAPI_KEY || "";
      if (!this.rapidApiKey) {
         console.warn("⚠️ [TikTok Extractor]: RAPIDAPI_KEY environment variable is required for TikTok");
      }
   }

   /**
    * Extrai o ID do vídeo de uma URL do TikTok
    */
   private extractVideoId(input: string): string | null {
      // Se já é um ID numérico
      if (/^\d+$/.test(input)) {
         return input;
      }

      // Regex para extrair ID de URLs do TikTok
      const patterns = [
         /tiktok\.com\/@[\w.-]+\/video\/(\d+)/,
         /tiktok\.com\/v\/(\d+)/,
         /vm\.tiktok\.com\/(\w+)/,
         /tiktok\.com\/t\/(\w+)/,
      ];

      for (const pattern of patterns) {
         const match = input.match(pattern);
         if (match && match[1]) {
            return match[1];
         }
      }

      return null;
   }

   /**
    * Extrai dados do TikTok usando RapidAPI
    * @param url URL completa do TikTok
    * @returns Dados do vídeo em formato JSON
    */
   async fetchVideoData(url: string): Promise<TikTokVideoData | null> {
      try {
         // Extrai o ID do vídeo da URL do TikTok
         const videoId = this.extractVideoId2(url);
         if (!videoId) {
            throw new Error("Não foi possível extrair o ID do vídeo da URL");
         }

         // Usando RapidAPI TikTok Scraper corretamente
         const apiUrl = `https://${this.rapidApiHost}/feed/search?keywords=${videoId}&region=us&count=10&cursor=0&publish_time=0&sort_type=0`;

         const response = await fetch(apiUrl, {
            method: "GET",
            headers: {
               "x-rapidapi-host": this.rapidApiHost,
               "x-rapidapi-key": this.rapidApiKey,
            },
         });

         if (!response.ok) {
            throw new Error(`TikTok API error: ${response.status} ${response.statusText}`);
         }

         const data: any = await response.json();

         if (!data || !data.data || !data.data.videos || data.data.videos.length === 0) {
            return null;
         }

         // Pega o primeiro vídeo dos resultados
         const video = data.data.videos.pop();

         // Extrai hashtags da descrição
         const hashtags = video.desc?.match(/#[\w\u4e00-\u9fff]+/g) || [];

         const videoData: TikTokVideoData = {
            id: video.aweme_id || video.id,
            title: video.desc || "",
            description: video.desc || "",
            authorName: video.author?.nickname || "",
            authorUsername: video.author?.unique_id || "",
            publishedAt: new Date(video.create_time * 1000).toISOString(),
            thumbnailUrl: video.video?.cover?.url_list?.[0] || "",
            videoUrl: video.video?.play_addr?.url_list?.[0] || "",
            duration: video.video?.duration || 0,
            viewCount: video.statistics?.play_count || 0,
            likeCount: video.statistics?.digg_count || 0,
            commentCount: video.statistics?.comment_count || 0,
            shareCount: video.statistics?.share_count || 0,
            tags: hashtags.map((tag: any) => tag.substring(1)), // Remove # do início
            musicTitle: video.music?.title || "",
            musicAuthor: video.music?.author || "",
            aspectRatio: "9:16", // TikTok é sempre vertical
            width: video.video?.width || 720,
            height: video.video?.height || 1280,
         };

         return videoData;
      } catch (error) {
         console.error("Error fetching TikTok video data:", error);
         throw error;
      }
   }

   /**
    * Extrai o ID do vídeo de uma URL do TikTok
    * @param url URL do TikTok
    * @returns ID do vídeo ou null se não encontrado
    */
   private extractVideoId2(url: string): string | null {
      try {
         // Padrões de URL do TikTok:
         // https://www.tiktok.com/@username/video/7499548253290040631
         // https://vm.tiktok.com/ZMhvw8QwJ/
         // https://tiktok.com/@username/video/7499548253290040631

         // Primeiro tenta extrair ID numérico da URL
         const numericMatch = url.match(/\/video\/(\d+)/);
         if (numericMatch) {
            return numericMatch[1];
         }

         // Se for URL encurtada (vm.tiktok.com), precisaria fazer redirect
         // Por enquanto, lança erro para URLs não suportadas
         const shortUrlMatch = url.match(/vm\.tiktok\.com|tiktok\.com\/t\//);
         if (shortUrlMatch) {
            throw new Error("URLs encurtadas do TikTok não são suportadas diretamente. Use a URL completa do vídeo.");
         }

         return null;
      } catch (error) {
         console.error("Error extracting video ID:", error);
         return null;
      }
   }

   /**
    * Método alternativo usando API não oficial (sem RapidAPI)
    * ATENÇÃO: Este método pode não funcionar sempre devido às medidas anti-bot do TikTok
    */
   async fetchVideoDataUnofficial(url: string): Promise<TikTokVideoData | null> {
      try {
         // Extrai dados do HTML da página
         const response = await fetch(url, {
            headers: {
               "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
         });

         if (!response.ok) {
            throw new Error(`Failed to fetch TikTok page: ${response.status}`);
         }

         const html = await response.text();

         // Procura por dados JSON na página
         const jsonMatch = html.match(/<script[^>]*>window\.__UNIVERSAL_DATA_RENDER_INFO__\s*=\s*({.*?})<\/script>/);

         if (!jsonMatch) {
            throw new Error("Could not find video data in TikTok page");
         }

         const data = JSON.parse(jsonMatch[1]);
         const video = data?.data?.video;

         if (!video) {
            return null;
         }

         return {
            id: video.id,
            title: video.desc || "",
            description: video.desc || "",
            authorName: video.author?.nickname || "",
            authorUsername: video.author?.uniqueId || "",
            publishedAt: new Date(video.createTime * 1000).toISOString(),
            thumbnailUrl: video.cover || "",
            videoUrl: video.playAddr || "",
            duration: video.duration || 0,
            viewCount: video.playCount || 0,
            likeCount: video.diggCount || 0,
            commentCount: video.commentCount || 0,
            shareCount: video.shareCount || 0,
            tags: [],
            aspectRatio: "9:16",
            width: 720,
            height: 1280,
         };
      } catch (error) {
         console.error("Error with unofficial TikTok scraping:", error);
         throw error;
      }
   }
}
