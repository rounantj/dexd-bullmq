import { PrismaClient, User } from "@prisma/client";
import BillingRepository from "./billing-repository";

export interface UsageLimit {
   featureKey: string;
   currentUsage: number;
   limit: number;
   isExceeded: boolean;
   resetDate: Date;
}

export interface UsageCheckResult {
   canProceed: boolean;
   limits: UsageLimit[];
   exceededFeatures: string[];
   message?: string;
}

export default class UsageLimitsService {
   private readonly repository: BillingRepository;

   constructor(private prismaClient: PrismaClient) {
      this.repository = new BillingRepository(prismaClient);
   }

   /**
    * Verifica se há invoices vencidas (pagamento atrasado)
    */
   async hasOverdueInvoices(userId: number): Promise<{ hasOverdue: boolean; count: number; message?: string }> {
      try {
         const pendingInvoices = await this.repository.findPendingInvoicesByUser(userId);
         const overdueInvoices = pendingInvoices.filter(
            (inv) => inv.status === "OVERDUE"
         );

         if (overdueInvoices.length > 0) {
            console.log(`💳 [UsageLimits] Usuário ${userId} tem ${overdueInvoices.length} invoice(s) vencida(s)`);
            return {
               hasOverdue: true,
               count: overdueInvoices.length,
               message: `Você possui ${overdueInvoices.length} pagamento(s) pendente(s). Regularize sua situação para continuar usando a plataforma.`,
            };
         }

         return { hasOverdue: false, count: 0 };
      } catch (error) {
         console.error(`❌ [UsageLimits] Erro ao verificar invoices vencidas:`, error);
         return { hasOverdue: false, count: 0 };
      }
   }

   /**
    * Verifica se o usuário pode criar um recurso específico
    */
   async checkUsageLimit(
      userId: number,
      featureKey: string,
      resourceType?: string,
      resourceId?: number
   ): Promise<UsageCheckResult> {
      try {
         console.log(`🔍 [UsageLimits] Verificando limite para userId: ${userId}, featureKey: ${featureKey}`);

         // 0. Verificar se há pagamentos pendentes
         const overdueCheck = await this.hasOverdueInvoices(userId);
         if (overdueCheck.hasOverdue) {
            console.log(`💳 [UsageLimits] BLOQUEADO por pagamento pendente`);
            return {
               canProceed: false,
               limits: [],
               exceededFeatures: ["payment"],
               message: overdueCheck.message,
            };
         }

         // 1. Buscar assinatura atual do usuário
         const userSubscription = await this.repository.findUserSubscription(userId);

         if (!userSubscription) {
            console.log(`❌ [UsageLimits] Usuário ${userId} não possui assinatura ativa`);
            return {
               canProceed: false,
               limits: [],
               exceededFeatures: [featureKey],
               message: "Usuário não possui assinatura ativa",
            };
         }

         console.log(`✅ [UsageLimits] Usuário ${userId} tem assinatura ID: ${userSubscription.subscriptionId}`);

         // 2. Buscar features da assinatura
         const features = await this.repository.findSubscriptionFeatures(userSubscription.subscriptionId);
         const targetFeature = features.find((f) => f.featureKey === featureKey);

         if (!targetFeature) {
            console.log(
               `ℹ️ [UsageLimits] Feature ${featureKey} não definida para assinatura ${userSubscription.subscriptionId}, permitindo`
            );
            return {
               canProceed: true, // Se não há limite definido, permite
               limits: [],
               exceededFeatures: [],
            };
         }

         console.log(
            `📊 [UsageLimits] Feature encontrada: ${targetFeature.featureName}, limite: ${targetFeature.featureValue}`
         );

         // 3. Buscar uso atual do usuário (contagem real dos produtos/vídeos)
         const currentUsage = await this.getRealUsage(userId, featureKey);

         console.log(`📈 [UsageLimits] Uso atual: ${currentUsage}, Limite: ${targetFeature.featureValue}`);

         // 4. Verificar se excedeu o limite
         const limit = targetFeature.featureValue || 0;
         const isExceeded = currentUsage >= limit;

         const usageLimit: UsageLimit = {
            featureKey,
            currentUsage,
            limit,
            isExceeded,
            resetDate: this.getNextResetDate(),
         };

         // 5. Se excedeu, registrar tentativa de uso
         if (isExceeded) {
            console.log(`⚠️ [UsageLimits] LIMITE EXCEDIDO! ${currentUsage}/${limit}`);
            await this.recordUsageAttempt(userId, userSubscription.id, featureKey, resourceType, resourceId);
         } else {
            console.log(`✅ [UsageLimits] Limite OK, pode prosseguir`);
         }

         return {
            canProceed: !isExceeded,
            limits: [usageLimit],
            exceededFeatures: isExceeded ? [featureKey] : [],
            message: isExceeded ? `Limite de ${featureKey} excedido. Atual: ${currentUsage}/${limit}` : undefined,
         };
      } catch (error) {
         console.error("❌ [UsageLimits] Erro ao verificar limite de uso:", error);
         return {
            canProceed: false,
            limits: [],
            exceededFeatures: [featureKey],
            message: "Erro ao verificar limites de uso",
         };
      }
   }

