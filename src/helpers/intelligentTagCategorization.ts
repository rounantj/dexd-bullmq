import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

const prisma = new PrismaClient();

interface TagCategorizationResult {
   tagName: string;
   category: string;
   subcategory: string;
}

interface CategorizationInput {
   tags: string[];
   productContext?: string;
}

/**
 * Usa LLM para criar categorização inteligente de tags em categorias e subcategorias
 * Esta função é chamada APÓS a criação das tags pela LLM, para melhorar o encaixe
 */
export async function intelligentTagCategorization(
   openai: OpenAI,
   input: CategorizationInput
): Promise<TagCategorizationResult[]> {
   const { tags, productContext } = input;

   if (!tags || tags.length === 0) {
      return [];
   }

   console.info(`🤖 [Intelligent Categorization]: Iniciando categorização inteligente para ${tags.length} tags`);

   // Buscar categorias existentes no banco com IDs para orientar a LLM
   const existingCategories = await prisma.tagCategory.findMany({
      select: {
         id: true,
         name: true,
         subcategories: {
            select: {
               id: true,
               name: true,
               categoryId: true,
            },
         },
      },
      orderBy: {
         id: "asc",
      },
   });

   // Formatar categorias para o prompt
   const categoriesListText = existingCategories.map((cat) => `${cat.id} - ${cat.name}`).join("\n");

   // Formatar subcategorias para o prompt
   const subcategoriesListText = existingCategories
      .flatMap((cat) => cat.subcategories.map((sub) => `${sub.name} (${sub.categoryId})`))
      .join("\n");

   const systemPrompt = `Você é um especialista em taxonomia e categorização de produtos e conteúdo.
Sua tarefa é analisar tags e atribuir a cada uma delas a CATEGORIA e SUBCATEGORIA mais apropriadas.

IMPORTANTE:
- A hierarquia é: CATEGORIA > SUBCATEGORIA > TAG
- Seja específico e preciso nas subcategorias
- Considere o contexto do produto quando fornecido
- 10 tags serão fornecidas para categorização, por produto, sendo obrigatória a categorização de tags de:

   1. Marca; 
   2. Nome do Produto; 
   3. Segmento; 
   4. Cores;
   5. Características do Produto. 

As demais deverão ser categorizadas, respeitando todas as regras deste prompt, visando a descrição de outras características importantes do produto por meio de tags, de acordo com a sua análise.

REGRA DE OURO PARA CATEGORIZAÇÃO:
0. SEMPRE TEREMOS UMA TAG DENTRO DA CATEGORIA NOME DE PRODUTO, A SER ATRIBUIDA A MARCA DO PRODUTO. NUNCA PODE HAVER UM CASO SEM ESSA CATEGORIA APLICADA.
1. PRIMEIRO: Tente usar as categorias e subcategorias existentes listadas abaixo
2. Analise cuidadosamente se alguma categoria/subcategoria existente se encaixa
3. Seja flexível - uma categoria pode servir mesmo que não seja perfeita
4. ÚLTIMO RECURSO: Se realmente não existir nenhuma opção adequada, você PODE e DEVE criar uma nova categoria/subcategoria

QUANDO CRIAR NOVAS:
- Se a tag representa um conceito completamente novo não coberto pelas existentes
- Se forçar o encaixe em uma categoria existente causaria confusão ou perda de precisão
- Para marcas novas que não estão listadas (criar subcategoria sob "Nome do Produto - Por Marca" ou categoria "Marca")
- Para segmentos muito específicos não contemplados (mas tente primeiro encaixar em segmentos mais amplos)

ATENÇÃO ESPECIAL:
- Para Segmento: prefira usar subcategorias de Segmento já existentes (ex: Tecnologia, Moda e Beleza, Casa, Construção e Organização, etc)
- Para Marcas conhecidas: verifique se já existe uma subcategoria específica
- Não tenha medo de criar quando realmente necessário - o sistema precisa evoluir com novos produtos

Estas são as categorias e subcategorias da base:

CATEGORIAS (ID - Nome):
${categoriesListText}

SUBCATEGORIAS (Nome - ID da Categoria a que pertence):
${subcategoriesListText}

Exemplos de boa categorização:

1. Tag obrigatória de Marca: "Apple"
   - Categoria: "Marca"
   - Subcategoria: "Marca - Tecnologia"

2. Tag obrigatória Nome do Produto: "Nike Air Max"
   - Categoria: "Nome do Produto - Por Marca"
   - Subcategoria: "Nike"

3. Tag obrigatória de Segmento: "Boné Nascar"
   - Categoria: "Segmento"
   - Subcategoria: "Moda e Beleza"

4. Tag obrigatória de Cores: "Branco"
   - Categoria: "Cores"
   - Subcategoria: "Cor - Paleta Base"

5. Tag obrigatória de Características do Produto: "16gb"
   - Categoria: "Características do Produto"
   - Subcategoria: "Memória"

Responda APENAS com um JSON válido no seguinte formato:
{
  "categorizations": [
    {
      "tagName": "nome da tag",
      "category": "nome da categoria",
      "subcategory": "nome da subcategoria"
    }
  ]
}`;

   const userPrompt = `${productContext ? `Contexto do Produto: ${productContext}\n\n` : ""}Tags para categorizar:
${tags.map((tag, idx) => `${idx + 1}. ${tag}`).join("\n")}

Analise cada tag e atribua a categoria e subcategoria mais apropriadas.`;

   try {
      const response = await openai.chat.completions.create({
         model: "gpt-4o-mini",
         messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
         ],
         temperature: 0.3, // Baixa temperatura para respostas mais consistentes
         response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
         throw new Error("LLM não retornou conteúdo");
      }

      const result = JSON.parse(content);
      const categorizations = result.categorizations || [];

      console.info(`✅ [Intelligent Categorization]: Categorizadas ${categorizations.length} tags com sucesso`);
      console.info(`📊 [Intelligent Categorization]: Resultado:`, JSON.stringify(categorizations, null, 2));

      return categorizations;
   } catch (error) {
      console.error(`❌ [Intelligent Categorization]: Erro ao categorizar tags:`, error);
      // Em caso de erro, retorna categorização padrão
      return tags.map((tag) => ({
         tagName: tag,
         category: "Geral",
         subcategory: "Diversos",
      }));
   }
}

