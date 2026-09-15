import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const checkOnly = process.argv.includes("--check");
const socialImage = "https://likerts.com/social-preview.png";
const socialImageAlt = "Likerts — open-source surveys embedded in web and mobile products.";

const pages = [
  {
    file: "public/index.html",
    canonical: "https://likerts.com/",
    title: "Likerts — Open-source in-app surveys",
    description: "Collect in-product feedback on web and mobile. Likerts is free, MIT-licensed survey infrastructure with SDKs, an API, MCP and a CLI. Self-host your data.",
    breadcrumb: "Home",
    home: true,
  },
  {
    file: "public/docs/index.html",
    canonical: "https://likerts.com/docs",
    title: "Likerts documentation",
    description: "Run Likerts, create a survey, and collect responses through API, MCP, CLI, or five SDKs.",
    breadcrumb: "Documentation",
    schemaType: "TechArticle",
  },
  {
    file: "public/docs/api/index.html",
    canonical: "https://likerts.com/docs/api",
    title: "Likerts API reference",
    description: "Browse the shared Likerts HTTP, MCP and CLI capability registry, required scopes and input examples.",
    breadcrumb: "API reference",
    schemaType: "TechArticle",
  },
  {
    file: "public/demo/index.html",
    canonical: "https://likerts.com/demo",
    title: "Likerts SDK demo — local sample mode",
    description: "Try the real Likerts Web SDK: conditional questions, ranking, matrix and constant-sum answers. Responses stay in local page memory.",
    breadcrumb: "SDK demo",
    schemaType: "WebPage",
  },
  {
    file: "public/downloads/index.html",
    canonical: "https://likerts.com/downloads",
    title: "Install Likerts",
    description: "Public npm packages, versioned CLI downloads and native SDK source installation.",
    breadcrumb: "Install",
    schemaType: "WebPage",
  },
  {
    file: "public/preview/index.html",
    canonical: "https://likerts.com/preview",
    title: "Likerts hosted reference preview",
    description: "What the optional hosted Likerts preview stores, supports and has yet to verify.",
    breadcrumb: "Hosted preview",
    schemaType: "WebPage",
  },
];

const cleanRoutes = ["/docs", "/docs/api", "/demo", "/downloads", "/preview", "/app", "/status"];
const auxiliaryPages = ["public/app/index.html", "public/status/index.html"];

function socialTags(page) {
  return [
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${page.canonical}" />`,
    '<meta property="og:site_name" content="Likerts" />',
    '<meta property="og:locale" content="en_US" />',
    `<meta property="og:title" content="${page.title}" />`,
    `<meta property="og:description" content="${page.description}" />`,
    `<meta property="og:image" content="${socialImage}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${socialImageAlt}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${page.title}" />`,
    `<meta name="twitter:description" content="${page.description}" />`,
    `<meta name="twitter:image" content="${socialImage}" />`,
    `<meta name="twitter:image:alt" content="${socialImageAlt}" />`,
  ].join("\n  ");
}

function structuredData(page) {
  if (page.home) {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": "https://likerts.com/#website",
          url: page.canonical,
          name: "Likerts",
          description: page.description,
          inLanguage: "en",
        },
        {
          "@type": "SoftwareApplication",
          "@id": "https://likerts.com/#software",
          url: page.canonical,
          name: "Likerts",
          description: page.description,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Web, iOS, Android",
          image: socialImage,
          codeRepository: "https://github.com/crosstabs/likerts",
          license: "https://github.com/crosstabs/likerts/blob/main/LICENSE",
          isAccessibleForFree: true,
        },
      ],
    };
  }

  const pageNode = {
    "@type": page.schemaType,
    "@id": `${page.canonical}#page`,
    url: page.canonical,
    name: page.title,
    description: page.description,
    inLanguage: "en",
    isPartOf: { "@id": "https://likerts.com/#website" },
  };
  if (page.schemaType === "TechArticle") {
    pageNode.headline = page.title;
    pageNode.author = { "@type": "Organization", name: "Likerts", url: "https://likerts.com/" };
  }

  const breadcrumbs = page.canonical === "https://likerts.com/docs/api"
    ? [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://likerts.com/" },
        { "@type": "ListItem", position: 2, name: "Documentation", item: "https://likerts.com/docs" },
        { "@type": "ListItem", position: 3, name: page.breadcrumb, item: page.canonical },
      ]
    : [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://likerts.com/" },
        { "@type": "ListItem", position: 2, name: page.breadcrumb, item: page.canonical },
      ];

  return {
    "@context": "https://schema.org",
    "@graph": [
      pageNode,
      { "@type": "BreadcrumbList", itemListElement: breadcrumbs },
    ],
  };
}

function normalize(html, page) {
  let output = html
    .replace(/\s*<meta\b[^>]*(?:property=["']og:[^"']+["']|name=["']twitter:[^"']+["'])[^>]*\/?\s*>/gi, "")
    .replace(/\s*<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<meta\b[^>]*name=["']description["'][^>]*\/?\s*>/i, () => `<meta name="description" content="${page.description}" />`)
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*\/?\s*>/i, () => `<link rel="canonical" href="${page.canonical}" />`)
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${page.title}</title>`);

  const head = `${socialTags(page)}\n  <script type="application/ld+json">${JSON.stringify(structuredData(page))}</script>`;
  output = output.replace(
    /(<link\b[^>]*rel=["']canonical["'][^>]*\/?\s*>)/i,
    `$1\n  ${head}`,
  );

  return normalizeLinks(output);
}

function normalizeLinks(html) {
  let output = html;
  for (const route of cleanRoutes) {
    output = output
      .replaceAll(`href="${route}/"`, `href="${route}"`)
      .replaceAll(`href="${route}/#`, `href="${route}#`);
  }
  return output;
}

const changed = [];
for (const page of pages) {
  const url = new URL(page.file, root);
  const current = await readFile(url, "utf8");
  const next = normalize(current, page);
  if (next !== current) {
    changed.push(page.file);
    if (!checkOnly) await writeFile(url, next);
  }
}

for (const file of auxiliaryPages) {
  const url = new URL(file, root);
  const current = await readFile(url, "utf8");
  const next = normalizeLinks(current);
  if (next !== current) {
    changed.push(file);
    if (!checkOnly) await writeFile(url, next);
  }
}

if (changed.length && checkOnly) {
  console.error(`SEO metadata is out of sync: ${changed.join(", ")}`);
  process.exitCode = 1;
} else if (!checkOnly) {
  console.log(`SEO metadata and links synchronized for ${pages.length + auxiliaryPages.length} public pages`);
}
