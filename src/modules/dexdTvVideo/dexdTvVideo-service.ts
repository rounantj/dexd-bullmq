import { DexdTvVideo, PrismaClient, User } from "@prisma/client";
import {
   DexdTvVideoSavePayload,
   DexdTvVideoUpdatePayload,
   DexdTvVideosFetchPayload,
   DexdTvVideosFetchPayloadResponse,
   UserDexdTvVideoSavePayload,
} from "./dexdTvVideo-interfaces";
import DexdTvVideoRepository from "./dexdTvVideo-repository";
import { NotFoundError } from "@pullup.tech/cms";
import { SearchGetPayload, SearchPayload } from "../global-interface";
import Global from "../../helpers/_globals";
import ProductRepository from "../product/product-repository";
import StoreService from "../store/store-service";
import TagRepository from "../tag/tag-repository";
import OrderRepository from "../order/order-repository";
import PaymentService from "../payment/payment-service";
import DexdBoostRepository from "../dexdBoost/dexdBoost-repository";
import NotificationService from "../notification/notification-service";
import { linkTags } from "../../helpers/linkTags";

export default class DexdTvVideoService {
   private readonly dexdTvVideoRepository: DexdTvVideoRepository;
   private readonly productRepository: ProductRepository;
   private readonly storeService: StoreService;
   private readonly asaasService: PaymentService;
   private readonly orderRepository: OrderRepository;
   private readonly tagsRepository: TagRepository;
   private readonly dexdBoostRepository: DexdBoostRepository;
   private readonly notificationService: NotificationService;
   private readonly _global: Global;
   private readonly _client: PrismaClient;

   constructor(public prismaClient: PrismaClient) {
      this.dexdTvVideoRepository = new DexdTvVideoRepository(prismaClient);
      this.productRepository = new ProductRepository(prismaClient);
      this.storeService = new StoreService(prismaClient);
      this.orderRepository = new OrderRepository(prismaClient);
      this.tagsRepository = new TagRepository(prismaClient);
      this.dexdBoostRepository = new DexdBoostRepository(prismaClient);
      this.notificationService = new NotificationService(prismaClient);
      this.asaasService = new PaymentService(prismaClient);
      this._client = prismaClient;
      this._global = new Global();
   }

   async fetchAll(relations: DexdTvVideosFetchPayload, pagination: SearchGetPayload) {
      const videos = await this.dexdTvVideoRepository.all(relations, pagination);

      if (videos && videos[0].length == 0) throw new NotFoundError("Nenhum video foi encontrado!");

      return {
         videos: videos[0],
         pages: Math.ceil(videos[1] / (pagination.take ? parseInt(pagination.take) : 10)),
      };
   }

   async fetchAllWithRelations(relations: DexdTvVideosFetchPayload, pagination: SearchGetPayload, search?: string) {
      const videos = await this.dexdTvVideoRepository.allWithRelations(relations, pagination, search);

      if (videos && videos[0].length == 0) throw new NotFoundError("Nenhum video foi encontrado!");

      return {
         videos: videos[0],
         total: videos[1],
         pages: Math.ceil(videos[1] / (pagination.take ? parseInt(pagination.take) : 10)),
      };
   }

   async fetchByUserId(user?: User) {
      if (!user) throw new NotFoundError("Usuário não encontrado");
      const videos = await this.dexdTvVideoRepository.getByUser(user.id);
      if (videos && videos.length == 0) throw new NotFoundError("Nenhum video foi encontrado!");

      return { videos };
   }

   // async fetchByUserIdFiltered(
   //   params: DexdTvVideosFetchPayload,
   //   payload: DexdTvVideosDataFetchPayload
   // ) {
   //   const videos = await this.dexdTvVideoRepository.getByUserFiltered(
   //     params,
   //     payload
   //   );
   //   return { videos };
   // }

   async fetchById(id: number, relations: DexdTvVideosFetchPayload, loggedUserId?: number) {
      const dexdTvVideo = await this.dexdTvVideoRepository.get(id, relations);

      if (!dexdTvVideo) throw new NotFoundError("Video não foi encontrado!");

      let liked = null;
      if (loggedUserId) {
         const like = await this.dexdTvVideoRepository.findLikedDexdTvVideo(id, loggedUserId);
         liked = like ? like.like : false;
      }

      const products = await this.productRepository.findMany({
         where: {
            dexdVideoId: id,
            price: { gt: 0 },
            isCourse: false,
            deletedAt: null,
         },
         include: {
            medias: true,
            store: true,
            tags: true,
         },
      });
      return { dexdTvVideo: { ...dexdTvVideo, products, isLiked: liked } };
   }

