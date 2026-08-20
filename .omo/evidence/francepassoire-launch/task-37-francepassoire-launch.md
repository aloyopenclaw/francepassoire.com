# Task 37 — Evidence Log (rewritten after full re-research)

## Date: 2026-08-20

A prior attempt left `docs/social-setup.md` + an evidence log, but the task mandated independent re-verification of the X free-tier verdict (prior research lost). The previous doc was found to contain errors (read cap stated 2,000,000 vs live-doc 3,000,000; stale old-portal console steps; npub/nsec attributed to NIP-01 instead of NIP-19; missed LinkedIn Token Generator). Doc fully rewritten from live-fetched official sources.

## X free-tier WRITE verdict (re-researched from live official docs, fetched 2026-08-20)

**No free write access exists for new developers. X is pay-per-use since Feb 6, 2026.** Doc states « X différé, offre payante hors périmètre ».

Facts verified by fetching page content (not just reachability):

1. `docs.x.com/x-api/getting-started/pricing` (live): "The X API uses pay-per-usage pricing. No subscriptions—pay only for what you use." Credits purchased upfront; Post: Create \$0.015/req; Post: Create (with URL) \$0.200/req; Post: Create (summoned) \$0.010/req; pay-per-use capped at **3 million Post reads/month** (previous doc said 2M — corrected).
2. `docs.x.com/overview` (live): exactly two products — "X API — Pay-per-use" and "X API — Enterprise". No free tier offered.
3. `docs.x.com/changelog` (live): Feb 6, 2026 "Launch of X API Pay-Per-Use pricing" — "Recently active Legacy Free tier users receive a one-time \$10 voucher" (tier closed to new devs); "Public Utility Apps continue to receive free scaled access" (case-by-case approval, not a launch path); "Basic and Pro plans remain available" (ambiguous — marked « à confirmer au moment de la création de l'app » in doc). Feb 23, 2026: programmatic replies only when "summoned" (self-serve tiers). Apr 16, 2026 (effective Apr 20): POST /2/tweets \$0.015, URL posts \$0.20, "Following, Likes, and Quote-Posts via the API have been removed from all self-serve tiers."
4. `docs.x.com/x-api/posts/create-post` (live, OpenAPI): `POST /2/tweets` security = OAuth2UserToken with scopes `tweet.read` + `users.read` + `tweet.write` (or OAuth 1.0a UserToken). Page warning: quote-posting requires Enterprise, "not available on self-serve (pay-per-use) tiers".
5. `docs.x.com/x-api/getting-started/getting-access` (live): Bearer Token = app-only, read-only public data; posting requires OAuth 2.0 user context (or Access Token & Secret for own-account bots).

The task brief's historical "~500 posts/month app level / 1500 user level" figures belong to the retired legacy Free tier; no live official page documents them today, so per the no-unverified-claims rule they were CUT (doc says only that the historical quota-based free tier was replaced Feb 6, 2026, citing the changelog).

## Other platforms verified (live content fetch)

- **LinkedIn** `learn.microsoft.com/.../getting-access` (updated 2026-06-03): `w_member_social` is an Open Permission — "Post, comment and like posts on behalf of an authenticated member" — self-service via Products tab, no LinkedIn review. `.../authorization-code-flow` (updated 2026-05-15): "access tokens are issued with a 60-day lifespan"; reveals Developer Portal **Token Generator** (`linkedin.com/developers/tools/oauth/token-generator`) for manual token creation — added to doc as the easy console path. Redirect URLs must be absolute HTTPS.
- **TikTok** `developers.tiktok.com/doc/content-posting-api-get-started` (last updated Aug 4, 2026): requires Content Posting API product + Direct Post configuration + `video.publish` scope approved for app AND authorized by user; "All content posted by unaudited clients will be restricted to private viewing mode" → separate audit at developers.tiktok.com/application/content-posting-api. `.../getting-started-create-an-app`: signup → Manage apps → Connect an app; Client key/secret; URL properties verification; review with demo videos (max 5 × 50 MB); statuses Draft/In review/Live/Not approved; Sandbox mode. Review SLA: not documented → doc says "plusieurs jours à quelques semaines" honestly.
- **Bluesky** `atproto.com/specs/xrpc` (live): app passwords "create and revoke... separate from their primary password", format `xxxx-xxxx-xxxx-xxxx`, restricted permissions preventing destructive actions. Settings URL bsky.app/settings/app-passwords.
- **Nostr** NIP-01 (live): keypair + Schnorr signatures secp256k1; kind:1 text note via NIP-10. NIP-19 (live): `npub`/`nsec` bech32 encodings for display. Task 27 generates + quarantines keypair; owner only keeps backup.

## Grep asserts (docs/social-setup.md)

All 6 secret names present (3 occurrences each), each with its literal `wrangler secret put` command (1 each):
X_BEARER, LINKEDIN_ACCESS_TOKEN, TIKTOK_ACCESS_TOKEN, BLUESKY_HANDLE, BLUESKY_APP_PASSWORD, NOSTR_NSEC.

All 5 platform names present: X (Twitter) 1, LinkedIn 10, TikTok 10, Bluesky 8, Nostr 8.

## Cited-URL curl verification

`curl -sIL -o /dev/null -w "%{http_code}"` (HEAD) results:

```
200 https://docs.x.com/x-api/getting-started/pricing
200 https://docs.x.com/overview
200 https://docs.x.com/changelog
200 https://docs.x.com/x-api/posts/create-post
200 https://docs.x.com/x-api/getting-started/getting-access
200 https://devcommunity.x.com/t/x-api-v2-update-addressing-llm-generated-spam/257909
200 https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025
200 https://console.x.com
200 https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
200 https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
200 https://www.linkedin.com/developers/
200 https://www.linkedin.com/developers/tools/oauth/token-generator
404 https://developers.tiktok.com/doc/content-posting-api-get-started        (HEAD rejected)
404 https://developers.tiktok.com/doc/getting-started-create-an-app          (HEAD rejected)
404 https://developers.tiktok.com/application/content-posting-api            (HEAD rejected)
404 https://developers.tiktok.com/signup                                     (HEAD rejected)
200 https://atproto.com/specs/xrpc
404 https://bsky.app/settings/app-passwords                                  (HEAD rejected)
200 https://github.com/nostr-protocol/nips/blob/master/01.md
200 https://github.com/nostr-protocol/nips/blob/master/19.md
```

TikTok/bsky pages are SPAs that answer 404 to HEAD; re-verified with GET (`curl -sL`, browser UA):

```
GET 200 https://developers.tiktok.com/doc/content-posting-api-get-started
GET 200 https://developers.tiktok.com/doc/getting-started-create-an-app
GET 401 https://developers.tiktok.com/application/content-posting-api   (login-gated application portal; URL cited by TikTok's own docs)
GET 200 https://developers.tiktok.com/signup
GET 200 https://bsky.app/settings/app-passwords
```

The 401 on the audit-application URL is expected (requires a logged-in developer session); the fact it backs — "unaudited clients post in private mode; apply for audit at this URL" — is sourced from the content-posting-api-get-started page (200 GET). The doc's source table records these statuses honestly rather than claiming uniform 200s.

## Residual risk / notes for tasks 38–40

- `X_BEARER` is canonical but READ-ONLY; X posting additionally needs a user-context token (OAuth 2.0 `tweet.read`+`users.read`+`tweet.write` or OAuth 1.0a) — task 38 must define that secret name.
- X posts containing URLs cost \$0.20 (13× the base rate) — budget-relevant if X is ever enabled, since FrancePassoire posts link back to the site.
- LinkedIn tokens expire after 60 days; task 39 must schedule renewal.
- TikTok unaudited → posts stay private until the separate audit passes.
