// /api/reindex.js
// Reindexa páginas públicas de Electrominds y deja un índice compacto en memoria
// Seguro con caracteres raros, timeouts y sitemap por partes.

const ORIGIN = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${ORIGIN}/sitemap.xml`;
const USER_AGENT =
  "ElectromindsCrawler/1.0 (+https://electrominds.com.co) simple-bot";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function okJson(res, data, status = 200) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(data));
}

function normTxt(s = "") {
  return String(s)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const rsp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status} ${url}`);
    return await rsp.text();
  } finally {
    clearTimeout(t);
  }
}

function pickMeta(html, name, attr = "content") {
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

function parseXmlLocs(xml) {
  const locs = [];
  const rx = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = rx.exec(xml))) locs.push(m[1]);
  return locs;
}

function onlyProductPages(url) {
  // ajusta si quieres incluir más tipos
  return /\/product-page\//i.test(url);
}

async function safePageToDoc(url, wantText) {
  try {
    const html = await fetchText(url);
    const title =
      normTxt(pickMeta(html, "og:title")) || normTxt(pickTitle(html));
    const image = pickMeta(html, "og:image") || pickMeta(html, "twitter:image");
    const cats = []; // si luego quieres extraer categorías, aquí
    const price = null; // si hay marcado de precio, se podría extraer más tarde
    const text = wantText
      ? normTxt(
          (html.match(/<p[^>]*>(.*?)<\/p>/gis) || [])
            .map((x) => x.replace(/<[^>]*>/g, " "))
            .join(" ")
        )
      : undefined;

    return { title, url, image, price, cats, ...(wantText ? { text } : {}) };
  } catch (e) {
    // ignoramos páginas que fallen
    return null;
  }
}

async function getAllSitemapUrls() {
  // lee el índice y devuelve lista de sitemap hijos
  const xml = await fetchText(SITEMAP_INDEX);
  const locs = parseXmlLocs(xml);
  // Prioriza el de productos si existe
  const sorted = [
    ...locs.filter((l) => /store-products-sitemap/i.test(l)),
    ...locs.filter((l) => !/store-products-sitemap/i.test(l)),
  ];
  return sorted;
}

async function buildIndex({ max = 120, full = false } = {}) {
  const started = Date.now();
  const sitemaps = await getAllSitemapUrls();

  const urls = [];
  for (const sm of sitemaps) {
    try {
      const xml = await fetchText(sm);
      const locs = parseXmlLocs(xml).filter(onlyProductPages);
      for (const u of locs) {
        urls.push(u);
        if (urls.length >= max) break;
      }
      if (urls.length >= max) break;
    } catch {
      // ignoramos sitemap caídos
    }
  }

  // pequeña cola para no saturar
  const CONC = 6;
  const docs = [];
  let i = 0;

  async function worker() {
    while (i < urls.length) {