/**
 * Aplica a categorização criando/buscando categorias e subcategorias no banco
 * e retorna os IDs para associar às tags
 */
export async function applyTagCategorization(
   categorizations: TagCategorizationResult[]
): Promise<Map<string, { categoryId: number; subcategoryId: number }>> {
   const result = new Map<string, { categoryId: number; subcategoryId: number }>();

   for (const cat of categorizations) {
      try {
         // Buscar ou criar categoria
         let category = await prisma.tagCategory.findFirst({
            where: { name: cat.category },
         });

         if (!category) {
            console.info(`📝 [Apply Categorization]: Criando nova categoria: ${cat.category}`);
            category = await prisma.tagCategory.create({
               data: { name: cat.category },
            });
         }

         // Buscar ou criar subcategoria
         let subcategory = await prisma.tagSubcategory.findFirst({
            where: {
               name: cat.subcategory,
               categoryId: category.id,
            },
         });

         if (!subcategory) {
            console.info(`📝 [Apply Categorization]: Criando nova subcategoria: ${cat.subcategory} em ${cat.category}`);
            subcategory = await prisma.tagSubcategory.create({
               data: {
                  name: cat.subcategory,
                  categoryId: category.id,
               },
            });
         }

         result.set(cat.tagName, {
            categoryId: category.id,
            subcategoryId: subcategory.id,
         });

         console.info(`✅ [Apply Categorization]: Tag "${cat.tagName}" -> ${cat.category} > ${cat.subcategory}`);
      } catch (error) {
         console.error(`❌ [Apply Categorization]: Erro ao aplicar categorização para "${cat.tagName}":`, error);
      }
   }

   return result;
}
