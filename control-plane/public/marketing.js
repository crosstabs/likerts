const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".site-nav");

navToggle?.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  nav?.classList.toggle("is-open", !expanded);
});

nav?.addEventListener("click", () => {
  navToggle?.setAttribute("aria-expanded", "false");
  nav.classList.remove("is-open");
});

const examples = {
  mcp: { label: "Codex / Claude", code: `You  Create a three-question product feedback survey.\n\nAgent  ✓ Created survey “product-feedback”\n       ✓ Published version 1\n       ✓ Opened a collection\n       ✓ Returned a scoped collection credential` },
  cli: { label: "Rust CLI", code: `$ likerts survey create --file survey.json\n✓ survey product-feedback created\n\n$ likerts collection issue product-feedback --scope responses:write\n✓ credential issued; copy it now\n\n$ likerts usage\n1,000 response credits available` },
  api: { label: "HTTP API", code: `POST /v1/surveys\nX-Likerts-Workspace: wrk_demo\nAuthorization: Bearer ••••••••\n\n{\n  "title": "Product feedback",\n  "questions": [{ "type": "likert", "scale": 5 }]\n}\n\n201 Created` },
};

const code = document.getElementById("interface-code");
const label = document.getElementById("interface-label");
for (const tab of document.querySelectorAll(".interface-tab")) {
  tab.addEventListener("click", () => {
    const example = examples[tab.dataset.interface];
    if (!example || !code || !label) return;
    for (const item of document.querySelectorAll(".interface-tab")) {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    }
    label.textContent = example.label;
    code.textContent = example.code;
  });
}
