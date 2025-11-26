import { PrismaClient } from "@prisma/client";
import TagService from "../modules/tag/tag-service";
import axios from "axios";

const prismaClient = new PrismaClient();
const tagService = new TagService(prismaClient);

interface ImageAnalysisResult {
   tagIds: number[];
   generatedTags: string[];
}

/**
 * Analisa a descrição textual usando OpenAI e retorna IDs de tags
 * @param description - Descrição/texto para análise
 * @param maxTags - Número máximo de tags a gerar (padrão: 3 para peso 30%)
 * @returns Array de IDs de tags criadas/encontradas
 */
export async function analyzeTextForTags(description: string, maxTags: number = 3): Promise<ImageAnalysisResult> {
   try {
      const openaiApiKey = process.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
         console.warn("OPENAI_API_KEY não configurada. Pulando análise de texto.");
         return { tagIds: [], generatedTags: [] };
      }

      if (!description || description.trim().length < 10) {
         console.log("📝 Descrição muito curta, pulando análise de texto");
         return { tagIds: [], generatedTags: [] };
      }

      const messages = [
         {
            role: "system",
            content: `Você é um assistente especializado em análise de textos para um marketplace de arquitetura e design.
Analise a descrição fornecida e gere tags relevantes em português brasileiro.
Retorne APENAS uma lista de tags separadas por vírgula, sem numeração ou formatação adicional.
Foque em: estilo, conceito, propósito, características principais mencionadas.
Máximo de ${maxTags} tags por análise.
Exemplo de resposta: "contemporâneo, sustentável, residencial"`,
         },
         {
            role: "user",
            content: `Analise esta descrição e gere até ${maxTags} tags relevantes:\n\n"${description}"`,
         },
      ];

      console.log(`📝 Analisando descrição com OpenAI (peso 30%)...`);

      const response = await axios.post(
         "https://api.openai.com/v1/chat/completions",
         {
            model: "gpt-4o-mini",
            messages: messages,
            max_tokens: 100,
            temperature: 0.7,
         },
         {
            headers: {
               "Content-Type": "application/json",
               Authorization: `Bearer ${openaiApiKey}`,
            },
         }
      );

      const aiResponse = response.data.choices[0]?.message?.content || "";
      console.log("📝 Tags da descrição:", aiResponse);

      // Parse das tags da resposta
      const generatedTagNames = aiResponse
         .split(",")
         .map((tag: string) => tag.trim().toLowerCase())
         .filter((tag: string) => tag.length > 0 && tag.length < 50)
         .slice(0, maxTags); // Limitar ao máximo especificado

      console.log(`✅ Tags geradas da descrição: ${generatedTagNames.join(", ")}`);

      // Buscar ou criar as tags no banco
      const tagIds: number[] = [];

      for (const tagName of generatedTagNames) {
         try {
            // Tentar encontrar tag existente (busca exata em lowercase)
            let existingTag = await prismaClient.tag.findFirst({
               where: {
                  name: tagName,
               },
            });

            // Se não existir, criar nova tag
            if (!existingTag) {
               console.log(`📝 Criando nova tag da descrição: ${tagName}`);
               existingTag = await prismaClient.tag.create({
                  data: {
                     name: tagName,
                  },
               });
            }

            tagIds.push(existingTag.id);
         } catch (error) {
            console.error(`Erro ao processar tag "${tagName}":`, error);
         }
      }

      return {
         tagIds,
         generatedTags: generatedTagNames,
      };
   } catch (error: any) {
      console.error("❌ Erro ao analisar descrição com OpenAI:", error.response?.data || error.message);
      return { tagIds: [], generatedTags: [] };
   }
}

/**
 * Analisa imagens usando OpenAI Vision API e retorna IDs de tags
 * @param imageUrls - Array de URLs das imagens para analisar
 * @param maxTags - Número máximo de tags a gerar (padrão: 7 para peso 70%)
 * @returns Array de IDs de tags criadas/encontradas
 */
