import { PrismaClient } from "@prisma/client";
import TagService from "../modules/tag/tag-service";

const prismaClient = new PrismaClient();
const tagsService = new TagService(prismaClient);

export async function linkTags(
   tags: { id: number; type: string | null }[],
   reference: number,
   entityType: string,
   type?: string
) {
   try {
      await tagsService.linkTags(reference, entityType, tags, type);
   } catch (error: any) {
      console.error(error);
   }
}
