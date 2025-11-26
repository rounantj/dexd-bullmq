import { PrismaClient, Subscription, User, Product, UserSubscription } from "@prisma/client";
import { ForbiddenError, NotFoundError, AuthenticationError } from "@pullup.tech/cms";
import {
   ProductFetchPayload,
   ProductFetchPayloadDTO,
   ProductFetchPayloadFilter,
   ProductFetchPayloadFilterDTO,
   ProductFetchResponseDTO,
   ProductFilterFetchPayload,
   ProductSaveDTO,
   ProductTributeByStatesUfPayload,
   ProductUpdatePayload,
   ProductsFetchPayload,
} from "./product-interfaces";
import ProductRepository from "./product-repository";
import StateRepository from "../state/state-repository";
import TagService from "../tag/tag-service";
import NotificationService from "../notification/notification-service";
import { SearchPayload } from "../global-interface";
import Global from "../../helpers/_globals";
import { EntityTagPayload } from "../tag/tag-interfaces";
import { linkTags } from "../../helpers/linkTags";
import DexdBoostRepository from "../dexdBoost/dexdBoost-repository";
import StoreRepository from "../store/store-repository";
import { Measurement } from "aws-sdk/clients/iotsitewise";
import MeasurementUnitRepository from "../measurementUnit/measurementUnit-repository";

export default class ProductService {
   private readonly productRepository: ProductRepository;
   private readonly stateRepository: StateRepository;
   private readonly storeRepository: StoreRepository;
   private readonly measurementRepository: MeasurementUnitRepository;
   private readonly dexdBoostRepository: DexdBoostRepository;
   private readonly tagsService: TagService;
   private readonly notificationService: NotificationService;
   private readonly _global: Global;

   constructor(public prismaClient: PrismaClient) {
      this.storeRepository = new StoreRepository(prismaClient);
      this.measurementRepository = new MeasurementUnitRepository(prismaClient);
      this.productRepository = new ProductRepository(prismaClient);
      this.stateRepository = new StateRepository(prismaClient);
      this.dexdBoostRepository = new DexdBoostRepository(prismaClient);
      this.tagsService = new TagService(prismaClient);
      this.notificationService = new NotificationService(prismaClient);
      this._global = new Global();
   }

   async fetchAll(params: ProductFetchPayload, payload: ProductsFetchPayload) {
      const products = await this.productRepository.all(params, payload);
      if (!products || products.length == 0) throw new NotFoundError("Nenhum produto encontrado");

      if (params.store) {
         const productResponse = products.map((product) => {
            const updatedProduct = {
               ...product,
               store: {
                  ...product.store,
                  user: {
                     ...product.store?.user,
                     password: undefined,
                     confirmationCode: undefined,
                  },
               },
            };

            return updatedProduct;
         });

         return { products: productResponse };
      }

      return { products };
   }

   async fetchById(id: number, relations: ProductFetchPayloadDTO, loggedUserId?: number) {
      const product = await this.productRepository.get(id, {
         include: {
            ...relations.include,
            _count: {
               select: {
                  views: true,
                  likes: {
                     where: {
                        like: true,
                     },
                  },
               },
            },
         },
      });
      if (!product) throw new NotFoundError("Produto não encontrado");
      const { _count, ...productResponse } = product;

      let userView = null;
      let liked = null;
      if (loggedUserId) {
         const like = await this.productRepository.findLikedProduct(id, loggedUserId);
         liked = like ? like.like : false;
         userView = await this.productRepository.view(id, loggedUserId);
      }

      if (relations.include?.store) {
         const storeResponse = {
            ...productResponse,
            store: {
               ...productResponse.store,
               user: {
                  ...productResponse.store?.user,
                  password: undefined,
                  confirmationCode: undefined,
               },
            },
            views: _count?.views ?? 0,
            viewed: userView ? true : false,
            isLiked: liked,
         };
         return { product: storeResponse };
      }

      return {
         product: { ...product, views: _count?.views ?? 0, viewed: userView ? true : false, isLiked: liked },
      };
   }

   async fetchRankingFilter(payload: SearchPayload, relations: ProductFetchPayloadDTO) {
      const { sort, ...searchRequest } = payload.search;
      const products = await this.productRepository.search(searchRequest, relations);
      if (products[0].length == 0) throw new NotFoundError("Não há arquitetos para exibir");

      const sortBy = payload.search && sort ? sort : "score";
      const productsRanked = await this.rankProducts(products[0], sortBy);

      const startSlice = ((payload.pagination?.page || 1) - 1) * (payload.pagination?.take || 10);
      const endSlice = startSlice + (payload.pagination?.take || 10);
      const slicedRanking = productsRanked.slice(startSlice, endSlice);

      if (relations.include?.store) {
         const productsResponse = slicedRanking.map((product) => {
            const user = {
               ...product.store?.user,
               password: undefined,
               confirmationCode: undefined,
            };
            return { ...product, user };
         });

         return { ranking: productsResponse };
      }

      return { ranking: slicedRanking };
   }

