

# Fix Feedback Relevance and Add Continuous Collection

## Problems Identified

### 1. Irrelevant Feedback Leaking In
The "Conductor" reviews (e.g., "Maximizing SEO Success with Conductor") come from TrustRadius pages that mention AirOps tangentially or are returned by Firecrawl search but are actually reviews for a different product (Conductor). All 5 TrustRadius results for AirOps are actually Conductor reviews.

**Root cause**: The brand mention check on line 87-88 of `collect-feedback` only checks if ANY brand term appears in the page content. When Firecrawl returns a TrustRadius comparison or category page, the page may mention "AirOps" once in a sidebar while the actual reviews are about Conductor.

**Also**: Some G2 results come from category pages (e.g., `/categories/answer-engine-optimization-aeo/`) rather than actual AirOps product review pages, pulling in generic SEO tool feedback.

### 2. No Continuous/Scheduled Collection
Currently, collection only runs when a user manually clicks "Collect Now." There's no automated scheduling, so the system is not acting as a continuous agent.

---

## Plan

### Fix 1: Stricter Relevance Filtering in `collect-feedback`

Improve the AI extraction prompt and add post-extraction validation:

- **Require the feedback text itself to mention the brand** -- not just the page. After AI extracts each feedback item, validate that `item.text` contains at least one brand term. If not, skip it.
- **Add URL-level filtering**: Skip TrustRadius/G2 pages that are clearly for a different product (e.g., URL contains `/products/conductor/` but the brand is "AirOps").
- **Strengthen the AI system prompt**: Explicitly instruct the LLM to only extract feedback that is **directly about** the target company, and to ignore reviews of competing or unrelated products on the same page.
- **Add a minimum confidence threshold**: Skip items where `confidence < 0.7`.

### Fix 2: Better Source URL Validation

Add a function that checks whether the source URL is likely relevant:
- If URL contains `/products/{other_product}/`, skip unless `other_product` matches a brand term
- If URL is a category/listing page (contains `/categories/`), skip entirely
- If URL is a competitor comparison page, keep only feedback items that explicitly name the target brand in the text

### Fix 3: Scheduled Automatic Collection via pg_cron

Set up a database cron job that triggers the `collect-feedback` edge function automatically:

- Enable `pg_cron` and `pg_net` extensions
- Create a cron job that runs daily, querying the `companies` table for companies where `auto_collect_enabled = true`
- For each eligible company (based on `collection_frequency` -- daily or weekly), call the `collect-feedback` edge function
- Add a "Schedule" toggle in the CompanySetup UI so users can enable/disable auto-collection per brand

### Fix 4: Clean Up Existing Bad Data

Delete the 5 Conductor reviews and any other irrelevant feedback from the AirOps company:
- Remove feedback where `source_url` contains `/products/conductor/`
- Remove feedback from category listing pages

---

## Technical Details

### Modified: `supabase/functions/collect-feedback/index.ts`

**AI prompt update** (line 104):
```
Extract ONLY genuine user opinions about ${company.name} specifically.
Do NOT extract reviews about other products even if they appear on the same page.
Every extracted item MUST be directly about ${company.name} or its products.
```

**Post-extraction brand validation** (after line 178):
```typescript
// Verify feedback text mentions the brand
const feedbackLower = item.text.toLowerCase();
const mentionsBrand = brandTerms.some(t => feedbackLower.includes(t.toLowerCase()));
if (!mentionsBrand && item.confidence < 0.9) continue;
```

**URL relevance check** (after line 87):
```typescript
// Skip URLs clearly about other products
const urlLower = url.toLowerCase();
const isOtherProductPage = urlLower.includes('/products/') &&
  !brandTerms.some(t => urlLower.includes(t.toLowerCase()));
const isCategoryPage = urlLower.includes('/categories/');
if (isOtherProductPage || isCategoryPage) continue;
```

**Confidence threshold** (line 178 area):
```typescript
if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.7) continue;
```

### New: Scheduled Collection (pg_cron)

Create a cron job that runs every 6 hours checking for companies that need collection:
```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Daily check: call collect-feedback for eligible companies
SELECT cron.schedule(
  'auto-collect-feedback',
  '0 6 * * *',  -- daily at 6 AM UTC
  $$
  SELECT net.http_post(
    url := 'https://tmeloxtelmoguhgksjuy.supabase.co/functions/v1/collect-feedback',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <anon_key>"}'::jsonb,
    body := concat('{"company_id": "', id, '"}')::jsonb
  )
  FROM public.companies
  WHERE auto_collect_enabled = true
    AND (last_collected_at IS NULL
         OR (collection_frequency = 'daily' AND last_collected_at < now() - interval '23 hours')
         OR (collection_frequency = 'weekly' AND last_collected_at < now() - interval '6 days'))
  $$
);
```

### Modified: `src/components/settings/CompanySetup.tsx`

Add a toggle for auto-collection per company:
- Switch component for `auto_collect_enabled`
- Dropdown for `collection_frequency` (daily/weekly)
- Show next scheduled collection time

### Data Cleanup

Delete irrelevant feedback already collected:
```sql
DELETE FROM feedback
WHERE company_id = '6e764418-ec2a-4c6f-ba3e-0c341b6c4d34'
  AND (source_url LIKE '%/products/conductor%'
       OR source_url LIKE '%/categories/%');
```

---

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/collect-feedback/index.ts` | Stricter relevance filtering, URL validation, confidence threshold, improved AI prompt |
| `src/components/settings/CompanySetup.tsx` | Add auto-collect toggle and frequency selector per company |
| Database (cron) | Schedule daily collection job via pg_cron + pg_net |
| Database (cleanup) | Delete existing irrelevant feedback |

