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
  mcp: { label: "MCP tool call", code: `Tool: usage_get
Arguments: {}

Connect a scoped service credential first.
See the Codex and Claude Code setup guide.` },
  cli: { label: "CLI · credential supplied through your environment", code: `export LIKERTS_API_URL=https://likerts-api.onrender.com
# Supply LIKERTS_TOKEN through your secret manager.
likerts call usage_get

# Create a survey from the quickstart JSON.
likerts call surveys_create --input survey-create.json` },
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
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => activate(tab));
  tab.addEventListener("keydown", event => {
    const positions = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (!(event.key in positions)) return;
    event.preventDefault();
    const next = tabs[positions[event.key]]; activate(next); next.focus();
  });
}
