#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/scripts/dev-env.sh"
cd "$root"
command -v npx >/dev/null 2>&1
if [ "${LIKERTS_SKIP_BACKEND_BUILD:-0}" != "1" ]; then cargo build --manifest-path backend/Cargo.toml; fi
npm --prefix sdks/web ci
npm --prefix sdks/web run build
log="$(mktemp)"
node sdks/web/test/browser-server.mjs >"$log" 2>&1 &
fixture_pid=$!
session="likerts-web-$$"
pwcli="$root/sdks/web/node_modules/.bin/playwright-cli"
cleanup(){ "$pwcli" -s="$session" close >/dev/null 2>&1 || true; kill "$fixture_pid" >/dev/null 2>&1 || true; wait "$fixture_pid" >/dev/null 2>&1 || true; rm -f "$log"; }
trap cleanup EXIT
url=""
for _ in $(seq 1 100); do url="$(grep -E '^http://127\.0\.0\.1:[0-9]+$' "$log" | tail -1 || true)"; [ -n "$url" ] && break; sleep 0.05; done
if [ -z "$url" ]; then cat "$log"; exit 1; fi
"$pwcli" -s="$session" open "$url" >/dev/null
snapshot="$($pwcli -s="$session" snapshot)"
grep -q 'Checkout feedback' <<<"$snapshot"
grep -q 'Send response' <<<"$snapshot"
"$pwcli" -s="$session" run-code "async page => { await page.waitForSelector('form'); const form=page.locator('form'); if(await form.getAttribute('aria-labelledby')===null) throw new Error('missing aria-labelledby'); if(await form.getAttribute('aria-describedby')===null) throw new Error('missing aria-describedby'); if(!await form.evaluate(el=>el.classList.contains('likerts-form')&&el.classList.contains('customer-survey'))) throw new Error('missing styling hooks'); const rating=page.getByLabel('How was checkout?'); const comment=page.getByLabel('What should improve?'); await page.locator('body').focus(); await page.keyboard.press('Tab'); if(!await rating.evaluate(el=>el===document.activeElement)) throw new Error('first keyboard target is not rating'); await rating.selectOption('good'); await page.keyboard.press('Tab'); if(!await comment.evaluate(el=>el===document.activeElement)) throw new Error('second keyboard target is not comment'); await page.keyboard.type('Faster receipts'); await page.keyboard.press('Tab'); const submit=page.getByRole('button',{name:'Send response'}); if(!await submit.evaluate(el=>el===document.activeElement)) throw new Error('submit is not keyboard reachable'); await page.keyboard.press('Enter'); await page.locator('.likerts-status').filter({hasText:'Response sent'}).waitFor(); const result=await page.evaluate(()=>fetch('/result.json').then(r=>r.json())); if(result.acceptedResponses!==1) throw new Error('backend did not account one response'); if(await page.evaluate(()=>window.cspViolations.length)!==0) throw new Error('CSP violation'); if(!(await page.locator('#receipt').textContent())) throw new Error('missing accepted receipt'); }"
echo "PASS: Chromium keyboard submission used accessible labels and focus order, strict CSP, external host styling/localization, and a real accepted backend receipt."