   async fetchRankingFilter(payload: SearchPayload, relations: DexdTvVideosFetchPayload) {
      const { sort, ...searchRequest } = payload.search;
      const dexdTvVideos = await this.dexdTvVideoRepository.search(searchRequest, relations);
      if (dexdTvVideos[0].length == 0) throw new NotFoundError("Não há videos para exibir");

      const sortBy = payload.search && sort ? sort : "score";
      const dexdTvVideosRanked = await this.rankDexdTvVideos(dexdTvVideos[0], sortBy);

      const startSlice = ((payload.pagination?.page || 1) - 1) * (payload.pagination?.take || 10);
      const endSlice = startSlice + (payload.pagination?.take || 10);
      const slicedRanking = dexdTvVideosRanked.slice(startSlice, endSlice);

      return { ranking: slicedRanking };
   }

   async fetchUserCourses(user?: User) {
      if (!user) throw new NotFoundError("Usuário não encontrado");

      const userCourses = await this.dexdTvVideoRepository.getUserCourses(user.id);

      if (!userCourses) throw new NotFoundError("Nenhum curso foi encontrado!");

      return { userCourses };
   }

   async fetchUserCourseById(id: number) {
      const userCourse = await this.dexdTvVideoRepository.getUserCourse(id);

      if (!userCourse) throw new NotFoundError("Curso não foi encontrado!");

      if (userCourse.released) {
         return { userCourse };
      } else {
         const orderProduct = await this.orderRepository.getOrderTransportByProductId(userCourse.dexdTv.productId);

         if (orderProduct) {
            const { payment } = await this.asaasService.showPayment(orderProduct.order.paymentTypeId.toString());

            if (payment.status === "RECEIVED" || payment.status === "RECEIVED_IN_CASH") {
               await this.dexdTvVideoRepository.updateUserCourse(id, {
                  released: true,
               });

               return { userCourse };
            }
         }

         return {
            message: "Curso ainda não disponível, pagamento em processamento!",
         };
      }
   }

   async searchCourse(payload: SearchPayload) {
      const filters = this._global.generateFilters(payload);
      let videos = null;

      if (filters.where && filters.where.OR && filters.where.OR.length == 0) {
         videos = await this.dexdTvVideoRepository.searchCourse({});
      } else {
         videos = await this.dexdTvVideoRepository.searchCourse(filters);
      }

      if (videos && videos[0].length == 0) throw new NotFoundError("Nenhum curso foi encontrado!");

      return {
         videos: videos[0],
         pages: Math.ceil(videos[1] / (payload.pagination ? payload.pagination.take : 10)),
      };
   }

   async search(payload: SearchPayload, relations: DexdTvVideosFetchPayload) {
      const filters = this._global.generateFilters(payload);

      // Sempre incluir as tags nas relações
      const include = {
         ...relations.include,
         user: {
            include: {
               address: true,
               role: true,
               tags: {
                  include: {
                     tag: true,
                  },
               },
            },
         },
         likes: true,
         dexdBoosts: true,
         tags: {
            include: {
               tag: true,
            },
         },
         watchers: true,
         complaints: true,
         product: {
            include: {
               medias: true,
               store: true,
               tags: {
                  include: {
                     tag: true,
                  },
               },
            },
         },
         _count: {
            select: {
               likes: true,
               watchers: true,
               complaints: true,
            },
         },
      };

      const videos = await this.dexdTvVideoRepository.search(filters, { include: include as any });

      if (videos && videos[0].length == 0) throw new NotFoundError("Nenhum dexdTv video foi encontrado!");

      return {
         videos: videos[0],
         pages: Math.ceil(videos[1] / (payload.pagination ? payload.pagination.take : 10)),
      };
   }

   async saveUserCourse(payload: UserDexdTvVideoSavePayload) {
      const video = await this.search({ search: { productId: payload.productId } }, {});

      const videos = await this.dexdTvVideoRepository.saveUserCourse({
         dexdTvId: video.videos[0].id,
         watcherId: payload.watcherId,
      });

      return { videos };
   }

