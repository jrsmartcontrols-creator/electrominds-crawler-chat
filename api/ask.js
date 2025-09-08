// /api/ask.js
// Busca en el índice en memoria creado por /api/reindex.js
// Añade boost por categorías (breadcrumbs) y filtro por “familias” (arduino, raspberry, etc.)
// Soporta paginación: ?q=...&limit=12&page=1

export const config = { runtime: "edge" };

function getStore() {
  globalThis.__EM_STORE__ ??= { docs: [], updatedAt: 0, byUrl: new Map() };
  return globalThis.__EM_STORE__;
}

const WA_BASE = "https://wa.me/573203440092?text=";

const NORMALIZE = (s="") =>
  s.toLowerCase()
   .normalize("NFD")
   .replace(/[\u0300-\u036f]/g, "");

function scoreDoc(doc, q) {
  const k = NORMALIZE(q);
  const title = NORMALIZE(doc.title || "");
  const text  = NORMALIZE(doc.text || "");
  const url   = NORMALIZE(doc.url || "");
  const cats  = (doc.cats || []).map(c => NORMALIZE(String(c)));

  let s = 0;
  if (title.includes(k)) s += 2.0;
  if (text.includes(k))  s += 1.0;
  if (url.includes(k))   s += 0.5;
  if (cats.some(c => c.includes(k))) s += 2.5; // boost por categorías

  return s;
}

function queryIndex(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const k = NORMALIZE(q);

  // Familias: si coincide exactamente con una familia,
  // exigimos match en título o categoría para eliminar ruido.
  const FAMILY = new Set([
    "arduino","raspberry","raspberry pi",
    "interruptor wifi","sensor","sensors","cables vga","cable vga"
  ]);

  const { docs } = getStore();
  let scored = docs.map(d => ({ ...d, _score: scoreDoc(d, q) }))
                   .sort((a,b) => b._score - a._score);

  if (FAMILY.has(k)) {
    scored = scored.filter(d => {
      const t = NORMALIZE(d.title || "");
      const cs = (d.cats || []).map(c => NORMALIZE(String(c)));
      return t.includes(k) || cs.some(c => c.includes(k));
    });
  }

  // Umbral mínimo para evitar ruido residual
  scored = scored.filter(d => d._score >= 2);

  return scored;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") || "12", 10) || 12));
  const page  = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);

  const store = getStore();
  const waDefault = WA_BASE + encodeURIComponent("Hola Electrominds, ¿me ayudas?");

  if (!store.docs.length) {
    return json({
      ok: true,
      found: false,
      total: 0, page: 1, pages: 1, limit,
      message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      contact_url: waDefault,
      results: []
    });
  }

  if (!q) {
    return json({
      ok: true,
      found: false,
      total: 0, page: 1, pages: 1, limit,
      message: "Falta parámetro q",
      contact_url: waDefault,
      results: []
    });
  }

  const all = queryIndex(q);
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const slice = all.slice((page - 1) * limit, (page - 1) * limit + limit);

  const results = slice.map(r => ({
    title: r.title,
    url: r.url,
    price: r.price ?? null,
    image: r.image ?? null,
    cats: r.cats ?? [],
    score: r._score
  }));

  const found = results.length > 0;

  // WhatsApp con el interés del usuario (si no hay resultados, link genérico)
  const wa = found
    ? WA_BASE + encodeURIComponent(`Hola Electrominds, busqué: "${q}"`)
    : waDefault;

  return json({
    ok: true,
    found,
    total,
    page,
    pages,
    limit,
    contact_url: wa,
    results
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

