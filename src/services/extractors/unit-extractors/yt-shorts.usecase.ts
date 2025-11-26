interface YouTubeShortsData {
   id: string;
   title: string;
   description: string;
   channelTitle: string;
   publishedAt: string;
   thumbnails: {
      default: { url: string; width: number; height: number };
      medium: { url: string; width: number; height: number };
      high: { url: string; width: number; height: number };
      standard?: { url: string; width: number; height: number };
      maxres?: { url: string; width: number; height: number };
   };
   tags?: string[];
   categoryId: string;
   duration: string;
   viewCount: string;
   likeCount: string;
   commentCount: string;
   isShort: boolean;
   aspectRatio: string;
}

export class YouTubeShortsService {
   private apiKey: string;
   private baseUrl = "https://www.googleapis.com/youtube/v3";

   constructor() {
      this.apiKey = process.env.GOOGLE_API_KEY || "";
      if (!this.apiKey) {
         throw new Error("GOOGLE_API_KEY environment variable is required");
      }
   }

   /**
    * Extrai o ID do vídeo de uma URL do YouTube Shorts
    */
   private extractVideoId(input: string): string | null {
      // Se já é um ID (11 caracteres alfanuméricos)
      if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
         return input;
      }

      // Regex para extrair ID de URLs do YouTube (incluindo Shorts)
      const patterns = [
         /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
         /youtube\.com\/shorts\/([^&\n?#]+)/,
         /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
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
    * Converte duração ISO 8601 para segundos
    */
   private parseDuration(duration: string): number {
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;

      const hours = parseInt(match[1] || "0");
      const minutes = parseInt(match[2] || "0");
      const seconds = parseInt(match[3] || "0");

      return hours * 3600 + minutes * 60 + seconds;
   }

   /**
    * Verifica se o vídeo é um Short baseado na duração
    */
   private isVideoShort(duration: string): boolean {
      const durationInSeconds = this.parseDuration(duration);
      return durationInSeconds <= 60; // Shorts têm até 60 segundos
   }

   /**
    * Busca dados do YouTube Shorts usando a API oficial
    * @param urlOrId URL completa do YouTube Shorts ou ID do vídeo
    * @returns Dados do vídeo em formato JSON
    */
   async fetchShortsData(urlOrId: string): Promise<YouTubeShortsData | null> {
      try {
         const videoId = this.extractVideoId(urlOrId);

         if (!videoId) {
            throw new Error("Invalid YouTube URL or video ID provided");
         }

         // Monta a URL da requisição com todas as partes necessárias
         const url = new URL(`${this.baseUrl}/videos`);
         url.searchParams.append("part", "snippet,statistics,contentDetails");
         url.searchParams.append("id", videoId);
         url.searchParams.append("key", this.apiKey);

         const response = await fetch(url.toString());

         if (!response.ok) {
            throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
         }

         const data: any = await response.json();

         if (!data.items || data.items.length === 0) {
            return null;
         }

         const video = data.items[0];
         const snippet = video.snippet;
         const statistics = video.statistics;
         const contentDetails = video.contentDetails;

         const isShort = this.isVideoShort(contentDetails.duration);

         // Formata os dados de retorno
         const shortsData: YouTubeShortsData = {
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
            isShort: isShort,
            aspectRatio: isShort ? "9:16" : "16:9",
         };

         return shortsData;
      } catch (error) {
         console.error("Error fetching YouTube Shorts data:", error);
         throw error;
      }
   }
}
