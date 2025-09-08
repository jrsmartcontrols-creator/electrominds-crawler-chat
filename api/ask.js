// /api/ask.js
// Busca en el índice (si no existe, lo crea rápido) y responde con título/url/imagen.

const WHATSAPP =
  "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

function okJson(res, data, status = 200) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(data));
}

const STOP = new Set([
  "el","la","los","las","de","del","y","o","u","en","con","para","por","un","una","unos","unas",
  "a","al","lo","su","sus","es","que","se","sin"
]);

function toks(s = "") {
  return String(s)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

function hasIndex() {
  const idx = globalThis.__INDEX;
  return !!(idx && Array.isArray(idx.docs) && idx.docs.length);
}

// ------- mini indexador rápido (idéntico enfoque que en reindex) -------
const ORIGIN = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${ORIGIN}/sitemap.xml`;
const FALLBACK_SITEMAPS = [
  `${ORIGIN}/store-products-sitemap.xml`,
  `${ORIGIN}/pages-sitemap.xml`,
];
const UA = "ElectromindsCrawler/1.1 (+https://electrominds.com.co)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url, { timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const rsp = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status} ${url}`);
    return await rsp.text();
  } finally { clearTimeout(t); }
}
function parseXmlLocs(xml){ const out=[]; const rx=/<loc>\s*([^<\s]+)\s*<\/loc>/gi; let m; while((m=rx.exec(xml))) out.push(m[1]); return out; }
function isProduct(u){ return /\/product-page\//i.test(u); }
function norm(s=""){ return String(s).normalize("NFKC").replace(/\s+/g," ").trim(); }
function pick(html,name,attr="content"){
  const rx=new RegExp(`<meta[^>]+(?:property|name)=[\\"']${name}[\\"'][^>]*${attr}=[\\"']([^\\"]+)[\\"'][^>]*>`,"i");
  const m=html.match(rx); return m? m[1] : "";
}
function pickTitle(html){ const m=html.match(/<title[^>]*>([^<]+)<\/title>/i); return m? m[1]:""; }

async function safePageToDoc(url){
  try{
    const html=await fetchText(url,{timeout:15000});
    const title = norm(pick(html,"og:title")) || norm(pickTitle(html));
    if(!title) return null;
    const image = pick(html,"og:image") || pick(html,"twitter:image") || null;
    return { title, url, image, price:null, cats:[] };
  }catch { return null; }
}

async function buildQuick(max=120){
  let smaps;
  try {
    const xml = await fetchText(SITEMAP_INDEX, { timeout: 12000 });
    const locs = parseXmlLocs(xml);
    smaps = [
      ...locs.filter((l)=>/store-products-sitemap/i.test(l)),
      ...locs.filter((l)=>! /store-products-sitemap/i.test(l)),
    ];
  } catch { smaps = FALLBACK_SITEMAPS; }

  const urls=[];
  for(const sm of smaps){
    try{
      const sx=await fetchText(sm,{timeout:12000});
      const locs=parseXmlLocs(sx).filter(isProduct);
      for(const u of locs){ urls.push(u); if(urls.length>=max) break; }
      if(urls.length>=max) break;
    }catch{/* ignora */}
  }

  const docs=[]; let i=0; const CONC=Math.min(4, urls.length);
  async function worker(){
    while(i<urls.length){
      const d=await safePageToDoc(urls[i++]);
      if(d) docs.push(d);
      await sleep(10);
    }
  }
  await Promise.all(Array.from({length:CONC}, worker));
  globalThis.__INDEX = { ts: Date.now(), docs, version: 4 };
  return docs;
}
// ----------------------------------------------------------------------

function score(doc, qTks){
  const title = toks(doc.title).join(" ");
  let s=0;
  for(const t of qTks){
    if(title.includes(t)) s+=3;
  }
  if(qTks.every((t)=>title.includes(t))) s+=2;
  return s;
}

export default async function handler(req, res) {
  try {
    const u = new URL(req.url || "", "http://localhost");
    const q = (u.searchParams.get("q") || "").trim();
    const page = Math.max(1, Number(u.searchParams.get("page")) || 1);
    const limit = Math.max(1, Math.min(50, Number(u.searchParams.get("limit")) || 12));

    if (!q) return okJson(res, { ok:false, message:"Falta parámetro q", contact_url: WHATSAPP }, 400);

    if (!hasIndex()) await buildQuick(120);
    const idx = globalThis.__INDEX;
    if (!hasIndex()) {
      return okJson(res, {
        ok:true, found:false, total:0, page, pages:1, limit,
        message:"Índice vacío. Abre /api/reindex primero para cargar el contenido.",
        contact_url: WHATSAPP, results:[]
      });
    }

    const qTks = toks(q);
    const ranked = idx.docs
      .map((d)=>({d, s:score(d, qTks)}))
      .filter((x)=>x.s>0)
      .sort((a,b)=>b.s-a.s)
      .map((x)=>x.d);

    const total = ranked.length;
    const pages = Math.max(1, Math.ceil(total/limit));
    const start = (page-1)*limit;
    const slice = ranked.slice(start, start+limit).map(d=>({
      title:d.title, url:d.url, image:d.image, price:d.price ?? null
    }));

    if(!slice.length){
      return okJson(res, {
        ok:true, found:false, total, page, pages, limit,
        message:"No encontré información sobre eso en nuestra web.",
        contact_url: WHATSAPP, results:[]
      });
    }

    okJson(res, {
      ok:true, found:true, total, page, pages, limit,
      contact_url: WHATSAPP, results: slice
    });
  } catch (err) {
    okJson(res, {
      ok:false, message:"Error interno al consultar.",
      contact_url: WHATSAPP, error:String(err?.message||err)
    }, 500);
  }
}