   async fetchByFilters(data: ProductFetchPayloadFilter, params: ProductFilterFetchPayload) {
      let productsReturn: (Product & ProductFetchPayloadFilterDTO)[] = [];
      const products = await this.productRepository.filter(data, params);
      if (products.length == 0) throw new NotFoundError(`Nenhum produto foi econtrado!`);

      if (!params.materials) {
         productsReturn = products.map(({ materials, ...product }) => ({
            ...product,
            materials: materials.length > 0,
         }));
      } else {
         productsReturn = products;
      }

      if (params.store) {
         const productsResponse = productsReturn.map((product) => {
            const productResponse = {
               ...product,
               store: {
                  ...product.store,
                  user: {
                     ...product?.store?.user,
                     password: undefined,
                     confirmationCode: undefined,
                  },
               },
            };

            return productResponse;
         });

         return { products: productsResponse };
      }

      return { products: productsReturn };
   }

   async fetchByOriginAndDestinyStates(payload: ProductTributeByStatesUfPayload) {
      const { originState, destinyState } = payload;

      const originStateData = await this.stateRepository.getByUfCode(originState);
      const destinyStateData = await this.stateRepository.getByUfCode(destinyState);

      if (!originStateData || !destinyStateData) {
         throw new NotFoundError("Estado não encontrado");
      }

      const tributeTax = await this.productRepository.getByOriginAndDestinyStates({
         originStateId: originStateData.id,
         destinyStateId: destinyStateData.id,
      });

      if (!tributeTax) throw new NotFoundError("Taxa de tributos não encontrada");

      return { tribute: tributeTax.tax };
   }

   async calculeRelevance(dexdPointsInvestido: any, precoProduto: any, cashBack: any) {
      // dexdpoints expira, cashback nao
      var recompensa = (precoProduto * (cashBack / 100)) / 0.025;
      return recompensa + dexdPointsInvestido;
   }

   async search(payload: SearchPayload, relations: ProductFetchPayloadDTO) {
      // Gerar filtros base
      const filters = this._global.generateFilters(payload);

      // Debug - mostrar estrutura do payload

      // Construir filtros adicionais
      const additionalFilters = this.buildAdditionalFilters(payload);

      // Processar filtros de tags se existirem no payload.search
      let tagsFilter = {};
      if (payload.search?.tags) {
         tagsFilter = this.buildTagsFilter(payload.search.tags);
      }

      // Combinar todos os filtros
      const combinedFilters = this.combineAllFilters(filters, additionalFilters, tagsFilter, payload);
      // Mesclar includes dos filtros com os relations
      const finalRelations = this.mergeIncludes(relations, combinedFilters.include);

      let products = null;
      if (combinedFilters.where && Object.keys(combinedFilters.where).length > 0) {
         products = await this.productRepository.search(combinedFilters, finalRelations);
      } else {
         products = await this.productRepository.search({ ...filters, where: {} }, finalRelations);
      }

      if (products && products[0].length == 0) throw new NotFoundError("Nenhum Produto foi encontrado!");

      // Aplicar ordenação personalizada
      if ("orderBy" in filters && filters.orderBy) {
         products[0] = await this.applyCustomSorting(products[0], filters.orderBy);
      }

      return {
         products: products[0],
         pages: Math.ceil(products[1] / (payload.pagination ? payload.pagination.take : 10)),
      };
   }

   private buildTagsFilter(tagsSearch: any): any {
      if (!tagsSearch) return {};

      // Se as tags vêm no formato: {"some": {"id": {"in": [152]}}}
      if (tagsSearch.some?.id?.in) {
         return {
            tags: {
               some: {
                  tagId: {
                     in: tagsSearch.some.id.in,
                  },
               },
            },
         };
      }

      // Se as tags vêm como array de IDs: [152, 153, 154]
      if (Array.isArray(tagsSearch)) {
         return {
            tags: {
               some: {
                  tagId: {
                     in: tagsSearch,
                  },
               },
            },
         };
      }

      // Se as tags vêm em outro formato, adapte conforme necessário
      return {};
   }

