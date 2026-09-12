const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".site-nav");
const closeNav = () => { navToggle?.setAttribute("aria-expanded", "false"); nav?.classList.remove("is-open"); };
navToggle?.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  nav?.classList.toggle("is-open", !expanded);
});
nav?.addEventListener("click", closeNav);
document.addEventListener("keydown", event => { if (event.key === "Escape" && navToggle?.getAttribute("aria-expanded") === "true") { closeNav(); navToggle.focus(); } });

const examples = {
  mcp: { label: "MCP · inspect your workspace", code: `Tool: usage_get
Arguments: {}

Use a scoped service credential.
See the Codex and Claude Code setup guide.` },
  cli: { label: "CLI · use your own deployment", code: `export LIKERTS_API_URL=http://127.0.0.1:8080
# Supply LIKERTS_TOKEN through your secret manager.
likerts call usage_get

# Create a survey from the quickstart JSON.
likerts call surveys_create --input control-plane/public/docs/survey-create.json` },
  api: { label: "HTTP API · create a survey", code: `POST /v1/surveys
Authorization: Bearer <management credential>
Content-Type: application/json

{
  "idempotencyKey": "survey-create-001",
  "title": "Checkout feedback",
  "questions": [{
    "id": "rating", "type": "scale",
    "label": "How was your experience?",
    "required": true, "min": 1, "max": 5
  }]
}` },
};
const code = document.getElementById("interface-code");
const label = document.getElementById("interface-label");
const panel = document.getElementById("interface-panel");
const tabs = [...document.querySelectorAll(".interface-tab")];
function activate(tab) {
  const example = examples[tab.dataset.interface];
  if (!example || !code || !label) return;
  for (const item of tabs) {
    const active = item === tab;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  }
  panel?.setAttribute("aria-labelledby", tab.id);
  label.textContent = example.label;
  code.textContent = example.code;
}

// This small preview is deliberately local. The full SDK renderer lives at /demo/.
const previewForm = document.getElementById("preview-form");
const previewComplete = document.getElementById("preview-complete");
const previewPayload = document.getElementById("preview-payload");
const previewStatus = document.getElementById("preview-status");
const previewReset = document.getElementById("preview-reset");
function submitPreview(event) {
  event?.preventDefault();
  if (!previewForm || !previewComplete || !previewPayload || !previewStatus || !previewForm.reportValidity()) return;
  const selected = previewForm.querySelector('input[name="rating"]:checked');
  if (!selected) return;
  previewPayload.textContent = JSON.stringify({ answers: { rating: Number(selected.value) } }, null, 2);
  previewForm.hidden = true;
  previewComplete.hidden = false;
  previewStatus.textContent = "Sample complete. Nothing was sent or stored.";
  previewReset?.focus();
}
previewForm?.addEventListener("submit", submitPreview);
document.getElementById("preview-submit")?.addEventListener("click", submitPreview);
previewReset?.addEventListener("click", () => {
  previewForm.reset();
  previewForm.hidden = false;
  previewComplete.hidden = true;
  previewPayload.textContent = "";
  previewStatus.textContent = "Interactive preview · stays in this browser.";
  previewForm.querySelector('input[name="rating"]')?.focus();
});
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => activate(tab));
  tab.addEventListener("keydown", event => {
    const positions = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (!(event.key in positions)) return;
    event.preventDefault();
    const next = tabs[positions[event.key]]; activate(next); next.focus();
  });
}
