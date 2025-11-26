import { Entity_Tag, Entity_TagPayload, PrismaClient, TagCategory, TagCategoryEntity, User } from "@prisma/client";
import { AuthenticationError, BadRequestError, NotFoundError } from "@pullup.tech/cms";
import { roles } from "../../helpers/roles";
import UserRepository from "../user/user-repository";
import {
   TagSavePayload,
   UserEntityDTO,
   TagBatchPayload,
   TagFetchPayload,
   TagUpdatePayload,
   TagLinkSavePayload,
   TagSavePayloadDTO,
   TagSearchAdvancedPayload,
   TagStatsPayload,
} from "./tag-interfaces";
import TagRepository from "./tag-repository";
import TagCategoryRepository from "../tagCategory/tagCategory-repository";
import Global from "../../helpers/_globals";
import { SearchPayload } from "../global-interface";
import { autoCategorizeTag } from "../../helpers/autoCategorizeTag";

export default class TagService {
   private readonly tagRepository: TagRepository;
   private readonly client: PrismaClient;
   private readonly tagCategoryRepository: TagCategoryRepository;
   private readonly userRepository: UserRepository;
   private readonly _global: Global;

   constructor(public prismaClient: PrismaClient) {
      this.tagRepository = new TagRepository(prismaClient);
      this.tagCategoryRepository = new TagCategoryRepository(prismaClient);
      this.userRepository = new UserRepository(prismaClient);
      this._global = new Global();
      this.client = prismaClient;
   }

   async fetchAll() {
      const tags = await this.tagRepository.all();
      // Mapear para garantir compatibilidade com front-end
      const tagsMapped = tags.map((tag: any) => ({
         ...tag,
         // Manter subCategory (string) para compatibilidade, usando nome da subcategoria
         subCategory: tag.subcategory?.name || tag.subCategory || null,
      }));
      return { tags: tagsMapped };
   }

   async searchTagsEntities(payload: SearchPayload) {
      const filters = this._global.generateFilters(payload);
      const tags = await this.tagRepository.searchTagsEntities(filters);

      if (!tags || !tags.length) throw new NotFoundError("Nenhuma Tag foi encontrada!");

      return { tags };
   }

   async searchTagsByEntities(payload: SearchPayload) {
      const filters = this._global.generateFilters(payload);
      const entityTag = await this.tagRepository.searchTagsByEntities(filters);

      if (!entityTag || !entityTag.categoryEntities) throw new NotFoundError("Nenhuma Tag foi encontrada!");

      const entityTagsMapped = entityTag.categoryEntities.map(
         (categoryEntity: TagCategoryEntity & { tagCategory?: TagCategory }) => categoryEntity.tagCategory
      );

      return { tags: entityTagsMapped };
   }

   async searchTagsByEntity(id: number, userId?: number) {
      const subCategories = await this.tagRepository.searchTagsByEntity(id, userId);
      if (!subCategories) throw new NotFoundError("Tag não encontrada.");

      const subCategoriesMapped = subCategories.map((subCategory: { subCategory: string }) => subCategory.subCategory);
      return { subCategories: subCategoriesMapped };
   }

   async searchTags(payload: SearchPayload, relations: TagFetchPayload) {
      const filters = this._global.generateFilters(payload);

      const tags = await this.tagRepository.searchTags(filters, relations, payload.bringAllRecords);

      if (tags && tags[0].length == 0) throw new NotFoundError("Nenhuma Categoria de tag foi encontrada!");

      // Mapear para garantir compatibilidade com front-end
      const tagsMapped = tags[0].map((tag: any) => ({
         ...tag,
         // Manter subCategory (string) para compatibilidade, usando nome da subcategoria
         subCategory: tag.subcategory?.name || tag.subCategory || null,
      }));

      return {
         tags: tagsMapped,
         pages: Math.ceil(tags[1] / (payload.pagination ? payload.pagination.take : 10)),
      };
   }

   async search(
      payload: SearchPayload,
      relations: TagFetchPayload,
      type: string,
      userId?: number,
      isUser?: boolean,
      role?: string
   ) {
      const filters = this._global.generateFilters(payload);

      let tags = null;
      if (userId) {
         const dbUser = await this.userRepository.get(userId, {
            include: { role: true },
         });

         tags = await this.tagRepository.search(filters, relations, dbUser, type, isUser, role);
      } else {
         tags = await this.tagRepository.search(filters, relations, null, type, null, role);
      }

      if (tags && tags[0].length == 0) throw new NotFoundError("Nenhuma Tag foi encontrada!");

      // Mapear para garantir compatibilidade com front-end
      const tagsMapped = tags[0].map((tag: any) => ({
         ...tag,
         // Manter subCategory (string) para compatibilidade, usando nome da subcategoria
         subCategory: tag.subcategory?.name || tag.subCategory || null,
      }));

      return {
         tags: tagsMapped,
         pages: Math.ceil(tags[1] / (payload.pagination ? payload.pagination.take : 10)),
      };
   }

