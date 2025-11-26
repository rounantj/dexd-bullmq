import {
   Architect,
   User,
   Environment,
   Address,
   Environment_Likes,
   Store,
   Product,
   ProductLikes,
   EnvironmentServiceProviderStore,
} from "@prisma/client";
import { SearchDatabase, SearchPayload } from "../modules/global-interface";
import {
   EnvironmentFetchAllResponseDTO,
   EnvironmentFetchResponseDTO,
} from "../modules/environment/environment-interfaces";

// Error classes
export class AuthenticationError extends Error {
   public statusCode: number;
   constructor(message: string) {
      super(message);
      this.name = "AuthenticationError";
      this.statusCode = 401;
   }
}

export class ForbiddenError extends Error {
   public statusCode: number;
   constructor(message: string) {
      super(message);
      this.name = "ForbiddenError";
      this.statusCode = 403;
   }
}

export class NotFoundError extends Error {
   public statusCode: number;
   constructor(message: string) {
      super(message);
      this.name = "NotFoundError";
      this.statusCode = 404;
   }
}

export default class Global {
   public convertParamsRelations(query: string | undefined) {
      const relations = query?.split(",");

      if (!relations || relations.length == 0) return {};

      let params = {};

      relations.forEach((relation) => {
         params = { ...params, [relation]: true };
      });

      return params;
   }

   public includeParamsRelations(query: string | undefined) {
      const relations = query?.split(",");

      if (!relations || relations.length === 0) return {};

      let params = {};
      const userOmit = {
         id: true,
         email: true,
         name: true,
         surname: true,
         password: false,
         confirmationCode: false,
         identification: true,
         professionalIdentification: true,
         professionalIdentificationType: true,
         description: true,
         cellphone: true,
         isCellphoneValidated: true,
         phone: true,
         profilePicture: true,
         socialMedia: true,
         birthDate: true,
         walletId: true,
         customerId: true,
         referralCode: true,
         indicationCode: true,
         requestDelete: true,
         addressId: true,
         languageId: true,
         roleId: true,
         createdAt: true,
         updatedAt: true,
         deletedAt: true,
      };

      relations.forEach((relation) => {
         if (["user", "userOpportunity"].includes(relation)) {
            params = {
               ...params,
               [relation]: {
                  select: { ...userOmit },
               },
            };
         } else if (relation.includes(".")) {
            const linkedRelations = relation.split(".");

            if (linkedRelations[1].includes("*")) {
               // ! O formato pode vir desta maneira user.city*state
               const nestedRelations = linkedRelations[1].split("*");
               let include = {};

               nestedRelations.forEach((nestedRelation) => {
                  // ! O trecho pode repetir mais de 2 vezes, então com esse foreach ele vai formatar no formato do objeto que o prisma precisa
                  // ! Por exemplo: {city: true, state: true}
                  include = {
                     ...include,
                     [nestedRelation]: true,
                  };
               });

               params = {
                  ...params,
                  [linkedRelations[0]]: {
                     include,
                  },
               };
            } else {
               if (["user", "userOpportunity"].includes(linkedRelations[0])) {
                  params = {
                     ...params,
                     [linkedRelations[0]]: {
                        select: {
                           ...userOmit,
                           [linkedRelations[1]]: true,
                        },
                     },
                  };
               } else {
                  params = {
                     ...params,
                     [linkedRelations[0]]: {
                        include: {
                           [linkedRelations[1]]: true,
                        },
                     },
                  };
               }
            }
         } else {
            params = { ...params, [relation]: true };
         }
      });

      return { include: params };
   }

   public weekRangeBetween(date: Date = new Date()) {
      const currentDayOfWeek = date.getDay();
      const daysToSubtract = currentDayOfWeek === 0 ? 7 : currentDayOfWeek;
      const mondayOfWeek = new Date(new Date(date).setUTCHours(0, 0, 0, 0));
      mondayOfWeek.setDate(date.getDate() - daysToSubtract);
      const sundayOfWeek = new Date(new Date(mondayOfWeek).setUTCHours(23, 59, 59, 999));
      sundayOfWeek.setDate(mondayOfWeek.getDate() + 7);

      return { mondayOfWeek, sundayOfWeek };
   }

   public environmentSort(data: Array<Partial<Environment> & EnvironmentFetchResponseDTO>) {
      data.sort((previous, current) => {
         const likesPrevious = previous._count?.likes || 0;
         const likesCurrent = current._count?.likes || 0;
         const viewsPrevious = previous._count?.environmentProfile || 0;
         const viewsCurrent = current._count?.environmentProfile || 0;

         const sumPrevious = likesPrevious + viewsPrevious;
         const sumCurrent = likesCurrent + viewsCurrent;

         return sumCurrent - sumPrevious;
      });

      return data;
   }

