// api/ask.js
import { getIndex, queryIndex } from "./reindex.js";

const WA = "https://wa.me/573203440092";

/** Llama a /api/reindex si el índice está vacío y devuelve el índice en memoria */
async function ensureIndexIsWarm(req) {
  const idx = getIndex();
  if (idx?.docs?.length) return idx;

  // Construimos la URL base del mismo deployment
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers.host;
  const base  = `${proto}://${host}`;

  try {
    // Calentamos con un tamaño seguro para Vercel (evita 504 con 200+)
    const url = `${base}/api/reindex?max=120`;
    await fetch(url, { cache: "no-store" }).then(r => r.json()).catch(()=>{});
  } catch (_) {}

  return getIndex();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, message:"Solo GET permitido" });
  }

  const qRaw  = (req.query.q ?? "").toString().trim();
  const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? "12", 10)));

  if (!qRaw) {
    return res.status(400).json({
      ok: false,
      message: "Falta el parámetro q",
      contact_url: `${WA}?text=${encodeURIComponent("Hola Electrominds, necesito un asesor")}`,
    });
  }

  // Asegura que haya índice en memoria (si no, lo recalienta)
  const idx = await ensureIndexIsWarm(req);

  if (!idx?.docs?.length) {
    // Si por algún motivo no se pudo calentar, devolvemos fallback amable
    return res.json({
      ok: true,
      found: false,
      total: 0,
      page,
      pages: 1,
      limit,
      message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      contact_url: `${WA}?text=${encodeURIComponent("Hola Electrominds, ¿me ayudas?")}`,
      results: []
    });
  }

  // Buscamos
  const hits  = queryIndex(qRaw, idx);
  const total = hits.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const slice = hits.slice(start, start + limit);

  const results = slice.map(d => ({
    title: d.title,
    url:   d.url,
    image: d.image || null,
    price: d.price ?? null,
  }));

  return res.json({
    ok: true,
    found: total > 0,
    total,
    page,
    pages,
    limit,
    contact_url: `${WA}?text=${encodeURIComponent("Hola Electrominds, ¿me ayudas?")}`,
    results
  });
}