   async store(payload: DexdTvVideoSavePayload) {
      const store = await this.storeService.search(
         {
            search: {
               companyName: { contains: "Dexd Store" },
            },
         },
         {}
      );

      // Criar um produto "invisível" apenas para satisfazer a constraint do banco
      const product = await this.productRepository.save({
         name: `Vídeo: ${payload.title}`,
         price: 0,
         storeId: store.stores[0].id,
         description: "Produto interno para vídeo - não visível",
         cost: 0,
         measureHeight: 0,
         measureWidth: 0,
         measureLength: 0,
         weight: 0,
         quantity: -1,
         isCourse: false, // Não é mais um curso
         ncm: "0000.00.00",
         measurementUnitId: 1,
         medias: [
            {
               url:
                  payload.thumbnail ||
                  "https://res.cloudinary.com/de6vmpoiy/image/upload/v1695837709/unknown.405a1077_tn4zdk.jpg",
            },
         ],
         toFeed: false, // Não aparece no feed
         feedDescription: undefined,
         type: "internal", // Marca como interno
      });

      const { tags, ...payloadResponse } = payload;

      payloadResponse.value = undefined;
      const video = await this.dexdTvVideoRepository.save({
         ...payloadResponse,
         thumbnail:
            payloadResponse.thumbnail ||
            "https://res.cloudinary.com/de6vmpoiy/image/upload/v1695837709/unknown.405a1077_tn4zdk.jpg",
         productId: product.id,
      });

      if (tags) {
         const tagsToLink = tags.map((tagId) => {
            return {
               id: tagId,
               type: "incorporation",
            };
         });
         await linkTags(tagsToLink, video.id, "dexdTvVideo", "incorporation");
      }

      // Criar notificações baseadas em tags de interesse
      if (tags && tags.length > 0) {
         try {
            await this.notificationService.createTagBasedNotifications(
               tags,
               payload.userId,
               "video",
               video.id,
               payload.title
            );
         } catch (error) {
            console.error("❌ [DexdTvVideo Service]: Error creating notifications:", error);
         }
      }

      return { video };
   }

   async like(id: number, user: User) {
      const environment = await this.dexdTvVideoRepository.like(id, user.id);
      return { environment };
   }

   async update(id: number, payload: DexdTvVideoUpdatePayload) {
      const { tags, ...payloadResponse } = payload;

      // Sempre processar as tags, mesmo se for um array vazio
      const tagsToLink = tags
         ? tags.map((tagId) => {
              return {
                 id: tagId,
                 type: "incorporation",
              };
           })
         : [];

      await linkTags(tagsToLink, id, "dexdTvVideo", "incorporation");

      const video = await this.dexdTvVideoRepository.update(id, payloadResponse);
      return { video };
   }

   async destroy(id: number) {
      const video = await this.dexdTvVideoRepository.get(id, {});
      if (!video) throw new NotFoundError("DexdTv video não foi encontrado!");

      // Deletar o produto interno associado ao vídeo
      await this.productRepository.delete(video.productId);

      const deletedVideo = await this.dexdTvVideoRepository.delete(id);
      return { video: deletedVideo };
   }

   public async rankDexdTvVideos(dexdTvVideos: Array<DexdTvVideo & DexdTvVideosFetchPayloadResponse>, sortBy: string) {
      const rankedDexdTvVideossMapped = dexdTvVideos.map(async (dexdTvVideo) => {
         let totalUserViews = dexdTvVideo.watchers || 0;
         let score = 0;

         const dexdTvVideoDexdBoosts = await this.dexdBoostRepository.latestPoints(dexdTvVideo.id, "dexdTvVideo");
         score = dexdTvVideoDexdBoosts._sum.investment ?? 0;

         return {
            ...dexdTvVideo,
            likes: dexdTvVideo.likes?.length || 0,
            visualizations: totalUserViews,
            score,
         };
      });

      const rankedDexdTvVideosResolved = await Promise.all(rankedDexdTvVideossMapped);

      const ranking = rankedDexdTvVideosResolved.sort((current, previous) => {
         return ((previous as any)[sortBy] || 0) - ((current as any)[sortBy] || 0);
      });

      return ranking;
   }
}
