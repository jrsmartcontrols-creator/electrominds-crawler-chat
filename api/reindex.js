// /api/reindex.js
// Reindexa productos de Electrominds desde los sitemaps y deja un índice en memoria.
// Más defensivo: parsing de URL seguro, fallbacks de sitemap y timeouts controlados.

const ORIGIN = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${ORIGIN}/sitemap.xml`;
const FALLBACK_SITEMAPS = [
  `${ORIGIN}/store-products-sitemap.xml`,
  `${ORIGIN}/pages-sitemap.xml`,
];

const UA = "ElectromindsCrawler/1.1 (+https://electrominds.com.co)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function okJson(res, data, status = 200) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(data));
}

function norm(s = "") {
  return String(s).normalize("NFKC").replace(/\s+/g, " ").trim();
}

async function fetchText(url, { timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const rsp = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status} ${url}`);
    return await rsp.text();
  } finally {
    clearTimeout(t);
  }
}

function parseXmlLocs(xml) {
  const out = [];
  const rx = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = rx.exec(xml))) out.push(m[1]);
  return out;
}

function pick(html, name, attr = "content") {
  const rx = new RegExp(
    `<meta[^>]+(?:property|name)=[\\"']${name}[\\"'][^>]*${attr}=[\\"']([^\\"]+)[\\"'][^>]*>`,
    "i"
  );
  const m = html.match(rx);
  return m ? m[1] : "";
}

function pickTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1] : "";
}

function isProduct(u) {
  return /\/product-page\//i.test(u);
}

async function safePageToDoc(url) {
  try {
    const html = await fetchText(url, { timeout: 15000 });
    const title = norm(pick("","")) || norm(pickTitle(html)); // fallback
    const ogt = norm(pick(html, "og:title")) || norm(pickTitle(html));
    const finalTitle = ogt || title;
    if (!finalTitle) return null;

    const image = pick(html, "og:image") || pick(html, "twitter:image") || null;
    return { title: finalTitle, url, image, price: null, cats: [] };
  } catch {
    return null; // saltamos errores de página
  }
}

async function getSitemaps() {
  try {
    const xml = await fetchText(SITEMAP_INDEX, { timeout: 12000 });
    const locs = parseXmlLocs(xml);
    // prioriza productos
    return [
      ...locs.filter((l) => /store-products-sitemap/i.test(l)),
      ...locs.filter((l) => !/store-products-sitemap/i.test(l)),
    ];
  } catch {
    return FALLBACK_SITEMAPS;
  }
}

async function buildIndex({ max = 120 } = {}) {
  const started = Date.now();
  const sitemaps = await getSitemaps();

  const urls = [];
  for (const sm of sitemaps) {
    try {
      const xml = await fetchText(sm, { timeout: 12000 });
      const locs = parseXmlLocs(xml).filter(isProduct);
      for (const u of locs) {
        urls.push(u);
        if (urls.length >= max) break;
      }
      if (urls.length >= max) break;
    } catch {
      // ignoramos ese sitemap
    }
  }

  const docs = [];
  let i = 0;
  const CONC = Math.min(4, urls.length); // más conservador para evitar 500/timeout

  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const d = await safePageToDoc(urls[idx]);
      if (d) docs.push(d);
      await sleep(10);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  globalThis.__INDEX = { ts: Date.now(), docs, version: 4 };
  return { docs, taken: Date.now() - started };
}

export default async function handler(req, res) {
  try {
    const u = new URL(req.url || "", "http://localhost"); // base segura
    const max = Math.max(1, Math.min(300, Number(u.searchParams.get("max")) || 120));

    const { docs, taken } = await buildIndex({ max });
    okJson(res, {
      ok: true,
      count: docs.length,
      sample: docs.slice(0, 3).map((d) => ({ title: d.title, url: d.url, image: d.image })),
      taken,
      updatedAt: Date.now(),
    });
  } catch (err) {
    okJson(res, { ok: false, code: "REINDEX_FAILED", error: String(err?.message || err) }, 500);
  }
}


