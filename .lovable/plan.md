

# Add Twitter/X Bearer Token for Feedback Collection

## What We'll Do

Since you already have a bearer token, we can simplify the Twitter integration to use it directly -- no need for the OAuth token exchange flow with all 4 keys.

## Steps

### 1. Store Your Secrets

We'll securely store three secrets:
- **TWITTER_CONSUMER_KEY** -- your consumer/API key
- **TWITTER_CONSUMER_SECRET** -- your secret key  
- **TWITTER_BEARER_TOKEN** -- your bearer token

### 2. Update the Collect-Feedback Function

Modify `supabase/functions/collect-feedback/index.ts` to:
- Check for `TWITTER_BEARER_TOKEN` first and use it directly if available (skipping the OAuth token exchange)
- Fall back to the consumer key + secret OAuth flow if no bearer token is set
- Remove the requirement for `ACCESS_TOKEN` and `ACCESS_TOKEN_SECRET` (not needed with bearer token auth)

The key change is replacing the credential check and token fetch with:

```typescript
const BEARER_TOKEN = Deno.env.get("TWITTER_BEARER_TOKEN");
const CONSUMER_KEY = Deno.env.get("TWITTER_CONSUMER_KEY");
const CONSUMER_SECRET = Deno.env.get("TWITTER_CONSUMER_SECRET");

let bearerToken = BEARER_TOKEN;

if (!bearerToken && CONSUMER_KEY && CONSUMER_SECRET) {
  // Fall back to OAuth client credentials flow
  // ... existing token exchange code ...
} else if (!bearerToken) {
  console.log("Twitter API keys not configured, skipping");
  return { newCount, dupeCount, texts };
}

// Use bearerToken directly for search
```

### 3. Enable Twitter Source

Once secrets are stored, you can enable "Twitter / X" as a collection source on your company in Settings to start pulling tweets on the next collection run.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/collect-feedback/index.ts` | Support `TWITTER_BEARER_TOKEN` directly, make access token/secret optional |
| Secrets | Add `TWITTER_CONSUMER_KEY`, `TWITTER_CONSUMER_SECRET`, `TWITTER_BEARER_TOKEN` |

