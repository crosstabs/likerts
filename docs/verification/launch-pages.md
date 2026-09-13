# Public launch page verification

2026-09-13, local build served at `http://127.0.0.1:4338`. This is local rendered evidence; production verification must be recorded separately after deployment.

- `npm run check` in `control-plane`: 20 tests passed and static build completed. Build checks ensure the restored `/downloads/` contains only its current installation index, never historical pre-community tarballs.
- Codex in-app browser: preview disclosure rendered at desktop 1280×720; installation page and pre-sign-in disclosure rendered at mobile 390×844. Screenshots reviewed in the launch task showed readable text, no overlap/clipping and working navigation. Viewport reset after responsive testing.
- Preview → Install → mobile Menu → Docs succeeded. Copying the npm Web command changed its control to “Copied” and announced “Code copied to clipboard.”
- Homepage sample: focused the first rating, used four right-arrow presses to select 5, then Tab/Enter submitted. Sample showed rating 5 and explicitly said nothing was sent or stored; Enter on Try again reset the form and focus to the first rating.
- Browser warning/error log was empty for these pages and interactions. No blank page or framework error overlay appeared.
- The local `/app/` build intentionally has no Clerk key and says sign-in is unconfigured. This check proves the disclosure is visible before sign-in; it does not prove hosted authentication or the fresh hosted-account flow (H01).
- Current local HTML targets and API-reference anchors used by the preview/install pages were checked against source. The Next.js production build and browser checks passed locally and in PR #18 CI; the example uses a real local memory API while the separate Compose checks cover PostgreSQL durability.

## Production verification

2026-09-13, source `fe7588fabf2ee596a963ed943764021084f7d49e` from [PR #18](https://github.com/crosstabs/likerts/pull/18); [both required PR checks passed](https://github.com/crosstabs/likerts/actions/runs/34728128535). Vercel production deployment `dpl_FCHo7z6Q1edbwuSNCPeoMe9iX98V`, [deployment URL](https://likerts-9mt0wnasu-crosstabs.vercel.app), aliased to [likerts.com](https://likerts.com).

- Live HTTP content checks passed for `/preview`, `/downloads`, `/docs`, `/app`, `/demo`, `/sitemap.xml` and `/robots.txt`. Docs include the Compose/self-host guide, Next.js example and real recording; main CTA targets and native/Web section anchors resolve.
- Historical `/downloads/likerts-web-0.0.3.tgz` and `/downloads/likerts-cli-source-0.1.0.tar.gz` return 404. The current release remains on GitHub/npm; old website archives were not republished.
- Recording, poster, captions and social image return 200.
- Codex in-app browser at desktop 1280×720 and mobile 390×844: live preview disclosure and installation page are readable; mobile Menu → Docs works, npm copy announces success, and hosted data/support disclosure is visible before the Clerk sign-in form. Reviewed screenshots showed no clipping or layout overlap. Temporary viewport override reset.
- Homepage keyboard rating selection, sample submit, reset and focus restoration passed; the sample explicitly says nothing was sent or stored. Browser warning/error logs were empty for the checked interactions.
- This does not establish a fresh hosted account/session (H01), Firefox/WebKit coverage, native device behavior, active alerts or managed backup/recovery. The sign-in form rendering is not an authenticated lifecycle test.