   /**
    * Registra o uso de um recurso
    */
   async recordUsage(userId: number, featureKey: string, resourceType?: string, resourceId?: number): Promise<void> {
      try {
         const userSubscription = await this.repository.findUserSubscription(userId);

         if (!userSubscription) {
            throw new Error("Usuário não possui assinatura ativa");
         }

         // Registrar uso na tabela usage_tracking
         await this.prismaClient.usage_tracking.create({
            data: {
               userId,
               userSubscriptionId: userSubscription.id,
               featureKey,
               usageCount: 1,
               usageDate: new Date(),
               resourceId: resourceId || null,
               resourceType: resourceType || null,
               description: `Uso de ${featureKey}`,
            },
         });
      } catch (error) {
         console.error("Erro ao registrar uso:", error);
         throw error;
      }
   }

   /**
    * Registra tentativa de uso quando limite foi excedido
    */
   async recordUsageAttempt(
      userId: number,
      userSubscriptionId: number,
      featureKey: string,
      resourceType?: string,
      resourceId?: number
   ): Promise<void> {
      try {
         await this.prismaClient.usage_tracking.create({
            data: {
               userId,
               userSubscriptionId,
               featureKey,
               usageCount: 0, // 0 indica tentativa bloqueada
               usageDate: new Date(),
               resourceId: resourceId || null,
               resourceType: resourceType || null,
               description: `Tentativa bloqueada de uso de ${featureKey} - limite excedido`,
            },
         });
      } catch (error) {
         console.error("Erro ao registrar tentativa de uso:", error);
      }
   }

   /**
    * Busca uso atual do usuário para uma feature específica
    */
   private async getCurrentUsage(userId: number, userSubscriptionId: number, featureKey: string): Promise<number> {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const usage = await this.prismaClient.usage_tracking.aggregate({
         where: {
            userId,
            userSubscriptionId,
            featureKey,
            usageDate: {
               gte: startOfMonth,
            },
            usageCount: {
               gt: 0, // Excluir tentativas bloqueadas
            },
         },
         _sum: {
            usageCount: true,
         },
      });

      return usage._sum.usageCount || 0;
   }

   /**
    * Calcula a data do próximo reset (próximo mês)
    */
   private getNextResetDate(): Date {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
      return nextMonth;
   }

   /**
    * Busca todos os limites e uso atual do usuário
    */
   async getUserUsageSummary(userId: number): Promise<UsageLimit[]> {
      try {
         // Buscar usuário para verificar se existe
         const user = await this.prismaClient.user.findUnique({
            where: { id: userId },
         });

         if (!user) {
            throw new Error("Usuário não encontrado");
         }

         // Buscar assinatura ativa do usuário
         const userSubscription = await this.repository.findUserSubscription(userId);

         // Definir limites hardcoded baseados nos planos (temporário)
         const planLimits = this.getHardcodedPlanLimits(userSubscription?.subscriptionId || 3);

         const limits: UsageLimit[] = [];

         for (const [featureKey, limit] of Object.entries(planLimits)) {
            // Buscar uso real do usuário
            const currentUsage = await this.getRealUsage(userId, featureKey);

            limits.push({
               featureKey,
               currentUsage,
               limit,
               isExceeded: currentUsage >= limit,
               resetDate: this.getNextResetDate(),
            });
         }

         return limits;
      } catch (error) {
         console.error("Erro ao buscar resumo de uso:", error);
         return [];
      }
   }

