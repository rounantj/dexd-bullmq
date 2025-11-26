interface YouTubeVideoData {
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
}

export class YouTubeService {
   private apiKey: string;
   private baseUrl = "https://www.googleapis.com/youtube/v3";

   constructor() {
      this.apiKey = process.env.GOOGLE_API_KEY || "";
      if (!this.apiKey) {
         throw new Error("GOOGLE_API_KEY environment variable is required");
      }
   }

   /**
    * Extrai o ID do vídeo de uma URL do YouTube
    */
   private extractVideoId(input: string): string | null {
      // Se já é um ID (11 caracteres alfanuméricos)
      if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
         return input;
      }

      // Regex para extrair ID de URLs do YouTube
      const patterns = [
         /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
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
    * Busca dados do vídeo do YouTube usando a API oficial
    * @param urlOrId URL completa do YouTube ou ID do vídeo
    * @returns Dados do vídeo em formato JSON
    */
   async fetchVideoData(urlOrId: string): Promise<YouTubeVideoData | null> {
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
            return null; // Vídeo não encontrado
         }

         const video = data.items[0];
         const snippet = video.snippet;
         const statistics = video.statistics;
         const contentDetails = video.contentDetails;

         // Formata os dados de retorno
         const videoData: YouTubeVideoData = {
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

         return videoData;
      } catch (error) {
         console.error("Error fetching YouTube video data:", error);
         throw error;
      }
   }

   /**
    * Busca apenas a descrição do vídeo (método mais simples)
    * @param urlOrId URL completa do YouTube ou ID do vídeo
    * @returns Descrição do vídeo
    */
   async fetchVideoDescription(urlOrId: string): Promise<string | null> {
      try {
         const videoData = await this.fetchVideoData(urlOrId);
         return videoData?.description || null;
      } catch (error) {
         console.error("Error fetching YouTube video description:", error);
         throw error;
      }
   }
}
