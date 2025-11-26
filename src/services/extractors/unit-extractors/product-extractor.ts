import * as cheerio from "cheerio";

export interface BasicProductData {
   title?: string | null;
   description?: string | null;
   priceText?: string | null;
   priceNumber?: number | null;
   currency?: string | null;
   originalPriceText?: string | null;
   originalPriceNumber?: number | null;
   seller?: string | null;
}

export class ProductContentExtractor {
   extractBasic(html: string, url: string): BasicProductData {
      if (!html || html.trim().length < 50) {
         return {
            title: null,
            description: null,
            priceText: null,
            priceNumber: null,
            currency: null,
            originalPriceText: null,
            originalPriceNumber: null,
            seller: null,
         };
      }

      const $ = cheerio.load(html);

      const fromMeta = (selectors: Array<{ attr: string; key: string }>) => {
         for (const s of selectors) {
            const val = $(`meta[${s.attr}="${s.key}"]`).attr("content");
            if (val && val.trim()) return val.trim();
         }
         return null;
      };

      // Title candidates
      const titleCandidates: Array<string | null | undefined> = [
         fromMeta([
            { attr: "property", key: "og:title" },
            { attr: "name", key: "twitter:title" },
         ]),
         $("h1").first().text()?.trim(),
         $("title").first().text()?.trim(),
      ];

      // Description candidates
      const descCandidates: Array<string | null | undefined> = [
         fromMeta([
            { attr: "property", key: "og:description" },
            { attr: "name", key: "description" },
            { attr: "name", key: "twitter:description" },
         ]),
         $('[itemprop="description"]').first().text()?.trim(),
      ];

      // Seller candidates
      const sellerCandidates: Array<string | null | undefined> = [
         $('[itemprop="brand"]').first().text()?.trim(),
         $('[itemprop="seller"]').first().text()?.trim(),
         $(".shop-name, .store-name, .seller-name, .brand-name").first().text()?.trim(),
      ];

      // Price from meta tags
      const priceFromMeta =
         fromMeta([
            { attr: "property", key: "product:price:amount" },
            { attr: "itemprop", key: "price" },
         ]) ||
         $('[itemprop="price"]').attr("content") ||
         $('[data-qa="price"]').text()?.trim();

      const currencyFromMeta =
         fromMeta([
            { attr: "property", key: "product:price:currency" },
            { attr: "itemprop", key: "priceCurrency" },
         ]) ||
         $('[itemprop="priceCurrency"]').attr("content") ||
         null;

      // Look into JSON-LD Product schema
      let jsonLdPriceText: string | null = null;
      let jsonLdCurrency: string | null = null;
      try {
         const jsonScripts = $('script[type="application/ld+json"]').toArray();
         for (const node of jsonScripts) {
            const raw = $(node).contents().text();
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            const candidates = Array.isArray(parsed) ? parsed : [parsed];
            for (const obj of candidates) {
               if (obj && obj["@type"] && String(obj["@type"]).toLowerCase().includes("product")) {
                  const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
                  if (offers && (offers.price || offers["price"])) {
                     jsonLdPriceText = String(offers.price ?? offers["price"]).trim();
                     jsonLdCurrency = String(offers.priceCurrency ?? "").trim() || null;
                     break;
                  }
               }
            }
            if (jsonLdPriceText) break;
         }
      } catch {}

      // Fallback price guess from page text (simple heuristic)
      const bodyText = $("body").text() || "";
      const pricePattern = /(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})|(\$\s?\d+[\.,]?\d*)|(\d+[\.,]\d{2})/;
      const priceMatch = bodyText.match(pricePattern);

      const priceText = (priceFromMeta || jsonLdPriceText || (priceMatch ? priceMatch[0] : null)) ?? null;
      const currency = currencyFromMeta || (priceText?.includes("R$") ? "BRL" : null);
      const priceNumber = this.normalizePriceToNumber(priceText);

      const originalPriceText = null;
      const originalPriceNumber = null;

      return {
         title: this.pickFirst(titleCandidates),
         description: this.pickFirst(descCandidates),
         priceText,
         priceNumber,
         currency,
         originalPriceText,
         originalPriceNumber,
         seller: this.pickFirst(sellerCandidates),
      };
   }

   private pickFirst<T>(arr: Array<T | null | undefined>): T | null {
      for (const v of arr) {
         if (typeof v === "string" && v.trim().length > 0) return v as unknown as T;
         if (v) return v as T;
      }
      return null;
   }

   private normalizePriceToNumber(priceText: string | null): number | null {
      if (!priceText) return null;
      const cleaned = priceText
         .replace(/[A-Za-z$€£¥R\s]/g, "")
         .replace(/\./g, "")
         .replace(",", ".")
         .trim();
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : null;
   }
}