   /**
    * Busca uso real do usuário (apenas produtos e vídeos criados via IA)
    */
   private async getRealUsage(userId: number, featureKey: string): Promise<number> {
      // Calcular início do mês atual
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      console.log(
         `📅 Contando uso de ${featureKey} para mês: ${startOfMonth.toISOString()} até ${endOfMonth.toISOString()}`
      );

      try {
         switch (featureKey) {
            case "productsPerMonth":
               // ✅ CONTAR APENAS PRODUTOS CRIADOS VIA IA (type = 'external')
               // Produtos manuais (type = 'manual') não contam no limite
               const userStore = await this.prismaClient.store.findUnique({
                  where: { userId },
               });

               if (!userStore) {
                  console.log(`🏪 Usuário ${userId} não possui loja`);
                  return 0;
               }

               // DEBUG: Contar todos os produtos para comparação
               const allProductsCount = await this.prismaClient.product.count({
                  where: {
                     storeId: userStore.id,
                     createdAt: {
                        gte: startOfMonth,
                        lte: endOfMonth,
                     },
                  },
               });

               const productsCount = await this.prismaClient.product.count({
                  where: {
                     storeId: userStore.id,
                     type: "external", // ✅ Apenas produtos criados via IA/Affiliate Link
                     createdAt: {
                        gte: startOfMonth,
                        lte: endOfMonth,
                     },
                  },
               });

               console.log(
                  `📦 [UsageLimits] Usuário ${userId} - Total produtos este mês: ${allProductsCount}, Produtos via IA: ${productsCount}`
               );
               console.log(
                  `📦 Produtos VIA IA criados em ${now.toLocaleDateString("pt-BR", {
                     month: "long",
                     year: "numeric",
                  })}: ${productsCount}`
               );
               return productsCount;

            case "videosPerMonth":
               // ✅ CONTAR APENAS VÍDEOS CRIADOS VIA IA
               // Usamos a tabela usage_tracking para contar registros de uso
               const videosCountFromTracking = await this.prismaClient.usage_tracking.count({
                  where: {
                     userId,
                     featureKey: "videosPerMonth",
                     resourceType: "video",
                     usageDate: {
                        gte: startOfMonth,
                        lte: endOfMonth,
                     },
                     usageCount: {
                        gt: 0, // Apenas registros de uso bem-sucedido (não tentativas bloqueadas)
                     },
                  },
               });

               console.log(
                  `🎥 Vídeos VIA IA criados em ${now.toLocaleDateString("pt-BR", {
                     month: "long",
                     year: "numeric",
                  })}: ${videosCountFromTracking}`
               );
               return videosCountFromTracking;

            case "galleriesPerMonth":
               // Contar galerias criadas no mês atual usando usage_tracking
               const galleriesCountFromTracking = await this.prismaClient.usage_tracking.count({
                  where: {
                     userId,
                     featureKey: "galleriesPerMonth",
                     resourceType: "gallery",
                     usageDate: {
                        gte: startOfMonth,
                        lte: endOfMonth,
                     },
                     usageCount: {
                        gt: 0, // Apenas registros de uso bem-sucedido
                     },
                  },
               });

               console.log(
                  `🖼️ Galerias criadas em ${now.toLocaleDateString("pt-BR", {
                     month: "long",
                     year: "numeric",
                  })}: ${galleriesCountFromTracking}`
               );
               return galleriesCountFromTracking;

            case "shortLinksPerMonth":
               // Contar short URLs criadas no mês atual (assumindo que shortName é único por usuário)
               // Como não temos tabela específica de short links, vamos contar pela criação de shortName
               const shortLinksCount = await this.prismaClient.user.count({
                  where: {
                     id: userId,
                     shortName: {
                        not: null,
                     },
                     createdAt: {
                        gte: startOfMonth,
                        lte: endOfMonth,
                     },
                  },
               });

               console.log(
                  `🔗 Links encurtados criados em ${now.toLocaleDateString("pt-BR", {
                     month: "long",
                     year: "numeric",
                  })}: ${shortLinksCount}`
               );
               return shortLinksCount;

            case "photoPerProject":
               // Contar fotos por projeto (usar 1 como padrão por enquanto)
               return 0;

            case "pinPerProject":
               // Contar pins por projeto (usar 1 como padrão por enquanto)
               return 0;

            case "videoDuration":
               // Duração máxima de vídeo (em segundos)
               return 0;

            default:
               // Para outras features, usar o sistema de tracking
               const userSubscription = await this.repository.findUserSubscription(userId);
               if (userSubscription) {
                  return await this.getCurrentUsage(userId, userSubscription.id, featureKey);
               }
               return 0;
         }
      } catch (error) {
         console.error(`Erro ao buscar uso real para ${featureKey}:`, error);
         return 0;
      }
   }