   public async rankingAllArchitectsMap(
      data: Array<
         Architect & {
            user?: User & { address?: Address };
            projects?: (Environment & EnvironmentFetchResponseDTO)[];
         }
      >
   ) {
      const rankedArchitects = data.map((architect) => {
         let totalEnvironments = 0;
         let totalLikes = 0;
         let totalViews = 0;

         if (architect.projects) {
            totalEnvironments = architect.projects.length;
            architect.projects.forEach((project) => {
               if (project.likes) totalLikes += project.likes.length;
               totalViews += project._count?.environmentProfile || 0;
            });
         }

         return {
            ...architect,
            projectsCount: totalEnvironments,
            likesCount: totalLikes,
            visualizationsCount: totalViews,
            score: totalEnvironments + totalLikes + totalViews + architect.visualizations,
         };
      });

      const ranking = rankedArchitects.sort((current, previous) => {
         return previous.score - current.score;
      });

      return ranking;
   }

   public async rankingArchitectMap(
      data: Array<
         Architect & {
            user?: User & { address?: Address };
            projects?: (Environment & EnvironmentFetchResponseDTO)[];
         }
      >
   ) {
      const rankedArchitects = data.map((architect) => {
         let totalEnvironments = 0;
         let totalLikes = 0;
         let totalViews = 0;

         if (architect.projects) {
            totalEnvironments = architect.projects.length;
            architect.projects.forEach((project) => {
               if (project.likes) totalLikes += project.likes.length;
               totalViews += project._count?.environmentProfile || 0;
            });

            architect.projects.sort((previous, current) => {
               const likesPrevious = previous.likes ? previous.likes.length : 0;
               const likesCurrent = current.likes ? current.likes.length : 0;
               const viewsPrevious = previous._count?.environmentProfile || 0;
               const viewsCurrent = current._count?.environmentProfile || 0;

               const sumPrevious = likesPrevious + viewsPrevious;
               const sumCurrent = likesCurrent + viewsCurrent;

               return sumCurrent - sumPrevious;
            });
         }

         return {
            ...architect,
            projectsCount: totalEnvironments,
            likesCount: totalLikes,
            visualizationsCount: totalViews,
            score: totalEnvironments + totalLikes + totalViews + architect.visualizations,
         };
      });

      const ranking = rankedArchitects.sort((current, previous) => {
         return previous.score - current.score;
      });

      return ranking;
   }

   public async rankingAllStoresMap(
      data: Array<
         Store & {
            user?: User & { address?: Address };
            products?: (Product & { likes?: ProductLikes[] })[];
            serviceProviders?: (EnvironmentServiceProviderStore & {
               environment: Environment & { likes: Environment_Likes[] };
            })[];
         }
      >
   ) {
      const rankedStores = data.map((store) => {
         let totalProducts = 0;
         let totalLikes = 0;
         const totalServiceProviders = store.serviceProviders ? store.serviceProviders.length : 0;

         if (store.products) {
            totalProducts = store.products.length;
            store.products.forEach((project) => {
               if (project.likes) totalLikes += project.likes.length;
            });
         }

         return {
            ...store,
            productsCount: totalProducts,
            likesCount: totalLikes,
            score: totalProducts + totalLikes + totalServiceProviders + store.visualizations,
         };
      });

      const ranking = rankedStores.sort((current, previous) => {
         return previous.score - current.score;
      });

      return ranking;
   }

   public async rankingStoreMap(
      data: Array<
         Store & {
            user?: User & { address?: Address };
            products?: (Product & { likes?: ProductLikes[] })[];
            serviceProviders?: (EnvironmentServiceProviderStore & {
               environment: Environment & EnvironmentFetchResponseDTO;
            })[];
         }
      >
   ) {
      const rankedStores = data.map((store) => {
         let totalProducts = 0;
         let totalProjects = 0;
         let totalLikes = 0;
         const totalServiceProviders = store.serviceProviders ? store.serviceProviders.length : 0;

         if (store.products) {
            totalProducts = store.products.length;
            store.products.forEach((product) => {
               if (product.likes) totalLikes += product.likes.length;
            });

            store.products.sort((previous, current) => {
               const likesPrevious = previous.likes ? previous.likes.length : 0;
               const likesCurrent = current.likes ? current.likes.length : 0;

               return likesCurrent - likesPrevious;
            });
         }

         if (store.serviceProviders) {
            totalProjects = store.serviceProviders.length;
            store.serviceProviders.forEach((serviceProvider) => {
               if (serviceProvider.environment.likes) totalLikes += serviceProvider.environment.likes.length;
            });

            store.serviceProviders.sort((previous, current) => {
               const likesPrevious = previous.environment.likes ? previous.environment.likes.length : 0;
               const likesCurrent = current.environment.likes ? current.environment.likes.length : 0;
               const viewsPrevious = previous.environment._count?.environmentProfile || 0;
               const viewsCurrent = current.environment._count?.environmentProfile || 0;

               const sumPrevious = likesPrevious + viewsPrevious;
               const sumCurrent = likesCurrent + viewsCurrent;

               return sumCurrent - sumPrevious;
            });
         }

         return {
            ...store,
            productsCount: totalProducts,
            projectsCount: totalProjects,
            likesCount: totalLikes,
            score: totalProducts + totalLikes + totalServiceProviders + store.visualizations,
         };
      });

      const ranking = rankedStores.sort((current, previous) => {
         return previous.score - current.score;
      });

      return ranking;
   }

