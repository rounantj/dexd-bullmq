import { PrismaClient } from "@prisma/client";
import RoleRepository from "../modules/role/role-repository";
import { NotFoundError } from "@pullup.tech/cms";

const prismaClient = new PrismaClient();
const roleRepository = new RoleRepository(prismaClient);

export async function returnRolesId(roles: Array<string> | undefined) {
   try {
      // Se roles não existe ou é undefined, retorna null
      if (!roles || !Array.isArray(roles)) {
         return null;
      }

      const rolesId: Array<number> = [];

      const getRolesId = roles.map(async (role) => {
         const roleData = await roleRepository.getByName(role);
         if (!roleData) throw new NotFoundError("Tipo de usuário não encontrado");

         rolesId.push(roleData.id);
      });

      await Promise.all(getRolesId);
      return rolesId;
   } catch (error: any) {
      console.error(error);
      return null;
   }
}