   /**
    * Retorna limites hardcoded baseados no plano
    */
   private getHardcodedPlanLimits(subscriptionId: number): { [key: string]: number } {
      switch (subscriptionId) {
         case 3:
            return { productsPerMonth: 5, videosPerMonth: 2, galleriesPerMonth: 10 }; // Starter
         case 4:
            return { productsPerMonth: 50, videosPerMonth: 20, galleriesPerMonth: 50 }; // Pro
         case 5:
            return { productsPerMonth: 200, videosPerMonth: 40, galleriesPerMonth: 999999 }; // Business
         case 6:
            return { productsPerMonth: 600, videosPerMonth: 120, galleriesPerMonth: 999999 }; // Enterprise
         default:
            return { productsPerMonth: 5, videosPerMonth: 2, galleriesPerMonth: 10 }; // Starter padrão
      }
   }

   /**
    * Verifica se o usuário pode criar vídeo
    */
   async canCreateVideo(userId: number): Promise<UsageCheckResult> {
      return this.checkUsageLimit(userId, "videosPerMonth", "video");
   }

   /**
    * Verifica se o usuário pode criar produto
    */
   async canCreateProduct(userId: number): Promise<UsageCheckResult> {
      return this.checkUsageLimit(userId, "productsPerMonth", "product");
   }

   /**
    * Verifica se o usuário pode usar Dexd Points
    */
   async canUseDexdPoints(userId: number): Promise<UsageCheckResult> {
      return this.checkUsageLimit(userId, "dexdPointsPerMonth", "dexdPoint");
   }

   /**
    * Verifica se o usuário pode criar galeria
    */
   async canCreateGallery(userId: number): Promise<UsageCheckResult> {
      return this.checkUsageLimit(userId, "galleriesPerMonth", "gallery");
   }

   /**
    * Verifica se o usuário pode criar link encurtado
    */
   async canCreateShortLink(userId: number): Promise<UsageCheckResult> {
      return this.checkUsageLimit(userId, "shortLinksPerMonth", "shortLink");
   }

   /**
    * Retorna features padrão baseadas no ID do plano
    */
   private getDefaultFeaturesByPlan(subscriptionId: number): Array<{ featureKey: string; featureValue: number }> {
      switch (subscriptionId) {
         case 3: // Starter (gratuito)
            return [
               { featureKey: "videosPerMonth", featureValue: 2 },
               { featureKey: "productsPerMonth", featureValue: 5 },
               { featureKey: "dexdPointsPerMonth", featureValue: 1 },
            ];
         case 4: // Pro
            return [
               { featureKey: "videosPerMonth", featureValue: 20 },
               { featureKey: "productsPerMonth", featureValue: 50 },
               { featureKey: "dexdPointsPerMonth", featureValue: 3 },
            ];
         case 5: // Business
            return [
               { featureKey: "videosPerMonth", featureValue: 40 },
               { featureKey: "productsPerMonth", featureValue: 200 },
               { featureKey: "dexdPointsPerMonth", featureValue: 5 },
            ];
         case 6: // Enterprise
            return [
               { featureKey: "videosPerMonth", featureValue: 120 },
               { featureKey: "productsPerMonth", featureValue: 600 },
               { featureKey: "dexdPointsPerMonth", featureValue: 10 },
            ];
         default:
            return [
               { featureKey: "videosPerMonth", featureValue: 2 },
               { featureKey: "productsPerMonth", featureValue: 5 },
               { featureKey: "dexdPointsPerMonth", featureValue: 1 },
            ];
      }
   }
}
