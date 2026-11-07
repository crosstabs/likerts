# Likerts game website

The existing Likerts game homepage, artwork and support page are preserved. This project now builds only the game marketing pages. It has no account service, survey SDK, export store, legacy monitor or data API.

Run `npm ci`, `npm test`, then `npm run build`. Vercel Root Directory is `control-plane`; build output is `dist`. The build refuses an unassigned live-game redirect target. `vercel.json` redirects `/play` and its descendants to the assigned Render HTTPS origin with temporary 307 redirects, preserving query parameters. Actual game HTTP and WebSocket traffic stays on that Render origin; no WebSocket proxy or cross-origin game API is introduced.

Obsolete product pages and API functions are absent and return404 with a game-only noindex error page. No replacement server function or data API is introduced. Git history preserves the former implementation. Retiring these routes does not delete historical database, identity, object-store or monitoring data.

Before promotion, verify the public Play link, a query-bearing room link, a full hosted game, the footer and all retired endpoints. The public support recipient remains the existing `support@crosstabs.com`; no mailbox or delivery guarantee is created by this source change.
