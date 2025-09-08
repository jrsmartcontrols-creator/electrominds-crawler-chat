// /api/ask.js
export const config = { runtime: "edge" };

const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

function norm(s="") {
  return s.toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu,"")
    .replace(/[^a-z0-9\s]/g," ")
    .replace(/\s+/g," ").trim();
}
function tokens(s){ return norm(s).split(" ").filter(Boolean); }

function scoreDoc(qtoks, doc) {
  const hay = (doc.__n ||= norm(`${doc.title} ${doc.url}`));
  let s = 0;
  for (const t of qtoks) {
    if (hay.includes(t)) s += 1;
    if (hay.includes(t+" arduino")) s += 0.5; // pequeño boost útil en tu catálogo
  }
  return s;
}

export default async function handler(req){
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(24, Math.max(1, Number(searchParams.get("limit")) || 12));
  const page  = Math.max(1, Number(searchParams.get("page")) || 1);

  const idx = globalThis.__ELECTRO_IDX || { docs:[], updatedAt:0 };
  if (!idx.docs.length) {
    return new Response(JSON.stringify({
      ok:true, found:false, total:0, page, pages:1, limit,
      message:"Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      contact_url: WHATSAPP, results:[]
    }), { headers:{ "content-type":"application/json" }});
  }

  if (!q) {
    return new Response(JSON.stringify({
      ok:true, found:false, total:0, page, pages:1, limit,
      message:"Escribe algo como: arduino, sensor, raspberry...",
      contact_url: WHATSAPP, results:[]
    }), { headers:{ "content-type":"application/json" }});
  }

  const qt = tokens(q);
  const scored = idx.docs
    .map(d => ({ ...d, _score: scoreDoc(qt, d) }))
    .filter(d => d._score > 0)
    .sort((a,b) => b._score - a._score);

  const total = scored.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const slice = scored.slice((page-1)*limit, (page-1)*limit + limit);

  return new Response(JSON.stringify({
    ok:true, found: total>0, total, page, pages, limit,
    contact_url: WHATSAPP,
    results: slice.map(({title,url,image,price}) => ({ title, url, image, price:null }))
  }), { headers:{ "content-type":"application/json" }});
}
