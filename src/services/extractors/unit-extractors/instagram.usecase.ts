interface InstagramVideoData {
   id: string;
   caption: string;
   username: string;
   fullName: string;
   timestamp: string;
   thumbnailUrl: string;
   videoUrl: string;
   duration?: number;
   viewCount?: number;
   likeCount: number;
   commentCount: number;
   isVideo: boolean;
   isReel: boolean;
   isIGTV: boolean;
   aspectRatio: string;
   width: number;
   height: number;
   hashtags: string[];
   mentions: string[];
   location?: string;
}

export class InstagramService {
   private accessToken: string;
   private baseUrl = "https://graph.instagram.com";
   private rapidApiKey: string;
   private rapidApiHost = "instagram-scraper-api2.p.rapidapi.com";

   constructor() {
      // Instagram Graph API requer token de acesso
      this.accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || "";
      this.rapidApiKey = process.env.RAPIDAPI_KEY || "";

      if (!this.accessToken && !this.rapidApiKey) {
         throw new Error("Either INSTAGRAM_ACCESS_TOKEN or RAPIDAPI_KEY environment variable is required");
      }
   }

   /**
    * Extrai o ID do post de uma URL do Instagram
    */
   private extractMediaId(input: string): string | null {
      // Se já é um ID
      if (/^\d+$/.test(input)) {
         return input;
      }

      // Regex para extrair shortcode de URLs do Instagram
      const patterns = [
         /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
         /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
         /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
         /instagram\.com\/stories\/[\w.-]+\/(\d+)/,
      ];

      for (const pattern of patterns) {
         const match = input.match(pattern);
         if (match && match[1]) {
            return match[1]; // Retorna shortcode
         }
      }

      return null;
   }

   /**
    * Converte shortcode para media ID (necessário para Graph API)
    */
   private shortcodeToMediaId(shortcode: string): string {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      let id = 0;

      for (let i = 0; i < shortcode.length; i++) {
         id = id * 64 + alphabet.indexOf(shortcode[i]);
      }

      return id.toString();
   }