   async fetchById(id: number) {
      const tag = await this.tagRepository.get(id);
      if (!tag) throw new NotFoundError("Tag não encontrada.");

      return { tag };
   }

   async store(
      payload: TagSavePayload,
      userId: number,
      productId?: number,
      environmentId?: number,
      postId?: number,
      dexdTvVideoId?: number,
      opportunityId?: number
   ) {
      console.log("🔍 TagService.store - Payload recebido:", payload);
      console.log("🔍 TagService.store - UserId:", userId);

      let { category, type, ...payloadRequest } = payload;
      if (!payloadRequest.categoryId) {
         payloadRequest.categoryId = await autoCategorizeTag(payload.name);
      }
      if (category && category == "usuário") {
         let userCategory = await this.tagCategoryRepository.getByName(category);
         if (!userCategory) {
            userCategory = await this.tagCategoryRepository.save({ name: category }, []);
         }
         payloadRequest = { ...payloadRequest, categoryId: userCategory.id };
      }

      // Se temos tagId, usar diretamente
      if (payload.tagId) {
         console.log("🔍 TagService.store - Usando tagId existente:", payload.tagId);
         // Buscar a tag diretamente pelo ID
         const tagToUse = await this.client.tag.findUnique({
            where: { id: payload.tagId },
            include: { category: true },
         });
         if (tagToUse) {
            console.log("🔍 TagService.store - Tag encontrada:", tagToUse);
            await this.tagRepository.upsertEntityTag(tagToUse.id, { userId, type });
            console.log("🔍 TagService.store - Entity tag criada com sucesso");
            return { tag: tagToUse };
         } else {
            console.log("🔍 TagService.store - Tag não encontrada com ID:", payload.tagId);
         }
      }

      const foundTag = await this.tagRepository.getByName(payload.name, {});

      let tag = { id: 0 };
      if (!foundTag) {
         tag = await this.tagRepository.save(payloadRequest);
      }

      const tagToUse = foundTag || tag;
      console.log("🔍 TagService.store - Tag final a usar:", tagToUse);
      await this.tagRepository.upsertEntityTag(tagToUse.id, { userId, type });
      console.log("🔍 TagService.store - Entity tag criada com sucesso");

      return { tag: tagToUse };
   }

   async storeEntity(
      payload: TagSavePayload,
      userId: number,
      productId?: number,
      environmentId?: number,
      postId?: number,
      dexdTvVideoId?: number,
      opportunityId?: number
   ) {
      let { category, type, ...payloadRequest } = payload;
      if (!payloadRequest.categoryId) {
         payloadRequest.categoryId = await autoCategorizeTag(payload.name);
      }
      if (category && category == "usuário") {
         let userCategory = await this.tagCategoryRepository.getByName(category);
         if (!userCategory) {
            userCategory = await this.tagCategoryRepository.save({ name: category }, []);
         }
         payloadRequest = { ...payloadRequest, categoryId: userCategory.id };
      }
      const foundTag = await this.tagRepository.getByName(payload.name, {});

      let tag = { id: 0 };
      if (!foundTag) {
         tag = await this.tagRepository.save(payloadRequest);
      }

      const tagToUse = foundTag || tag;
      await this.tagRepository.upsertEntityTag(tagToUse.id, {
         userId,
         type,
         productId,
         environmentId,
         postId,
         dexdTvVideoId,
         opportunityId,
      });

      return { tag: tagToUse };
   }

   async storeUserTags(payload: { id: number; checked: boolean; type: string }[], userId: number) {
      let tagsToFilter = [];

      for (const tag of payload) {
         const hasTag = await this.tagRepository.getUserTag(tag.id, userId);

         if (tag.checked && !hasTag) {
            tagsToFilter.push({ id: tag.id, checked: tag.checked, type: tag.type });
         }
      }

      const tagsToSave = tagsToFilter.map((tag) => {
         return {
            userId,
            tagId: tag.id,
            type: tag.type,
         };
      });
      const tagsToDelete = payload
         .filter((tag) => !tag.checked)
         .map((tag) => {
            return {
               userId,
               tagId: tag.id,
            };
         });

      await this.tagRepository.batchRemove(tagsToDelete);
      await this.tagRepository.batchLink(tagsToSave);

      return { message: "Tags atualizadas com sucesso!" };
   }

