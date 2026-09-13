# Public launch page verification

2026-09-13, local build served at `http://127.0.0.1:4338`. This is local rendered evidence; production verification must be recorded separately after deployment.

- `npm run check` in `control-plane`: 20 tests passed and static build completed. Build checks ensure the restored `/downloads/` contains only its current installation index, never historical pre-community tarballs.
- Codex in-app browser: preview disclosure rendered at desktop 1280×720; installation page and pre-sign-in disclosure rendered at mobile 390×844. Screenshots reviewed in the launch task showed readable text, no overlap/clipping and working navigation. Viewport reset after responsive testing.
- Preview → Install → mobile Menu → Docs succeeded. Copying the npm Web command changed its control to “Copied” and announced “Code copied to clipboard.”
- Homepage sample: focused the first rating, used four right-arrow presses to select 5, then Tab/Enter submitted. Sample showed rating 5 and explicitly said nothing was sent or stored; Enter on Try again reset the form and focus to the first rating.
- Browser warning/error log was empty for these pages and interactions. No blank page or framework error overlay appeared.
- The local `/app/` build intentionally has no Clerk key and says sign-in is unconfigured. This check proves the disclosure is visible before sign-in; it does not prove hosted authentication or the fresh hosted-account flow (H01).
- Current local HTML targets and API-reference anchors used by the preview/install pages were checked against source. Required deployed-page checks and the Next.js example review remain part of L09/L14.