   /**
    * Busca dados usando Instagram Graph API (método oficial)
    * Requer token de acesso válido
    */
   async fetchVideoDataOfficial(url: string): Promise<InstagramVideoData | null> {
      try {
         const shortcode = this.extractMediaId(url);
         if (!shortcode) {
            throw new Error("Invalid Instagram URL provided");
         }

         const mediaId = this.shortcodeToMediaId(shortcode);

         const apiUrl = `${this.baseUrl}/${mediaId}`;
         const params = new URLSearchParams({
            fields:
               "id,caption,media_type,media_url,thumbnail_url,timestamp,username,like_count,comments_count,permalink",
            access_token: this.accessToken,
         });

         const response = await fetch(`${apiUrl}?${params}`);

         if (!response.ok) {
            throw new Error(`Instagram API error: ${response.status} ${response.statusText}`);
         }

         const data: any = await response.json();

         // Extrai hashtags e mentions da caption
         const caption = data.caption || "";
         const hashtags = caption.match(/#[\w\u4e00-\u9fff]+/g) || [];
         const mentions = caption.match(/@[\w.-]+/g) || [];

         const videoData: InstagramVideoData = {
            id: data.id,
            caption: caption,
            username: data.username || "",
            fullName: "", // Não disponível nesta API
            timestamp: data.timestamp,
            thumbnailUrl: data.thumbnail_url || data.media_url,
            videoUrl: data.media_url,
            likeCount: data.like_count || 0,
            commentCount: data.comments_count || 0,
            isVideo: data.media_type === "VIDEO",
            isReel: url.includes("/reel/"),
            isIGTV: url.includes("/tv/"),
            aspectRatio: url.includes("/reel/") ? "9:16" : "1:1",
            width: 1080,
            height: url.includes("/reel/") ? 1920 : 1080,
            hashtags: hashtags.map((tag: any) => tag.substring(1)),
            mentions: mentions.map((mention: any) => mention.substring(1)),
         };

         return videoData;
      } catch (error) {
         console.error("Error fetching Instagram data (official):", error);
         throw error;
      }
   }

   /**
    * Busca dados usando RapidAPI (método não oficial)
    */
   async fetchVideoData(url: string): Promise<InstagramVideoData | null> {
      try {
         const apiUrl = `https://${this.rapidApiHost}/v1/post_info`;

         const response = await fetch(apiUrl, {
            method: "GET",
            headers: {
               "X-RapidAPI-Key": this.rapidApiKey,
               "X-RapidAPI-Host": this.rapidApiHost,
            },
            body: JSON.stringify({
               code_or_id_or_url: url,
            }),
         });

         if (!response.ok) {
            throw new Error(`Instagram API error: ${response.status} ${response.statusText}`);
         }

         const data: any = await response.json();

         if (!data || !data.data) {
            return null;
         }

         const post = data.data;
         const caption = post.caption?.text || "";
         const hashtags = caption.match(/#[\w\u4e00-\u9fff]+/g) || [];
         const mentions = caption.match(/@[\w.-]+/g) || [];

         const videoData: InstagramVideoData = {
            id: post.id,
            caption: caption,
            username: post.owner?.username || "",
            fullName: post.owner?.full_name || "",
            timestamp: new Date(post.taken_at * 1000).toISOString(),
            thumbnailUrl: post.image_versions2?.candidates?.[0]?.url || "",
            videoUrl: post.video_versions?.[0]?.url || "",
            duration: post.video_duration,
            viewCount: post.view_count,
            likeCount: post.like_count || 0,
            commentCount: post.comment_count || 0,
            isVideo: post.media_type === 2,
            isReel: post.product_type === "clips",
            isIGTV: post.product_type === "igtv",
            aspectRatio: post.product_type === "clips" ? "9:16" : "1:1",
            width: post.original_width || 1080,
            height: post.original_height || 1080,
            hashtags: hashtags.map((tag: any) => tag.substring(1)),
            mentions: mentions.map((mention: any) => mention.substring(1)),
            location: post.location?.name,
         };

         return videoData;
      } catch (error) {
         console.error("Error fetching Instagram video data:", error);
         throw error;
      }
   }

   /**
    * Método alternativo usando scraping (menos confiável)
    */
   async fetchVideoDataScraping(url: string): Promise<InstagramVideoData | null> {
      try {
         const response = await fetch(url, {
            headers: {
               "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
         });

         if (!response.ok) {
            throw new Error(`Failed to fetch Instagram page: ${response.status}`);
         }

         const html = await response.text();

         // Procura por dados JSON na página
         const jsonMatch = html.match(/window\._sharedData\s*=\s*({.*?});/);

         if (!jsonMatch) {
            throw new Error("Could not find post data in Instagram page");
         }

         const sharedData = JSON.parse(jsonMatch[1]);
         const post = sharedData?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;

         if (!post) {
            return null;
         }

         const caption = post.edge_media_to_caption?.edges?.[0]?.node?.text || "";
         const hashtags = caption.match(/#[\w\u4e00-\u9fff]+/g) || [];
         const mentions = caption.match(/@[\w.-]+/g) || [];

         return {
            id: post.id,
            caption: caption,
            username: post.owner?.username || "",
            fullName: post.owner?.full_name || "",
            timestamp: new Date(post.taken_at_timestamp * 1000).toISOString(),
            thumbnailUrl: post.display_url,
            videoUrl: post.video_url || "",
            duration: post.video_duration,
            viewCount: post.video_view_count,
            likeCount: post.edge_media_preview_like?.count || 0,
            commentCount: post.edge_media_to_comment?.count || 0,
            isVideo: post.is_video,
            isReel: post.product_type === "clips",
            isIGTV: post.product_type === "igtv",
            aspectRatio: post.product_type === "clips" ? "9:16" : "1:1",
            width: post.dimensions?.width || 1080,
            height: post.dimensions?.height || 1080,
            hashtags: hashtags.map((tag: any) => tag.substring(1)),
            mentions: mentions.map((mention: any) => mention.substring(1)),
         };
      } catch (error) {
         console.error("Error with Instagram scraping:", error);
         throw error;
      }
   }
}
