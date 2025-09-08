// api/reindex.js
// ----------------------------------------------------
// 1) Reindexa la web de Electrominds (Wix) leyendo el
//    sitemap y construyendo un índice en memoria.
// 2) Expone helpers getIndex/queryIndex para /api/ask.
// 3) Incluye CORS para permitir llamadas desde Wix.
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
  store.docs = docs;
  store.updatedAt = Date.now();
  return store;
}

/* --------------------- Utilidades crawling ------------------ */
const SITE = "https://www.electrominds.com.co";
const MAIN_SITEMAP = `${SITE}/sitemap.xml`;

// pequeñísimo limit de concurrencia
function pLimit(n) {
  const q = [];
  let a = 0;
  const next = () => {
    a--;
    if (q.length) q.shift()();
  };
  return fn =>
    new Promise((resolve, reject) => {
      const run = () => {
        a++;
        Promise.resolve()
          .then(fn)
          .then(v => {
            next();
            resolve(v);
          })
          .catch(e => {
            next();
            reject(e);
          });
      };
      if (a < n) run();
      else q.push(run);
    });
}

function textBetween(s, a, b) {
  const i = s.indexOf(a);
  if (i === -1) return "";
  const j = s.indexOf(b, i + a.length);
  if (j === -1) return "";
  return s.slice(i + a.length, j);
}

function cleanText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

function unique(arr) {
  return Array.from(new Set(arr));
}

/* ----------- Parseo muy simple de XML (loc tags) ----------- */
function extractLocs(xml) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    locs.push(m[1].trim());
  }
  return unique(locs);
}

/* -------------- Detección de URLs de producto --------------- */
function isProductUrl(u) {
  // Wix genera varias rutas; capturamos las comunes
  return (
    u.includes("/product-page/") ||
    u.includes("/store-products") ||
    u.includes("/product/")
  );
}

/* --------- Extracción de datos desde HTML de producto -------- */
function parseProduct(html, url) {
  // título
  let title =
    textBetween(html, '<meta property="og:title" content="', '"') ||
    textBetween(html, "<title>", "</title>");
  title = cleanText(title);

  // descripción
  const desc =
    textBetween(html, '<meta name="description" content="', '"') || "";
  let text = cleanText(desc);

  // JSON-LD de producto para precio (si existe)
  let price = "";
  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ld) {
    try {
      const json = JSON.parse(m[1]);
      // puede venir como objeto o array
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        if (
          node &&
          (node["@type"] === "Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product")))
        ) {
          if (node.description && !text) text = cleanText(node.description);
          const offers = node.offers || node.Offer || node.offer;
          const p = (offers && (offers.price || offers.lowPrice)) || node.price;
          if (p) price = String(p);
        }
      }
    } catch (_) {}
  }

  return {
    title: title || "Producto",
    url,
    price: price || null,
    text
  };
}

/* ------------------------ Crawler --------------------------- */
async function fetchText(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.text();
}

async function crawlSitemaps(maxPages = 200) {
  // 1) leer sitemap principal
  const root = await fetchText(MAIN_SITEMAP);
  const allCandidates = extractLocs(root);

  // 2) expandir (algunos locs son sitemaps de secciones)
  const sitemapUrls = [];
  const pageUrls = [];

  for (const loc of allCandidates) {
    if (loc.endsWith(".xml")) sitemapUrls.push(loc);
    else pageUrls.push(loc);
  }

  // fetch de sitemaps secundarios
  for (const sm of sitemapUrls) {
    try {
      const xml = await fetchText(sm);
      extractLocs(xml).forEach(u => pageUrls.push(u));
    } catch (_) {}
  }

  // Filtrar productos
  const productUrls = unique(pageUrls.filter(isProductUrl)).slice(0, maxPages);

  // 3) recorrer productos con concurrencia limitada
  const limit = pLimit(6);
  const docs = [];
  const tasks = productUrls.map(u =>
    limit(async () => {
      try {
        const html = await fetchText(u);
        const doc = parseProduct(html, u);
        docs.push(doc);
      } catch (_) {
        // ignorar páginas que fallen
      }
    })
  );
  await Promise.allSettled(tasks);

  return { docs, sitemapCount: sitemapUrls.length + 1 };
}

/* ---------------------- Búsqueda simple --------------------- */
// coincidencia por tokens (muy simple pero efectivo)
function scoreDoc(doc, q) {
  const hay = (s) => s && s.toLowerCase().includes(q);
  const lc = q.toLowerCase();
  let s = 0;
  if (hay(doc.title)) s += 2;
  if (hay(doc.text)) s += 1;
  if (hay(doc.url)) s += 0.5;
  return s;
}

export function queryIndex(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const { docs } = getStore();
  const scored = docs
    .map(d => ({ ...d, _score: scoreDoc(d, q) }))
    .filter(d => d._score > 0)
    .sort((a, b) => b._score - a._score);
  return scored;
}

/* ------------------------- Handler -------------------------- */
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // ?max=40 (por defecto 200)
    const max = Math.max(1, Math.min(parseInt((req.query?.max ?? "200"), 10) || 200, 1000));

    const { docs, sitemapCount } = await crawlSitemaps(max);
    const store = saveIndex(docs);

    // respuesta breve + muestra
    return res.status(200).json({
      ok: true,
      count: store.docs.length,
      sample: store.docs.slice(0, 3).map(({ title, url, price }) => ({ title, url, price })),
      sitemapCount,
      taken: docs.length,
      updatedAt: store.updatedAt
    });
  } catch (err) {
    console.error("reindex.js error:", err);
    return res.status(200).json({
      ok: false,
      error: "REINDEX_ERROR",
      message: String(err?.message || err)
    });
  }
}