   async linkTags(
      entityId: number,
      entityType: string,
      tags: { id: number; type: string | null }[],
      type?: string
   ): Promise<void> {
      let entitiesToUpdate: Array<Entity_Tag> = [];
      let tagsToLink: TagLinkSavePayload[] = [];
      // create new tags if they don't exists
      // await this.tagRepository.batchCreate(payload);

      // list all tags chosen on database
      // const allTags = await this.tagRepository.listFiltered(payload);

      let newTagLock = 0;
      for (let tag of tags) {
         newTagLock += 1;
         let processedType: string | null = null;

         if (type) {
            let tagEntity = await this.tagRepository.searchEntities({
               where: {
                  AND: [{ [`${entityType}Id`]: entityId }, { tagId: tag.id }],
               },
            });

            if (tagEntity && newTagLock <= 1) {
               if (![tagEntity.type].includes(type)) {
                  processedType = `${tagEntity.type}/${type}`;
               } else {
                  processedType = tag.type || type;
               }

               // entitiesToUpdate = [...entitiesToUpdate, { ...tagEntity, type: processedType }];
               await this.tagRepository.updateEntity(tagEntity.id, {
                  type: processedType,
                  visualizations: tagEntity.visualizations + 1,
               });
            } else {
               processedType = type;
            }

            tagsToLink.push({
               tagId: tag.id,
               type: processedType,
               [`${entityType}Id`]: entityId,
            });
         } else {
            tagsToLink.push({
               tagId: tag.id,
               type: processedType,
               [`${entityType}Id`]: entityId,
            });
         }
      }

      await this.tagRepository.deleteByEntity({ [`${entityType}Id`]: entityId });
      await this.tagRepository.batchLink(tagsToLink);

      // for (let entity of entitiesToUpdate) {
      //    await this.tagRepository.updateEntity(entity.id, entity);
      // }
   }

   async batch(payload: TagBatchPayload) {
      const user = await this.userRepository.get(payload.userId, {
         include: { role: true },
      });
      if (!user) throw new NotFoundError("Usuário Inválido!");

      const nonExistingTags = payload.tags.filter(async (tag) => {
         const existingTag = await this.tagRepository.getByName(tag.name, {});

         return !existingTag;
      });

      const resolvedExistingTags = await Promise.all(nonExistingTags);

      const mappedExistingTags = resolvedExistingTags.map(({ name, categoryId, subCategory }) => ({
         name,
         categoryId,
         subCategory,
      }));

      let updatedTags = await this.tagRepository.findManyByName(mappedExistingTags);

      if (updatedTags.length == 0) {
         await this.tagRepository.batchCreate(mappedExistingTags);
      }

      updatedTags = await this.tagRepository.findManyByName(mappedExistingTags);

      if ([roles.superAdmin, roles.admin].includes(user.role!.name)) {
         user.role!.name = roles.user;
      }

      for (const updatedTag of updatedTags) {
         await this.tagRepository.upsertEntityTag(updatedTag.id, {
            userId: user.id,
         });
      }

      return { message: "Tags registradas com sucesso" };
   }

   async update(id: number, data: TagUpdatePayload) {
      const tag = await this.tagRepository.update(id, data);
      return { tag };
   }

   async upsertTagEntity(id: number, user: UserEntityDTO) {
      if ([roles.superAdmin, roles.admin].includes(user.role.name)) user.role.name = roles.user;
      const tag = await this.tagRepository.upsertEntityTag(id, {
         userId: user.id,
      });
      return { tag };
   }

   async findEntity(tagId: number, userId: number) {
      const tag = await this.tagRepository.findEntityTag(tagId, userId);
      return { tag };
   }

   async batchUnlink(data: number[]) {
      const tag = await this.tagRepository.batchUnlink(data);
      return { tag };
   }

   async unlinkTag(tagId: number, userId: number, type: string) {
      const tag = await this.tagRepository.unlink(tagId, userId, type);
      return { tag };
   }

   async destroy(id: number) {
      const tag = await this.tagRepository.delete(id);
      return { tag };
   }

   // New CRUD Operations
   async moveTagToCategory(tagId: number, newCategoryId: number) {
      const tag = await this.tagRepository.update(tagId, { categoryId: newCategoryId });
      return { tag };
   }

   async getTagStats() {
      try {
         // Buscar todas as categorias
         const categories = await this.client.tagCategory.findMany({
            include: {
               subcategories: true,
            },
         });

         // Contar tags por categoria
         const categoryStats = await Promise.all(
            categories.map(async (category) => {
               const count = await this.client.tag.count({
                  where: {
                     categoryId: category.id,
                  },
               });

               // Contar tags por subcategoria
               const subcategoriesWithCount = await Promise.all(
                  (category.subcategories || []).map(async (subcategory) => {
                     const subCount = await this.client.tag.count({
                        where: {
                           subcategoryId: subcategory.id,
                        },
                     });
                     return {
                        ...subcategory,
                        tagCount: subCount,
                     };
                  })
               );

               return {
                  id: category.id,
                  name: category.name,
                  count,
                  subcategories: subcategoriesWithCount,
               };
            })
         );

         // Contar tags sem categoria
         const noCategory = await this.client.tag.count({
            where: {
               categoryId: null,
            },
         });

         // Contar total de tags
         const totalTags = await this.client.tag.count();

         // Contar total de categorias
         const totalCategories = categories.length;

         // Contar total de subcategorias
         const totalSubcategories = await this.client.tagSubcategory.count();

         return {
            totalTags,
            totalCategories,
            totalSubcategories,
            noCategory,
            categoryStats,
         };
      } catch (error) {
         throw new Error("Erro ao buscar estatísticas de tags");
      }
   }
}