export async function analyzeImagesForTags(imageUrls: string[], maxTags: number = 7): Promise<ImageAnalysisResult> {
   try {
      const openaiApiKey = process.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
         console.warn("OPENAI_API_KEY não configurada. Pulando análise de imagem.");
         return { tagIds: [], generatedTags: [] };
      }

      // Limitar a 3 imagens para análise (economizar tokens)
      const imagesToAnalyze = imageUrls.slice(0, 3);

      const messages = [
         {
            role: "system",
            content: `Você é um assistente especializado em análise de imagens para um marketplace de arquitetura e design.
Analise as imagens e gere tags relevantes em português brasileiro.
Retorne APENAS uma lista de tags separadas por vírgula, sem numeração ou formatação adicional.
Foque em: estilo, cores principais, materiais, ambiente, mobília, decoração, características arquitetônicas.
Máximo de ${maxTags} tags por análise.
Exemplo de resposta: "moderno, minimalista, madeira, branco, sala de estar, iluminação natural, linhas retas"`,
         },
         {
            role: "user",
            content: [
               {
                  type: "text",
                  text: `Analise ${imagesToAnalyze.length} imagem(ns) e gere até ${maxTags} tags relevantes.`,
               },
               ...imagesToAnalyze.map((url) => ({
                  type: "image_url",
                  image_url: {
                     url: url,
                     detail: "low", // Usar "low" para economizar tokens
                  },
               })),
            ],
         },
      ];

      console.log(`🖼️  Analisando ${imagesToAnalyze.length} imagens com OpenAI Vision (peso 70%)...`);

      const response = await axios.post(
         "https://api.openai.com/v1/chat/completions",
         {
            model: "gpt-4o-mini", // Modelo mais barato com suporte a visão
            messages: messages,
            max_tokens: 200,
            temperature: 0.7,
         },
         {
            headers: {
               "Content-Type": "application/json",
               Authorization: `Bearer ${openaiApiKey}`,
            },
         }
      );

      const aiResponse = response.data.choices[0]?.message?.content || "";
      console.log("🖼️  Tags das imagens:", aiResponse);

      // Parse das tags da resposta
      const generatedTagNames = aiResponse
         .split(",")
         .map((tag: string) => tag.trim().toLowerCase())
         .filter((tag: string) => tag.length > 0 && tag.length < 50)
         .slice(0, maxTags); // Limitar ao máximo especificado

      console.log(`✅ Tags geradas das imagens: ${generatedTagNames.join(", ")}`);

      // Buscar ou criar as tags no banco
      const tagIds: number[] = [];

      for (const tagName of generatedTagNames) {
         try {
            // Tentar encontrar tag existente (busca exata em lowercase)
            let existingTag = await prismaClient.tag.findFirst({
               where: {
                  name: tagName,
               },
            });

            // Se não existir, criar nova tag
            if (!existingTag) {
               console.log(`📝 Criando nova tag da imagem: ${tagName}`);
               existingTag = await prismaClient.tag.create({
                  data: {
                     name: tagName,
                  },
               });
            }

            tagIds.push(existingTag.id);
         } catch (error) {
            console.error(`Erro ao processar tag "${tagName}":`, error);
         }
      }

      console.log(`✅ Total de ${tagIds.length} tags processadas das imagens`);

      return {
         tagIds,
         generatedTags: generatedTagNames,
      };
   } catch (error: any) {
      console.error("❌ Erro ao analisar imagens com OpenAI:", error.response?.data || error.message);
      return { tagIds: [], generatedTags: [] };
   }
}

/**
 * Combina tags manuais com tags geradas por IA (descrição + imagens)
 * @param manualTagIds - IDs de tags selecionadas manualmente
 * @param imageUrls - URLs de imagens para análise
 * @param contextDescription - Descrição da galeria para análise (peso 30%)
 * @param generateFromImages - Se deve usar IA para gerar tags
 * @returns Array combinado de IDs de tags (sem duplicatas)
 */
export async function combineManualAndAiTags(
   manualTagIds: number[] = [],
   imageUrls: string[] = [],
   contextDescription?: string,
   generateFromImages: boolean = false
): Promise<{ tagIds: number[]; aiGeneratedTags: string[] }> {
   let textTagIds: number[] = [];
   let imageTagIds: number[] = [];
   let textTags: string[] = [];
   let imageTags: string[] = [];

   // Se solicitado, gerar tags via IA
   if (generateFromImages) {
      // 1. Análise da descrição (peso 30% = ~3 tags)
      if (contextDescription && contextDescription.trim().length >= 10) {
         console.log("📝 Gerando tags da descrição (peso 30%)...");
         const textResult = await analyzeTextForTags(contextDescription, 3);
         textTagIds = textResult.tagIds;
         textTags = textResult.generatedTags;
      }

      // 2. Análise das imagens (peso 70% = ~7 tags)
      if (imageUrls.length > 0) {
         console.log("🖼️  Gerando tags das imagens (peso 70%)...");
         const imageResult = await analyzeImagesForTags(imageUrls, 7);
         imageTagIds = imageResult.tagIds;
         imageTags = imageResult.generatedTags;
      }
   }

   // Combinar todas as tags (manuais + texto + imagens) sem duplicatas
   const allAiTagIds = [...textTagIds, ...imageTagIds];
   const allAiTags = [...textTags, ...imageTags];
   const combinedTagIds = Array.from(new Set([...manualTagIds, ...allAiTagIds]));

   console.log(
      `🏷️  Total de tags: ${combinedTagIds.length} (${manualTagIds.length} manuais + ${textTagIds.length} da descrição + ${imageTagIds.length} das imagens)`
   );

   return {
      tagIds: combinedTagIds,
      aiGeneratedTags: allAiTags,
   };
}
