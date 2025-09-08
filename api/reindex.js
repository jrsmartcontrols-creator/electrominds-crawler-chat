// /api/reindex.js
// Reindexa el sitio de Electrominds (Wix) leyendo el sitemap y cada página de producto.
// Extrae: título, precio (si existe), descripción breve, imagen y breadcrumbs (categorías).
// Guarda todo en memoria (global) para que /api/ask.js consulte rápido.

export const config = { runtime: "edge" };

const DOMAIN = "https://www.electrominds.com.co";
const SITEMAP_URL = `${DOMAIN}/sitemap.xml`;

// Memoria en frío (se comparte entre invocaciones mientras la función se mantenga viva)
function getStore() {
  globalThis.__EM_STORE__ ??= { docs: [], updatedAt: 0, byUrl: new Map() };
  return globalThis.__EM_STORE__;
}

// Utilidades
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

async function fetchText(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "ElectromindsBot/1.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === retries) throw e;
      await sleep(300 + 300 * i);
    }
  }
}

function pickMeta(html, prop, by = "property") {
  const re = new RegExp(`<meta[^>]*${by}\\s*=\\s*["']${prop}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const m = html.match(re);
  return m?.[1]?.trim() || "";
}

function stripTags(s = "") {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseJSONLDAll(html) {
  const out = [];
  const rx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = rx.exec(html))) {
    try {
      const json = JSON.parse(m[1]);
      if (Array.isArray(json)) out.push(...json);
      else out.push(json);
    } catch {}
  }
  return out;
}

function parseBreadcrumbs(html) {
  const cats = [];
  const nodes = parseJSONLDAll(html);
  for (const node of nodes) {
    if (node?.["@type"] === "BreadcrumbList" && Array.isArray(node.itemListElement)) {
      node.itemListElement.forEach(li => {
        const name = li?.item?.name || li?.name;
        if (name) cats.push(String(name));
      });
    }
  }
  return [...new Set(cats)];
}

function parseProductJSONLD(html) {
  const nodes = parseJSONLDAll(html);
  for (const node of nodes) {
    if (node?.["@type"] === "Product") return node;
  }
  return null;
}

function parseProduct(html, url) {
  // Título
  let title = pickMeta(html, "og:title") || pickMeta(html, "twitter:title") || stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || "");
  title = title.replace(/\s*\|\s*Electrominds\s*$/i, "").trim() || "Producto";

  // Descripción / texto
  let text = pickMeta(html, "description", "name") || pickMeta(html, "og:description") || "";
  if (!text) {
    const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    text = stripTags(m?.[1] || "");
  }

  // Imagen
  let image = pickMeta(html, "og:image") || pickMeta(html, "twitter:image");

  // Precio (si existe)
  let price = null;

  // JSON-LD Product
  const pld = parseProductJSONLD(html);
  if (pld) {
    if (!title && pld.name) title = String(pld.name);
    if (!image && pld.image) image = Array.isArray(pld.image) ? pld.image[0] : pld.image;
    if (!text && pld.description) text = String(pld.description);
    const offers = Array.isArray(pld.offers) ? pld.offers[0] : pld.offers;
    if (offers?.price) price = String(offers.price);
  }

  // Breadcrumbs → categorías
  const cats = parseBreadcrumbs(html);

  return { url, title, text, price, image, cats };
}

function extractLocsFromSitemap(xml) {
  // Toma <loc>...</loc> de sitemaps o sitemapindex
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());

  // Filtra URLs de productos (Wix suele usar /product-page/)
  return locs.filter(u =>
    /\/product-page\//i.test(u) || /store-products/i.test(u) || /pages-sitemap/i.test(u)
  );
}

async function getAllProductUrls() {
  const xml = await fetchText(SITEMAP_URL);
  const locs = extractLocsFromSitemap(xml);

  // Si el sitemap principal es un índice, cada loc es otro sitemap → expandimos
  const productUrls = [];
  if (locs.some(u => /sitemap\.xml$/i.test(u) || /sitemap/i.test(u))) {
    for (const sm of locs) {
      try {
        const x = await fetchText(sm);
        const urls = extractLocsFromSitemap(x);
        productUrls.push(...urls);
      } catch {}
    }
  } else {
    productUrls.push(...locs);
  }

  // Quitar duplicados y quedarnos solo con Electrominds
  return [...new Set(productUrls.filter(u => u.startsWith(DOMAIN)))];
}

async function reindex(max = 400) {
  const store = getStore();
  const urls = await getAllProductUrls();
  const target = urls.slice(0, max);

  // Concurrency simple
  const CONC = 6;
  let i = 0, ok = 0;
  const t0 = Date.now();

  const run = async () => {
    while (i < target.length) {
      const url = target[i++];
      try {
        const html = await fetchText(url);
        const doc = parseProduct(html, url);
        if (doc?.title) {
          store.byUrl.set(url, doc);
          ok++;
        }
        // Suavizar crawl
        await sleep(60);
      } catch {}
    }
  };

  const workers = Array.from({ length: CONC }, run);
  await Promise.all(workers);

  store.docs = [...store.byUrl.values()];
  store.updatedAt = Date.now();
  return { count: store.docs.length, ok, taken: Date.now() - t0, sitemapCount: urls.length };
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const full = searchParams.get("full") === "1" || searchParams.get("full") === "true";
    const max = clamp(parseInt(searchParams.get("max") || "400", 10) || 400, 1, 2000);

    if (full) {
      // Limpia y reindexa desde cero
      globalThis.__EM_STORE__ = { docs: [], updatedAt: 0, byUrl: new Map() };
    }

    const info = await reindex(max);
    const store = getStore();

    const sample = store.docs.slice(0, 3).map(({ title, url, price, image, cats }) => ({
      title, url, price: price ?? null, image: image ?? null, cats: cats ?? []
    }));

    return new Response(JSON.stringify({
      ok: true,
      count: store.docs.length,
      sample,
      sitemapCount: info.sitemapCount,
      taken: info.taken,
      updatedAt: store.updatedAt
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  }
}