   // Método para mesclar includes dos filtros com os relations
   private mergeIncludes(relations: ProductFetchPayloadDTO, filterIncludes?: any): ProductFetchPayloadDTO {
      if (!filterIncludes || Object.keys(filterIncludes).length === 0) {
         return relations;
      }

      const mergedRelations: any = { ...relations };

      if (!mergedRelations.include) {
         mergedRelations.include = {};
      }

      // Mesclar includes dos filtros com os relations existentes
      Object.keys(filterIncludes).forEach((key) => {
         mergedRelations.include![key] = filterIncludes[key];
      });

      return mergedRelations;
   }

   // Método melhorado para combinar todos os filtros
   private combineAllFilters(baseFilters: any, additionalFilters: any, tagsFilter: any, payload: any): any {
      const combinedFilters = { ...baseFilters };

      // Inicializar include se não existir
      if (!combinedFilters.include) {
         combinedFilters.include = {};
      }

      // Começar com where limpo
      let finalWhere: any = {};

      // 1. Processar baseFilters.where (exceto OR)
      if (combinedFilters.where) {
         const { OR, ...baseWhereConditions } = combinedFilters.where;
         Object.assign(finalWhere, baseWhereConditions);

         // Se há OR no baseFilters, manter
         if (OR && Array.isArray(OR) && OR.length > 0) {
            finalWhere.OR = OR;
         }
      }

      // 2. Processar payload.search (exceto tags)
      if (payload.search) {
         const { tags, ...otherSearchFilters } = payload.search;

         if (Object.keys(otherSearchFilters).length > 0) {
            Object.assign(finalWhere, otherSearchFilters);
         }

         // Se há tags, garantir include
         if (tags) {
            combinedFilters.include.tags = true;
         }
      }

      // 3. Processar filtros de tags
      if (Object.keys(tagsFilter).length > 0) {
         Object.assign(finalWhere, tagsFilter);
         combinedFilters.include.tags = true;
      }

      // 4. Processar filtros adicionais
      if (additionalFilters) {
         const { OR, ...additionalWhereConditions } = additionalFilters;

         if (Object.keys(additionalWhereConditions).length > 0) {
            Object.assign(finalWhere, additionalWhereConditions);
         }

         // Se há OR nos filtros adicionais, combinar com OR existente
         if (OR && Array.isArray(OR) && OR.length > 0) {
            if (finalWhere.OR) {
               finalWhere.OR = [...finalWhere.OR, ...OR];
            } else {
               finalWhere.OR = OR;
            }
         }

         // Verificar filtros de tags adicionais
         if (additionalFilters.productTags || additionalFilters.tags) {
            combinedFilters.include.tags = true;
            if (additionalFilters.productTags) {
               combinedFilters.include.productTags = {
                  include: { tag: true },
               };
            }
         }
      }

      combinedFilters.where = finalWhere;
      delete combinedFilters.where.AND;
      return combinedFilters;
   }
   // Método para aplicar ordenação personalizada (extraído do código original)
   private async applyCustomSorting(products: any[], orderBy: any) {
      // Verificar se é ordenação por relevância (price + cashback)
      if (
         Array.isArray(orderBy) &&
         orderBy.some((item: any) => "price" in item) &&
         orderBy.some((item: any) => "cashback" in item)
      ) {
         // Calcular relevância para cada produto
         for await (let p of products) {
            if (p.dexdBoosts?.length) {
               const sumBoost = p.dexdBoosts.reduce((total: any, item: any) => total + item.investment, 0);
               const relevance = this.calculeRelevance(sumBoost, p.price, p.cashback);
               p = Object.assign(p, { relevance });
            } else {
               const relevance = 0;
               p = Object.assign(p, { relevance });
            }
         }
         return products.sort((a: any, b: any) => b.relevance - a.relevance);
      }
      // Verificar se é ordenação por createdAt
      else if (this.hasCreatedAtOrder(orderBy)) {
         const sortOrder = this.getCreatedAtSortOrder(orderBy);
         return products.sort((a: any, b: any) => {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();

            if (sortOrder === "desc") {
               return dateB - dateA; // Mais recente primeiro
            } else {
               return dateA - dateB; // Mais antigo primeiro
            }
         });
      }
      // Verificar se é ordenação por price
      else if (this.hasPriceOrder(orderBy)) {
         const sortOrder = this.getPriceSortOrder(orderBy);
         return products.sort((a: any, b: any) => {
            if (sortOrder === "desc") {
               return b.price - a.price; // Maior preço primeiro
            } else {
               return a.price - b.price; // Menor preço primeiro
            }
         });
      }

      return products;
   }
   // Métodos auxiliares para verificar e extrair ordenação
   private hasCreatedAtOrder(orderBy: any): boolean {
      if (Array.isArray(orderBy)) {
         return orderBy.some((item: any) => "createdAt" in item);
      }
      return typeof orderBy === "object" && "createdAt" in orderBy;
   }

