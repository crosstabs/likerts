# Web engine, RTL and Markdown verification

The flow under test is the Web SDK host → keyboard input → optional RTL page navigation → one real local API response → renderer cleanup. It reuses `sdks/web/test/browser-server.mjs`, also used by the original Chromium smoke. No SDK implementation is duplicated and no runtime/package version changed.

## Run the engine checks

From the repository root, install the existing pinned SDK dependencies and their browser runtimes:

```sh
npm --prefix sdks/web ci
node sdks/web/node_modules/playwright/cli.js install --with-deps chromium firefox webkit
bash scripts/check-web-browsers.sh
```

On macOS, `install chromium firefox webkit` is sufficient; `--with-deps` is intended for Linux system libraries. The check requires the repository's Rust toolchain, Node.js, npm and supported Playwright runtimes. It builds the real Rust API and SDK before testing. Each case has its own loopback API with disposable memory storage and a generated development credential. The management credential remains inside the fixture server. Browser/server processes and temporary backend data are removed after each case.

`LIKERTS_BROWSER_ENGINES=firefox,webkit bash scripts/check-web-browsers.sh` selects only the new engines. Setup failures (missing/unsupported browser runtime or fixture startup) are reported as `SETUP_FAILED` with exit 2; assertion failures are `BEHAVIOR_FAILED` with exit 1. Neither is recorded as a pass. All cases are attempted, with per-engine diagnostics, screenshots and `results.json` written to a temporary directory printed at the end. Set `LIKERTS_BROWSER_EVIDENCE_DIR` to an explicit location outside the repository to retain evidence elsewhere.

The original focused command remains `bash scripts/check-web-browser.sh`.

## RTL example and ownership

After building through either check, launch `node sdks/web/test/browser-server.mjs --rtl` from a shell with Cargo available. Open its printed loopback URL. Stop it with Ctrl-C. This synthetic example has a choice and text question on page one, a scale question on page two, and Back/Next navigation.

Survey authors own the question titles, labels and options. The host supplies SDK UI messages such as Next, Back, Submit and submitted status through `mountSurvey` options. The host sets `dir="rtl"`, `lang="ar"`, and external CSS with logical properties; the SDK does not inject inline styling or translate text automatically. The Arabic sample explicitly says its translation is unreviewed. Choice prefixes support native numeric keyboard type-ahead. This is integration evidence, not Arabic localization certification.

The tests verify label/control association, direction inheritance, focus order, keyboard choice/text/scale entry, two-page navigation and retained answers, keyboard submission, one stored response, strict CSP, host styling, narrow-width overflow and clean unmount. On macOS WebKit, Option-Tab (`Alt+Tab`) follows Safari's all-controls keyboard behavior; Chromium/Firefox use Tab. Linux uses Tab. This distinction is recorded in each result.

CSP and console assertions run before screenshot preparation: Playwright itself can inject a caret stylesheet or empty style attributes while capturing an image. The fixture permits only same-origin script/style/connect/image resources, with no inline script/style allowance. A same-origin favicon response avoids Firefox's automatic favicon request producing an irrelevant CSP warning.

## Recorded local result

On 13 September 2026, macOS arm64 with pinned Playwright `1.63.0-alpha-2026-08-31` passed all six cases:

| Engine | Version | LTR | RTL with two pages | Stored responses per case |
| --- | --- | --- | --- | --- |
| Chromium | 153.0.8010.12 | Pass | Pass | 1 |
| Firefox | 155.0 | Pass | Pass | 1 |
| WebKit | 26.5 | Pass | Pass | 1 |

Desktop 1280×900 and narrow 390×844 screenshots were captured. Reviewed Firefox desktop and WebKit RTL narrow screenshots showed readable labels and no clipping/overlap. Page identity, rendered form, console/CSP, backend receipt/answers and unmount assertions passed. The API is a real local memory process; PostgreSQL durability remains covered by the separate Compose checks.

This is not physical iOS/Android testing, an authenticated hosted flow, screen-reader testing or a claim of full accessibility compliance. Narrow desktop-engine viewports do not substitute for device Safari/Chrome, OS keyboards or assistive technologies. Ubuntu execution remains a separate CI result until that job actually passes.

## Offline Markdown file-target check

```sh
node --test scripts/check-markdown-links.test.mjs
node scripts/check-markdown-links.mjs
```

The dependency-free checker scans root Markdown and maintained documentation beneath `docs`, `infrastructure`, `sdks`, `tools`, `examples`, `backend`, `contracts` and `control-plane`. It resolves relative file targets against each document, supports URL-encoded filenames and file fragments, and reports document/line/target before exiting nonzero on broken targets. External URLs, fragment-only links, inline images, fenced/inline code and HTML comments are outside the check. Frozen release archives, generated/build output and private directories are explicitly excluded. This checks file existence, not heading anchors, image assets, HTML links or remote availability.

Focused fixtures cover encoded names, angle destinations, filenames containing parentheses/hash, reference definitions, ignored content and directories, missing targets, and actual CLI zero/nonzero exit behavior. The maintained-doc scan passed with zero broken file targets; counts vary as the repository grows. Add the two commands above to contribution/CI checks without introducing a network crawler.
