import { encode } from "gpt-3-encoder";

// Preços baseados na documentação oficial da OpenAI
// https://platform.openai.com/docs/pricing (atualizado em 2025)
// Valores em USD por 1.000 tokens (1K)
const MODEL_PRICING: any = {
   // === GPT-3.5 Series ===
   "gpt-3.5-turbo": {
      input: 0.0005, // $0.50 / 1M tokens
      output: 0.0015, // $1.50 / 1M tokens
   },

   // === GPT-4 Series ===
   "gpt-4": {
      input: 0.03, // $30.00 / 1M tokens
      output: 0.06, // $60.00 / 1M tokens
   },
   "gpt-4-turbo": {
      input: 0.01, // $10.00 / 1M tokens
      output: 0.03, // $30.00 / 1M tokens
   },

   // === GPT-4.1 Series ===
   "gpt-4.1": {
      input: 0.002, // $2.00 / 1M tokens
      output: 0.008, // $8.00 / 1M tokens
   },
   "gpt-4.1-mini": {
      input: 0.0004, // $0.40 / 1M tokens
      output: 0.0016, // $1.60 / 1M tokens
   },
   "gpt-4.1-nano": {
      input: 0.0001, // $0.10 / 1M tokens
      output: 0.0004, // $0.40 / 1M tokens
   },

   // === GPT-4o Series ===
   "gpt-4o": {
      input: 0.0025, // $2.50 / 1M tokens
      output: 0.01, // $10.00 / 1M tokens
   },
   "gpt-4o-mini": {
      input: 0.00015, // $0.15 / 1M tokens
      output: 0.0006, // $0.60 / 1M tokens
   },

   // === GPT-5 Series ===
   "gpt-5": {
      input: 0.00125, // $1.25 / 1M tokens
      output: 0.01, // $10.00 / 1M tokens
   },
   "gpt-5-mini": {
      input: 0.00025, // $0.25 / 1M tokens
      output: 0.002, // $2.00 / 1M tokens
   },
   "gpt-5-nano": {
      input: 0.00005, // $0.05 / 1M tokens ✅ OFICIAL
      output: 0.0004, // $0.40 / 1M tokens ✅ OFICIAL
   },
   "gpt-5-chat-latest": {
      input: 0.00125, // $1.25 / 1M tokens
      output: 0.01, // $10.00 / 1M tokens
   },
   "gpt-5-codex": {
      input: 0.00125, // $1.25 / 1M tokens
      output: 0.01, // $10.00 / 1M tokens
   },
   "gpt-5-pro": {
      input: 0.015, // $15.00 / 1M tokens
      output: 0.12, // $120.00 / 1M tokens
   },

   // === O-Series (Reasoning Models) ===
   o1: {
      input: 0.015, // $15.00 / 1M tokens
      output: 0.06, // $60.00 / 1M tokens
   },
   "o1-mini": {
      input: 0.0011, // $1.10 / 1M tokens
      output: 0.0044, // $4.40 / 1M tokens
   },
   "o1-pro": {
      input: 0.15, // $150.00 / 1M tokens
      output: 0.6, // $600.00 / 1M tokens
   },
   o3: {
      input: 0.002, // $2.00 / 1M tokens
      output: 0.008, // $8.00 / 1M tokens
   },
   "o3-mini": {
      input: 0.0011, // $1.10 / 1M tokens
      output: 0.0044, // $4.40 / 1M tokens
   },
   "o3-pro": {
      input: 0.02, // $20.00 / 1M tokens
      output: 0.08, // $80.00 / 1M tokens
   },
   "o4-mini": {
      input: 0.0011, // $1.10 / 1M tokens
      output: 0.0044, // $4.40 / 1M tokens
   },
};

export class OpenAITokenCounter {
   public totalCost: number;
   public totalInputTokens: number;
   public totalOutputTokens: number;
   public callCount: number;
   constructor() {
      this.totalCost = 0;
      this.totalInputTokens = 0;
      this.totalOutputTokens = 0;
      this.callCount = 0;
   }

   calculateCost(model: any, inputTokens: any, outputTokens: any) {
      const pricing = MODEL_PRICING[model];
      if (!pricing) {
         console.warn(`Preço não encontrado para o modelo: ${model}`);
         return { inputCost: 0, outputCost: 0, totalCost: 0 };
      }

      const inputCost = (inputTokens / 1000) * pricing.input;
      const outputCost = (outputTokens / 1000) * pricing.output;
      const totalCost = inputCost + outputCost;

      return { inputCost, outputCost, totalCost };
   }

   contarTokens(str: string): number {
      return encode(str).length;
   }

   logTokenUsage(model: any, inputTokens: any, outputTokens: any, callDuration: any = null) {
      const costs = this.calculateCost(model, inputTokens, outputTokens);

      this.totalCost += costs.totalCost;
      this.totalInputTokens += inputTokens;
      this.totalOutputTokens += outputTokens;
      this.callCount++;

      console.info("🤖 === OPENAI API CALL STATS ===");
      console.info(`📊 Model: ${model}`);
      console.info(`📥 Input Tokens: ${inputTokens.toLocaleString()}`);
      console.info(`📤 Output Tokens: ${outputTokens.toLocaleString()}`);
      console.info(`🔢 Total Tokens: ${(inputTokens + outputTokens).toLocaleString()}`);
      console.info(`💰 Input Cost: ${costs.inputCost.toFixed(6)}`);
      console.info(`💰 Output Cost: ${costs.outputCost.toFixed(6)}`);
      console.info(`💵 Total Call Cost: ${costs.totalCost.toFixed(6)}`);

      if (callDuration) {
         console.info(`⏱️  Call Duration: ${callDuration}ms`);
      }

      console.info(`📈 Accumulated Cost: ${this.totalCost.toFixed(6)}`);
      console.info(`🔄 Total Calls: ${this.callCount}`);
      console.info("================================\n");

      return costs;
   }

   getStats() {
      return {
         totalCost: this.totalCost,
         totalInputTokens: this.totalInputTokens,
         totalOutputTokens: this.totalOutputTokens,
         totalTokens: this.totalInputTokens + this.totalOutputTokens,
         callCount: this.callCount,
         averageCostPerCall: this.callCount > 0 ? this.totalCost / this.callCount : 0,
      };
   }

   resetStats() {
      this.totalCost = 0;
      this.totalInputTokens = 0;
      this.totalOutputTokens = 0;
      this.callCount = 0;
   }
}
