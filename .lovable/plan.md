

# Fix Twitter Relevance Filtering for Ambiguous Brand Names

## Problem

The Twitter search query uses only the bare brand name (`"Conductor"`) which is highly ambiguous. The collected tweets are about `@conductor_build` (an AI coding tool), not your Conductor (the SEO platform at conductor.com). Out of the 7 tweets collected, none appear related to your product.

## Solution

### 1. Build a smarter Twitter search query

Instead of just `"Conductor"`, construct a query that adds context using product terms, domain, or industry keywords to disambiguate. For example:

```
("Conductor" SEO) OR ("Conductor" content) OR (conductor.com) -is:retweet lang:en
```

This uses the company's `product_terms` and `industry_type` to narrow results.

### 2. Add post-search brand validation

After AI extraction, add a second check: verify the extracted feedback text mentions brand-relevant terms (SEO, content, search optimization, conductor.com, etc.) before inserting. This mirrors the existing web/Reddit filtering logic that already validates brand mentions.

### 3. Raise the confidence threshold for ambiguous brands

For Twitter specifically, bump the minimum confidence from 0.7 to 0.8 since tweets are short and more prone to false positives.

## Technical Details

### File: `supabase/functions/collect-feedback/index.ts`

**Query construction** (replace the simple `"${brandName}" -is:retweet lang:en` on ~line 305):

Build an OR query combining the brand name with product terms or industry keywords:
```typescript
const productTerms = (company.product_terms || []).slice(0, 3);
const industryType = company.industry_type || "";

// Build disambiguation terms from product_terms and industry
const contextTerms = [...productTerms.map(t => t.split(" ").pop()), industryType]
  .filter(Boolean)
  .slice(0, 3);

let query: string;
if (contextTerms.length > 0) {
  // Create OR clauses: ("Brand" term1) OR ("Brand" term2) OR (domain)
  const orClauses = contextTerms.map(t => `("${brandName}" ${t})`);
  orClauses.push(`(${company.domain})`);
  query = `(${orClauses.join(" OR ")}) -is:retweet lang:en`;
} else {
  query = `"${brandName}" -is:retweet lang:en`;
}
```

For Conductor, this produces: `("Conductor" SEO) OR ("Conductor" Intelligence) OR ("Conductor" Monitoring) OR (conductor.com) -is:retweet lang:en`

**AI prompt improvement** (~line 338): Add product context to help the AI distinguish:
```
Extract customer feedback from tweets about ${company.name} (${company.domain}), 
a ${company.industry_type || "software"} product. 
Only extract tweets about THIS specific product, not other products 
that share the same name. Skip tweets about unrelated products, 
promotional tweets, ads, and bot content.
```

**Post-extraction brand validation** (~line 397): Add the same brand-mention check used in Reddit:
```typescript
const feedbackLower = item.text.toLowerCase();
const allTerms = [...brandTerms, ...(company.product_terms || []), company.domain];
const mentionsBrand = allTerms.some(t => feedbackLower.includes(t.toLowerCase()));
if (!mentionsBrand && (item.confidence || 0) < 0.85) continue;
```

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/collect-feedback/index.ts` | Smarter Twitter query with disambiguation, improved AI prompt, post-extraction brand validation |

## Expected Outcome

- Twitter search will target SEO/content-related Conductor tweets, not the AI coding tool
- AI extraction prompt will have enough context to distinguish between products sharing the name
- Post-extraction validation will catch any remaining false positives
