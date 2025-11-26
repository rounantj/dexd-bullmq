import {
   Address,
   BusinessOpportunity,
   Complaint,
   DexdBoost,
   Measurement_Unit,
   Media,
   OrderProduct,
   Pin,
   Product,
   ProductCart,
   ProductLikes,
   ProductViews,
   Product_Media,
   Store,
   Tag,
   User,
} from "@prisma/client";
import { TagSavePayload } from "../tag/tag-interfaces";

// Fetch
export interface ProductFetchPayload {
   store?: boolean | Object;
   supplier?: boolean | Object;
   pins?: boolean | Object;
   images?: boolean | Object;
   tributes?: boolean | Object;
   materials?: boolean;
   complaints?: boolean;
}
export interface ProductFetchPayloadDTO {
   include?: {
      measurementUnit?: boolean;
      store?: boolean | any;
      supplier?: boolean;
      pins?: boolean;
      medias?: boolean | Object;
      likes?: boolean;
      opportunities?: boolean;
      carts?: boolean;
      orderProducts?: boolean;
      tags?: boolean;
      complaints?: boolean;
      views?: boolean;
      productProfile?: boolean;
      dexdBoosts?: boolean | any;
      _count?: Object;
   };
}
export interface ProductFetchResponseDTO {
   measurementUnit?: Measurement_Unit;
   store?: Store & { user?: User & { address?: Address } };
   supplier?: Store & { user: User & { address: Address } };
   pins?: Pin[];
   medias?: Media[];
   likes?: ProductLikes[];
   opportunities?: BusinessOpportunity[];
   carts?: ProductCart[];
   orderProducts?: OrderProduct[];
   tags?: Tag[];
   complaints?: Complaint[];
   views?: ProductViews[];
   productProfile?: ProductViews[];
   dexdBoosts?: DexdBoost[];
   _count?: { productProfile: number };
}

export interface ProductFilterFetchPayload {
   store?: boolean | Object;
   materials?: boolean;
}

export interface ProductsFetchPayload {
   skip?: number;
   take?: number;
}

export type ProductTributeByStatesPayload = {
   originStateId: number;
   destinyStateId: number;
};

export type ProductTributeByStatesUfPayload = {
   originState: string;
   destinyState: string;
};

export interface ProductFetchPayloadFilter {
   filters: ProductFetchFilters;
   orderBy: Object;
   skip?: number;
   take?: number;
}

export interface ProductFetchPayloadFilterDTO {
   store?: Store & { user?: User };
   medias?: Product_Media[];
}

export interface ProductFetchFilters {
   name?: string | Object;
   store?: Object;
}

export interface ProductFetchAllResponseDTO {
   products: Product[];
}

export interface ProductFetchOneResponseDTO {
   product: Product;
}

export interface PinResponseDTO {
   id: number;
   xAxis: string;
   yAxis: string;
   productId: number | null;
   mediaId: number;
   architectId: number | null;
   userId: number | null;
   type: string;
   url: string | null;
   paid: boolean;
   paidAmount: number | null;
   createdAt: Date;
   updatedAt: Date;
}

export interface PinWithArchitect extends PinResponseDTO {
   architect?: {
      id: number;
      occupation: string | null;
      educationalInstitution: string | null;
      formationYear: number | null;
      userId: number;
      createdAt: Date;
      updatedAt: Date;
      companyName: string | null;
      tradingName: string | null;
      visualizations: number;
      pis: string | null;
      user?: {
         id: number;
         email: string;
         name: string;
         surname: string | null;
         address?: {
            id: number;
            street: string;
            number: string;
            complement: string | null;
            neighborhood: string;
            city: string;
            state: string;
            zipCode: string;
            country: string;
         };
      };
   } | null;
}

// Save
export interface ProductSavePayload extends ProductSaveDTO {
   tags?: TagSavePayload[];
}

export interface ProductSaveDTO {
   name: string;
   price: number;
   dropShippingPrice?: number;
   cashback?: number;
   cost: number;
   description: string;
   material?: string;
   benefits?: string;
   measureHeight: number;
   measureWidth: number;
   measureLength: number;
   weight: number;
   isCourse?: boolean;
   ncm: string;
   moreDetails?: string;
   quantity?: number;
   storeId: number;
   supplierId?: number;
   medias: ProductMedia[];
   materials?: ProductMeterial[];
   measurementUnitId: number;
   toFeed?: boolean;
   feedDescription?: string;
   measureHeightWithPackaging?: number;
   measureWidthWithPackaging?: number;
   measureLengthWithPackaging?: number;
   weightWithPackaging?: number;
   model?: string;
   line?: string;
   power?: string;
   consumption?: string;
   capacity?: string;
  guarantee?: string;
  url?: string;
  type?: string;
  additionalData?: any;
}

export interface ProductMedia {
  id?: number;
  url: string;
}

export interface ProductMeterial {
   material: string;
   imageUrl: string;
}

// Update
export interface ProductUpdatePayload {
   name?: string;
   price?: number;
   dropShippingPrice?: number;
   cashback?: number;
   cost?: number;
   description?: string;
   material?: string;
   benefits?: string;
   measureHeight?: number;
   measureWidth?: number;
   measureLength?: number;
   weight?: number;
   ncm?: string;
   moreDetails?: string;
   quantity?: number;
   medias?: ProductMedia[];
   materials?: ProductMeterial[];
   measurementUnitId?: number;
   toFeed?: boolean;
   feedDescription?: string;
   measureHeightWithPackaging?: number;
   measureWidthWithPackaging?: number;
   measureLengthWithPackaging?: number;
   weightWithPackaging?: number;
   model?: string;
   line?: string;
   power?: string;
   consumption?: string;
   capacity?: string;
   guarantee?: string;
   url?: string;
   type?: string;
   additionalData?: any; // Dados adicionais para produtos manuais (ex: storeAddress)
   dexdVideoId?: number; // Permite vincular produto como material de apoio em vídeo
}

export interface ProductMediaOldAndNew {
   newMedias: ProductMedia[];
   oldMedias: ProductMedia[];
   oldMediasToExclude: ProductMedia[];
}

// Destroy
