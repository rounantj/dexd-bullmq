interface FacebookVideoData {
   id: string;
   title: string;
   description: string;
   authorName: string;
   authorId: string;
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
   hashtags: string[];
   mentions: string[];
   isLive: boolean;
   isPublic: boolean;
   pageInfo?: {
      name: string;
      category: string;
      verified: boolean;
   };
}

export class FacebookService {
   private accessToken: string;
   private appId: string;
   private appSecret: string;
   private baseUrl = "https://graph.facebook.com/v18.0";

   constructor() {
      this.accessToken = process.env.FACEBOOK_ACCESS_TOKEN || "";
      this.appId = process.env.FACEBOOK_APP_ID || "";
      this.appSecret = process.env.FACEBOOK_APP_SECRET || "";

      if (!this.accessToken || !this.appId) {
         console.warn("⚠️ [Facebook Extractor]: FACEBOOK_ACCESS_TOKEN and FACEBOOK_APP_ID environment variables are required");
      }
   }

   /**
    * Extrai o ID do vídeo de uma URL do Facebook
    */
   private extractVideoId(input: string): string | null {
      // Se já é um ID numérico
      if (/^\d+$/.test(input)) {
         return input;
      }

      // Regex para extrair ID de URLs do Facebook
      const patterns = [
         /facebook\.com\/.*\/videos\/(\d+)/,
         /facebook\.com\/watch\/\?v=(\d+)/,
         /facebook\.com\/.*\/posts\/(\d+)/,
         /fb\.watch\/([a-zA-Z0-9]+)/,
         /facebook\.com\/video\.php\?v=(\d+)/,
         /facebook\.com\/.*\/videos\/vb\.\d+\/(\d+)/,
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
    * Gera token de acesso da aplicação se necessário
    */
   private async getAppAccessToken(): Promise<string> {
      if (!this.appSecret) {
         return this.accessToken;
      }

      try {
         const url = `${this.baseUrl}/oauth/access_token`;
         const params = new URLSearchParams({
            client_id: this.appId,
            client_secret: this.appSecret,
            grant_type: "client_credentials",
         });

         const response = await fetch(`${url}?${params}`);
         const data: any = await response.json();

         return data.access_token || this.accessToken;
      } catch (error) {
         console.warn("Failed to get app access token, using provided token");
         return this.accessToken;
      }
   }

   /**
    * Busca dados do vídeo do Facebook usando Graph API
    */
   async fetchVideoData(url: string): Promise<FacebookVideoData | null> {
      try {
         const videoId = this.extractVideoId(url);
         if (!videoId) {
            throw new Error("Invalid Facebook video URL provided");
         }

         const accessToken = await this.getAppAccessToken();

         // Campos que queremos buscar
         const fields = [
            "id",
            "title",
            "description",
            "created_time",
            "updated_time",
            "length",
            "picture",
            "source",
            "thumbnails",
            "views",
            "likes.summary(true)",
            "comments.summary(true)",
            "shares",
            "from",
            "privacy",
            "status",
            "embeddable",
            "live_status",
         ].join(",");

         const apiUrl = `${this.baseUrl}/${videoId}`;
         const params = new URLSearchParams({
            fields: fields,
            access_token: accessToken,
         });

         const response = await fetch(`${apiUrl}?${params}`);

         if (!response.ok) {
            const errorData: any = await response.json();
            throw new Error(
               `Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`
            );
         }

         const data: any = await response.json();

         // Extrai hashtags e mentions da descrição
         const description = data.description || "";
         const hashtags = description.match(/#[\w\u4e00-\u9fff]+/g) || [];
         const mentions = description.match(/@[\w.-]+/g) || [];

         // Determina aspect ratio baseado no tipo de vídeo
         let aspectRatio = "16:9"; // Padrão
         if (data.length && data.length < 60) {
            aspectRatio = "9:16"; // Provavelmente um vídeo curto/vertical
         }

         const videoData: FacebookVideoData = {
            id: data.id,
            title: data.title || "",
            description: description,
            authorName: data.from?.name || "",
            authorId: data.from?.id || "",
            publishedAt: data.created_time,
            thumbnailUrl: data.picture || data.thumbnails?.data?.[0]?.uri || "",
            videoUrl: data.source || "",
            duration: data.length || 0,
            viewCount: data.views || 0,
            likeCount: data.likes?.summary?.total_count || 0,
            commentCount: data.comments?.summary?.total_count || 0,
            shareCount: data.shares?.count || 0,
            aspectRatio: aspectRatio,
            width: 1280,
            height: aspectRatio === "9:16" ? 1920 : 720,
            hashtags: hashtags.map((tag: any) => tag.substring(1)),
            mentions: mentions.map((mention: any) => mention.substring(1)),
            isLive: data.live_status === "LIVE",
            isPublic: data.privacy?.value === "EVERYONE",
            pageInfo: data.from
               ? {
                    name: data.from.name,
                    category: data.from.category || "",
                    verified: data.from.verified || false,
                 }
               : undefined,
         };

         return videoData;
      } catch (error) {
         console.error("Error fetching Facebook video data:", error);
         throw error;
      }
   }

   /**
    * Busca múltiplos vídeos por IDs
    */
   async fetchMultipleVideos(urls: string[]): Promise<FacebookVideoData[]> {
      const results: FacebookVideoData[] = [];

      for (const url of urls) {
         try {
            const videoData = await this.fetchVideoData(url);
            if (videoData) {
               results.push(videoData);
            }
         } catch (error) {
            console.error(`Error fetching video ${url}:`, error);
         }
      }

      return results;
   }

   /**
    * Busca vídeos de uma página específica
    */
   async fetchPageVideos(pageId: string, limit: number = 25): Promise<FacebookVideoData[]> {
      try {
         const accessToken = await this.getAppAccessToken();

         const apiUrl = `${this.baseUrl}/${pageId}/videos`;
         const params = new URLSearchParams({
            limit: limit.toString(),
            access_token: accessToken,
            fields: "id,title,description,created_time,source,picture,length,views",
         });

         const response = await fetch(`${apiUrl}?${params}`);

         if (!response.ok) {
            const errorData: any = await response.json();
            throw new Error(
               `Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`
            );
         }

         const data: any = await response.json();
         const videos: FacebookVideoData[] = [];

         for (const video of data.data || []) {
            const videoData: FacebookVideoData = {
               id: video.id,
               title: video.title || "",
               description: video.description || "",
               authorName: "",
               authorId: pageId,
               publishedAt: video.created_time,
               thumbnailUrl: video.picture || "",
               videoUrl: video.source || "",
               duration: video.length || 0,
               viewCount: video.views || 0,
               likeCount: 0,
               commentCount: 0,
               shareCount: 0,
               aspectRatio: "16:9",
               width: 1280,
               height: 720,
               hashtags: [],
               mentions: [],
               isLive: false,
               isPublic: true,
            };

            videos.push(videoData);
         }

         return videos;
      } catch (error) {
         console.error("Error fetching page videos:", error);
         throw error;
      }
   }

   /**
    * Valida se uma URL é válida do Facebook
    */
   isValidFacebookUrl(url: string): boolean {
      return this.extractVideoId(url) !== null;
   }

   /**
    * Busca informações de uma página do Facebook
    */
   async fetchPageInfo(pageId: string) {
      try {
         const accessToken = await this.getAppAccessToken();

         const apiUrl = `${this.baseUrl}/${pageId}`;
         const params = new URLSearchParams({
            fields: "id,name,category,verified,picture,about,fan_count",
            access_token: accessToken,
         });

         const response = await fetch(`${apiUrl}?${params}`);

         if (!response.ok) {
            const errorData: any = await response.json();
            throw new Error(
               `Facebook API error: ${response.status} - ${errorData.error?.message || response.statusText}`
            );
         }

         return await response.json();
      } catch (error) {
         console.error("Error fetching page info:", error);
         throw error;
      }
   }
}
