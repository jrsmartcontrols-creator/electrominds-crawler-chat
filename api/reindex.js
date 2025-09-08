// api/reindex.js
// ----------------------------------------------------
// 1) Reindexa la web de Electrominds leyendo el sitemap.
// 2) Guarda un índice en memoria del proceso actual.
// 3) Exporta getIndex/queryIndex/hydrateIndex para /api/ask.
// 4) Incluye CORS.
// ----------------------------------------------------

/* --------------------------- CORS --------------------------- */
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* --------------------- Índice en memoria -------------------- */
function getStore() {
  if (!globalThis.EM_INDEX) {
    globalThis.EM_INDEX = { docs: [], updatedAt: 0 };
  }
  return globalThis.EM_INDEX;
}

export function getIndex() {
  return getStore();
}

function saveIndex(docs) {
  const store = getStore();
  store.docs = docs || [];
  store.updatedAt = Date.now();
  return store;
}

export function hydrateIndex(docs) {
  return saveIndex(Array.isArray(docs) ? docs : []);
}

/* --------------------- Utilidades crawling ------------------ */
const SITE = "https://www.electrominds.com.co";
const MAIN_SITEMAP = `${SITE}/sitemap.xml`;

function pLimit(n) {
  const q = [];
  let a = 0;
  const next = () => { a--; if (q.length) q.shift()(); };
  return fn => new Promise((resolve, reject) => {
    const run = () => {
      a++;
      Promise.resolve().then(fn).then(v => { next(); resolve(v); })
        .catch(e => { next(); reject(e); });
    };
    if (a < n) run(); else q.push(run);
  });
}

function textBetween(s, a, b) {
  const i = s.indexOf(a); if (i === -1) return "";
  const j = s.indexOf(b, i + a.length); if (j === -1) return "";
  return s.slice(i + a.length, j);
}
function cleanText(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/<[^>]+>/g, " ").trim();
}
function unique(arr) { return Array.from(new Set(arr)); }

/* ----------- Parseo sencillo de XML (tags <loc>) ------------ */
function extractLocs(xml) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/gi; let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return unique(out);
}

/* -------------- Detección de URLs de producto --------------- */
function isProductUrl(u) {
  return (
    u.includes("/product-page/") ||
    u.includes("/store-products") ||
    u.includes("/product/")
  );
}

/* --------- Extracción de datos desde HTML de producto -------- */
function parseProduct(html, url) {
  let title =
    textBetween(html, '<meta property="og:title" content="', '"') ||
    textBetween(html, "<title>", "</title>");
  title = cleanText(title);

  const desc = textBetween(html, '<meta name="description" content="', '"') || "";
  let text = cleanText(desc);

  let price = "";
  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ld) {
    try {
      const json = JSON.parse(m[1]);
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        if (node && (node["@type"] === "Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product")))) {
          if (node.description && !text) text = cleanText(node.description);
          const offers = node.offers || node.Offer || node.offer;
          const p = (offers && (offers.price || offers.lowPrice)) || node.price;
          if (p) price = String(p);
        }
      }
    } catch { /* ignore */ }
  }

  return { title: title || "Producto", url, price: price || null, text };
}

/* ------------------------ Crawler --------------------------- */
async function fetchText(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.text();
}

async function crawlSitemaps(maxPages = 200) {
  const root = await fetchText(MAIN_SITEMAP);
  const all = extractLocs(root);

  const sitemapUrls = [];
  const pageUrls = [];
  for (const loc of all) {
    if (loc.endsWith(".xml")) sitemapUrls.push(loc);
    else pageUrls.push(loc);
  }

  for (const sm of sitemapUrls) {
    try {
      const xml = await fetchText(sm);
      extractLocs(xml).forEach(u => pageUrls.push(u));
    } catch {}
  }

  const products = unique(pageUrls.filter(isProductUrl)).slice(0, maxPages);

  const limit = pLimit(6);
  const docs = [];
  await Promise.allSettled(products.map(u => limit(async () => {
    try {
      const html = await fetchText(u);
      docs.push(parseProduct(html, u));
    } catch {}
  })));

  return { docs, sitemapCount: sitemapUrls.length + 1 };
}

/* ---------------------- Búsqueda simple --------------------- */
function scoreDoc(doc, q) {
  const lc = q.toLowerCase();
  const has = s => s && s.toLowerCase().includes(lc);
  let s = 0;
  if (has(doc.title)) s += 2;
  if (has(doc.text)) s += 1;
  if (has(doc.url)) s += 0.5;
  return s;
}

export function queryIndex(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const { docs } = getStore();
  return docs
    .map(d => ({ ...d, _score: scoreDoc(d, q) }))
    .filter(d => d._score > 0)
    .sort((a, b) => b._score - a._score);
}

/* ------------------------- Handler -------------------------- */
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const max  = Math.max(1, Math.min(parseInt(req.query?.max ?? "200", 10) || 200, 1000));
    const full = String(req.query?.full ?? "0") === "1";

    const { docs, sitemapCount } = await crawlSitemaps(max);
    const store = saveIndex(docs);

    const payload = {
      ok: true,
      count: store.docs.length,
      sample: store.docs.slice(0, 3).map(({ title, url, price }) => ({ title, url, price })),
      sitemapCount,
      taken: docs.length,
      updatedAt: store.updatedAt
    };
    if (full) payload.docs = store.docs;

    return res.status(200).json(payload);
  } catch (err) {
    console.error("reindex.js error:", err);
    return res.status(200).json({
      ok: false,
      error: "REINDEX_ERROR",
      message: String(err?.message || err)
    });
  }
}
