import { Address, Complaint, DexdBoost, DexdTvVideoLikes, Entity_Tag, User, UserDexdTvVideo } from "@prisma/client";

// Fetch
export interface DexdTvVideosFetchPayload {
   include?: {
      user?: boolean | Object;
      likes?: boolean | Object;
      dexdBoosts?: boolean;
      tags?: boolean;
   };
}
export interface DexdTvVideosFetchPayloadResponse {
   user?: User & { address?: Address };
   likes?: DexdTvVideoLikes[];
   dexdBoosts?: DexdBoost[];
   tags?: Entity_Tag[];
   watchers?: UserDexdTvVideo[];
   complaints?: Complaint[];
}

export interface DexdTvVideosDataFetchPayload {
   filters: DexdTvVideosFetchByFilters;
   skip?: number;
   take?: number;
}

export interface DexdTvVideosFetchByFilters {
   user: object;
}
// Save
export interface DexdTvVideoSavePayload {
   title: string;
   url: string;
   userId: number;
   isPaid: boolean;
   thumbnail?: string;
   value?: number;
   description: string;
   tags?: number[];
   toFeed?: boolean;
   feedDescription?: string;
}
export interface DexdTvVideoSaveDTO {
   title: string;
   url: string;
   userId: number;
   isPaid: boolean;
   productId: number;
   thumbnail?: string;
   description: string;
   toFeed?: boolean;
   feedDescription?: string;
}
export interface UserDexdTvVideoSaveDTO {
   dexdTvId: number;
   watcherId: number;
}
export interface UserDexdTvVideoSavePayload {
   watcherId: number;
   productId: number;
}

// Update
export interface DexdTvVideoUpdatePayload {
   title?: string;
   url?: string;
   rating?: number;
   isPaid?: boolean;
   productId?: number;
   thumbnail: string;
   description?: string;
   toFeed?: boolean;
   tags?: number[];
   feedDescription?: string;
}
export interface DexdTvVideoUpdatePayloadDTO {
   title?: string;
   url?: string;
   rating?: number;
   isPaid?: boolean;
   productId?: number;
   thumbnail: string;
   description?: string;
   toFeed?: boolean;
   feedDescription?: string;
}

// Destroy