   private getCreatedAtSortOrder(orderBy: any): "asc" | "desc" {
      if (Array.isArray(orderBy)) {
         const createdAtOrder = orderBy.find((item: any) => "createdAt" in item);
         return createdAtOrder?.createdAt || "desc";
      }
      return orderBy.createdAt || "desc";
   }

   private hasPriceOrder(orderBy: any): boolean {
      if (Array.isArray(orderBy)) {
         return orderBy.some((item: any) => "price" in item);
      }
      return typeof orderBy === "object" && "price" in orderBy;
   }

   private getPriceSortOrder(orderBy: any): "asc" | "desc" {
      if (Array.isArray(orderBy)) {
         const priceOrder = orderBy.find((item: any) => "price" in item);
         return priceOrder?.price || "desc";
      }
      return orderBy.price || "desc";
   }

   // Método para construir filtros adicionais (preço, texto, tags)
   private buildAdditionalFilters(payload: any): any {
      const additionalFilters: any = {};

      // Filtro de preço
      if (payload.filters?.price) {
         additionalFilters.price = {};

         if (payload.filters.price.min !== undefined) {
            additionalFilters.price.gte = payload.filters.price.min;
         }

         if (payload.filters.price.max !== undefined) {
            additionalFilters.price.lte = payload.filters.price.max;
         }
      }

      // Busca por texto (nome, descrição)
      if (payload.filters?.search && payload.filters.search.trim()) {
         const searchTerm = payload.filters.search.trim();
         additionalFilters.OR = [
            {
               name: {
                  contains: searchTerm,
               },
            },
            {
               description: {
                  contains: searchTerm,
               },
            },
            {
               store: {
                  name: {
                     contains: searchTerm,
                  },
               },
            },
         ];
      }

      // Filtro por tags
      if (payload.filters?.tags && payload.filters.tags.length > 0) {
         additionalFilters.productTags = {
            some: {
               tag: {
                  id: {
                     in: payload.filters.tags,
                  },
               },
            },
         };
      }

      // Filtro por categoria
      if (payload.filters?.categoryId) {
         additionalFilters.categoryId = payload.filters.categoryId;
      }

      // Filtro por status (ativo/inativo)
      if (payload.filters?.status !== undefined) {
         additionalFilters.status = payload.filters.status;
      }

      // Filtro por disponibilidade
      if (payload.filters?.available !== undefined) {
         additionalFilters.available = payload.filters.available;
      }

      return additionalFilters;
   }