   public generateFilters(payload: SearchPayload): SearchDatabase {
      let params: any = {};
      let search = null;

      // Processar filtros de busca (search)
      if (payload.search) {
         let searchKey = {};
         const searchObject = Object.keys(payload.search)
            .filter((key) => key != "startDate" && key != "endDate")
            .map((key) => {
               let searchKeyFormatted: string | undefined = undefined;
               if (payload.options?.search === "equals") {
                  search = (payload.search as any)[key];
               } else {
                  search = { contains: (payload.search as any)[key] };
               }

               // Verifica se o último caractere é dígito para receber múltiplos indexes iguais
               if (/^\d+(?:\.\d+)?$/.test(key.charAt(key.length - 1))) {
                  searchKeyFormatted = key.slice(0, -1);
               }

               if (typeof (payload.search as any)[key] !== "string") {
                  if (key.includes(".")) {
                     const linkedKeys = key.split(".");
                     searchKey = this.generateSearchKey(linkedKeys, searchKeyFormatted, key, payload.search);
                  } else {
                     searchKey = {
                        [searchKeyFormatted || key]: (payload.search as any)[key],
                     };
                  }
               } else {
                  if (key.includes(".")) {
                     const linkedKeys = key.split(".");
                     searchKey = this.generateSearchKey(linkedKeys, searchKeyFormatted, key, payload.search);
                  } else {
                     searchKey = {
                        [searchKeyFormatted || key]: search,
                     };
                  }
               }

               return searchKey;
            });

         if (searchObject.length) {
            params.where = { [payload.options?.filter || "OR"]: searchObject };
         }
      }

      // Processar ordenação (orderBy e sort)
      let orderBy: any[] = [];

      // Processar payload.sort (sistema existente)
      if (payload.sort) {
         const sortFields = Object.keys(payload.sort);

         if (sortFields.length > 0) {
            const sortOrderBy = sortFields.map((field) => {
               if (field.includes(".")) {
                  const nestedFields = field.split(".").reverse();
                  let nestedObject = { [nestedFields[0]]: (payload.sort as any)[field] };

                  nestedFields.slice(1).forEach((nestedField) => {
                     nestedObject = { [nestedField]: nestedObject };
                  });

                  return nestedObject;
               } else {
                  return { [field]: (payload.sort as any)[field] };
               }
            });

            orderBy = [...orderBy, ...sortOrderBy];
         }
      }

      // Processar payload.orderBy (sistema novo)
      if (payload.orderBy) {
         if (Array.isArray(payload.orderBy)) {
            // Se orderBy for um array, adicionar todos os elementos
            orderBy = [...orderBy, ...payload.orderBy];
         } else if (typeof payload.orderBy === "object") {
            // Se orderBy for um objeto, converter para array e adicionar
            const orderByFields = Object.keys(payload.orderBy).map((field) => {
               if (field.includes(".")) {
                  const nestedFields = field.split(".").reverse();
                  let nestedObject = { [nestedFields[0]]: payload.orderBy[field] };

                  nestedFields.slice(1).forEach((nestedField) => {
                     nestedObject = { [nestedField]: nestedObject };
                  });

                  return nestedObject;
               } else {
                  return { [field]: payload.orderBy[field] };
               }
            });

            orderBy = [...orderBy, ...orderByFields];
         }
      }

      // Adicionar orderBy aos parâmetros se houver algum
      if (orderBy.length > 0) {
         params.orderBy = orderBy.length === 1 ? orderBy[0] : orderBy;
      }

      // Processar paginação
      if (payload.pagination) {
         params.take = payload.pagination.take;
         params.skip = payload.pagination.take * (payload.pagination.page - 1);
      }

      return params;
   }

   private generateSearchKey(
      linkedKeys: Array<string>,
      searchKeyFormatted: string | undefined,
      key: string,
      search: Object
   ) {
      return {
         [linkedKeys[0]]: {
            [linkedKeys[1]]: linkedKeys[2]
               ? {
                    [searchKeyFormatted || linkedKeys[2]]: (search as any)[key],
                 }
               : (search as any)[key],
         },
      };
   }

   public generateTagsFilter(filters: SearchDatabase) {
      const mappedFilters: Array<Object> = [];
      let hasTagFilter = false;

      filters.where?.OR?.forEach((filter) => {
         if (filter.hasOwnProperty("tags") && !hasTagFilter) {
            mappedFilters.push({
               tags: {
                  some: {
                     OR: (filter as { tags: number[] }).tags.map((filterUnit) => {
                        return { tagId: filterUnit };
                     }),
                  },
               },
            });
            hasTagFilter = true;
         } else if (!filter.hasOwnProperty("tags")) {
            mappedFilters.push(filter);
         }
      });

      return mappedFilters;
   }
}
