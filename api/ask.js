// /api/ask.js
// Busca en el índice (y si no existe, lo construye aquí mismo).
// Devuelve títulos, url e imagen (miniatura) y link de WhatsApp para asesor.

const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

function okJson(res, data, status = 200) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(data));
}

const STOP = new Set([
  "el","la","los","las","de","del","y","o","u","en","con","para","por","un","una","unos","unas",
  "a","al","lo","su","sus","es","que","se","sin"
]);

function tokens(s = "") {
  return String(s)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

function ensureIndexPresent() {
  const idx = globalThis.__INDEX;
  if (!idx || !Array.isArray(idx.docs) || idx.docs.length === 0) return false;
  return true;
}

// -------- Mini crawler (igual que en reindex, recortado) ----------
const ORIGIN = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${ORIGIN}/sitemap.xml`;
const USER_AGENT =
  "ElectromindsCrawler/1.0 (+https://electrominds.com.co) simple-bot";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
function parseXmlLocs(xml) {
  const locs = [];
  const rx = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = rx.exec(xml))) locs.push(m[1]);
  return locs;
}
function onlyProductPages(u){ return /\/product-page\//i.test(u); }
function pickMeta(html, name, attr="content"){
  const rx = new RegExp(`<meta[^>]+(?:property|name)=[\\"']${name}[\\"'][^>]*${attr}=[\\"']([^\\"]+)[\\"'][^>]*>`, "i");
  const m = html.match(rx); return m? m[1] : "";
}
function pickTitle(html){ const m = html.match(/<title[^>]*>([^<]+)<\/title>/i); return m? m[1]:""; }
function normTxt(s=""){ return String(s).normalize("NFKC").replace(/\s+/g," ").trim(); }

async function safePageToDoc(url) {
  try {
    const html = await fetchText(url);
    const title =
      normTxt(pickMeta(html, "og:title")) || normTxt(pickTitle(html));
    const image = pickMeta(html, "og:image") || pickMeta(html, "twitter:image");
    return { title, url, image: image || null, price: null, cats: [] };
  } catch { return null; }
}

async function buildIndexQuick({ max = 120 } = {}) {
  const xml = await fetchText(SITEMAP_INDEX);
  const smaps = parseXmlLocs(xml);
  const ordered = [
    ...smaps.filter((l) => /store-products-sitemap/i.test(l)),
    ...smaps.filter((l) => !/store-products-sitemap/i.test(l)),
  ];

  const urls = [];
  for (const sm of ordered) {
    try {
      const sx = await fetchText(sm);
      const locs = parseXmlLocs(sx).filter(onlyProductPages);
      for (const u of locs) { urls.push(u); if (urls.length >= max) break; }
      if (urls.length >= max) break;
    } catch {}
  }

  const docs = [];
  let i = 0, CONC = 6;
  async function worker(){
    while (i < urls.length) {
      const idx = i++;
      const d = await safePageToDoc(urls[idx]);
      if (d && d.title) docs.push(d);
      await sleep(10);
    }
  }
  await Promise.all(Array.from({length: Math.min(CONC, urls.length)}, worker));
  globalThis.__INDEX = { ts: Date.now(), docs, version: 3 };
  return docs;
}
// -------------------------------------------------------------------

function scoreDoc(doc, qTokens) {
  // título pesa más; si un token aparece, sumamos
  const titleTks = tokens(doc.title).join(" ");
  let s = 0;
  for (const t of qTokens) {
    if (titleTks.includes(t)) s += 3;
    if (doc.cats && doc.cats.join(" ").includes(t)) s += 1;
  }
  // mini bonus si todos los tokens están
  const allIn = qTokens.every((t) => titleTks.includes(t));
  if (allIn) s += 2;
  return s;
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.ur