   // Método para combinar todos os filtros preservando os existentes
   private combineFilters(baseFilters: any, mappedFilters: any[], additionalFilters: any): any {
      const combinedFilters = { ...baseFilters };

      // Inicializar where se não existir
      if (!combinedFilters.where) {
         combinedFilters.where = {};
      }

      // Separar condições OR dos filtros adicionais
      const additionalOrConditions = additionalFilters.OR || [];
      const additionalWhereConditions = { ...additionalFilters };
      delete additionalWhereConditions.OR;

      // Coletar todas as condições OR existentes
      let allOrConditions: any = [];

      // OR do baseFilters (gerado pelo generateFilters)
      if (combinedFilters.where.OR) {
         allOrConditions = [...combinedFilters.where.OR];
      }

      // OR dos mappedFilters (tags do sistema)
      if (mappedFilters.length > 0) {
         allOrConditions = [...allOrConditions, ...mappedFilters];
      }

      // OR dos additionalFilters (busca por texto)
      if (additionalOrConditions.length > 0) {
         allOrConditions = [...allOrConditions, ...additionalOrConditions];
      }

      // Construir o where final
      const finalWhere: any = {};

      // Adicionar condições simples (não OR) dos filtros base
      Object.keys(combinedFilters.where).forEach((key) => {
         if (key !== "OR") {
            finalWhere[key] = combinedFilters.where[key];
         }
      });

      // Adicionar condições simples dos filtros adicionais
      Object.keys(additionalWhereConditions).forEach((key) => {
         finalWhere[key] = additionalWhereConditions[key];
      });

      // Se temos condições OR, decidir como estruturar
      if (allOrConditions.length > 0) {
         if (Object.keys(finalWhere).length > 0) {
            // Temos tanto condições AND quanto OR, usar estrutura AND
            finalWhere.AND = [
               { OR: allOrConditions },
               ...Object.keys(finalWhere)
                  .filter((key) => key !== "AND")
                  .map((key) => {
                     const condition = { [key]: finalWhere[key] };
                     delete finalWhere[key]; // Remove para não duplicar
                     return condition;
                  }),
            ];
         } else {
            // Apenas condições OR
            finalWhere.OR = allOrConditions;
         }
      }

      combinedFilters.where = finalWhere;
      return combinedFilters;
   }
   async store(
      payload: ProductSaveDTO & EntityTagPayload,
      user?: User & {
         userSubscription: UserSubscription & { subscription: Subscription };
      }
   ) {
      if (!user) throw new AuthenticationError("Usuário não autenticado");

      let { tags, ...payloadResponse } = payload;
      const photoPerProjectLimit = user?.userSubscription?.subscription.photoPerProject || 3;

      // if (payload.medias.length > photoPerProjectLimit) {
      //    throw new ForbiddenError(
      //       `Seu plano não permite mais de ${photoPerProjectLimit}\n
      //   fotos por projeto`
      //    );
      // }

      const store = await this.storeRepository.get(payloadResponse.storeId, {});
      const measurement = await this.measurementRepository.get(payloadResponse.measurementUnitId);

      // if (!store || store.type != "store") {
      //    delete (payloadResponse as any).storeId;
      //    delete (payloadResponse as any).measurementUnitId;
      // }

      const product: any = await this.productRepository.save(payloadResponse);

      console.info("📦 [Product Service]: Product medias created:", product?.medias);

      if (tags) {
         const tagsToLink = tags.map((tagId) => {
            return {
               id: tagId,
               type: "interest",
            };
         });

         await this.tagsService.linkTags(product.id, "product", tagsToLink, "incorporation");
      }

      // Criar notificações baseadas em tags de interesse
      if (tags && tags.length > 0) {
         try {
            await this.notificationService.createTagBasedNotifications(
               tags,
               user.id,
               "product",
               product.id,
               product.name
            );
         } catch (error) {
            console.error("❌ [Product Service]: Error creating notifications:", error);
         }
      }

      return { product };
   }

   async like(id: number, user: User) {
      const environment = await this.productRepository.like(id, user.id);
      return { environment };
   }

   async update(
      id: number,
      payload: ProductUpdatePayload & EntityTagPayload,
      user?: User & {
         userSubscription: UserSubscription & { subscription: Subscription };
      }
   ) {
      if (!user) throw new AuthenticationError("Usuário não autenticado");

      const { tags, ...payloadResponse } = payload;
      const photoPerProjectLimit = user.userSubscription.subscription.photoPerProject || 3;

      // if (payload.medias) {
      //    if (payload.medias.length > photoPerProjectLimit) {
      //       throw new ForbiddenError(
      //          `Seu plano não permite mais de ${photoPerProjectLimit}\n
      //     fotos por projeto`
      //       );
      //    }
      // }

      // Só resetar medias se realmente tiver novas medias no payload
      // Caso contrário, mantém as existentes para não perder as imagens
      const resetMedias = payload.medias && payload.medias.length > 0;
      const resetMaterials = payload.materials && payload.materials.length > 0;
      
      const product = await this.productRepository.update(id, payloadResponse, true, resetMedias, resetMaterials);

      if (tags) {
         const tagsToLink = tags.map((tagId) => {
            return {
               id: tagId,
               type: "interest",
            };
         });
         await linkTags(tagsToLink, product.id, "product");
      }

      return { product };
   }

   async destroy(id: number) {
      const product = await this.productRepository.delete(id);
      return { product };
   }

   public async rankProducts(products: Array<Product & ProductFetchResponseDTO>, sortBy: string) {
      const rankedProductsMapped = products.map(async (product) => {
         let totalUserViews = product.productProfile || 0;
         let score = 0;

         const productDexdBoosts = await this.dexdBoostRepository.latestPoints(product.id, "product");
         score = productDexdBoosts._sum.investment ?? 0;

         return {
            ...product,
            likes: product.likes?.length || 0,
            visualizations: totalUserViews,
            score,
         };
      });

      const rankedProductResolved = await Promise.all(rankedProductsMapped);

      const ranking = rankedProductResolved.sort((current, previous) => {
         return ((previous as any)[sortBy] || 0) - ((current as any)[sortBy] || 0);
      });

      return ranking;
   }
}
