// api/ask.js
import { getIndex, queryIndex } from "./reindex.js";

const WHATSAPP =
  "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%C3%ADa";

// --- CORS ---
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const src = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const q = String(src.q || "").trim();

    if (!q) {
      return res.status(400).json({ ok: false, error: "Falta parámetro q" });
    }

    // Usar índice en memoria
    let hits = [];
    let idx = getIndex();
    if (idx?.docs?.length) {
      hits = queryIndex(q);
    } else {
      // Índice vacío → responde sin romper
      return res.status(200).json({
        ok: true,
        found: false,
        total: 0,
        page: 1,
        pages: 1,
        limit: 12,
        message:
          "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
        contact_url: WHATSAPP,
        results: [],
      });
    }

    // Paginación
    const limit = Math.max(1, Math.min(parseInt(src.limit ?? 12, 10) || 12, 50));
    const page = Math.max(1, parseInt(src.page ?? 1, 10) || 1);
    const total = hits.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const results = hits.slice(start, start + limit);

    return res.status(200).json({
      ok: true,
      found: results.length > 0,
      total,
      page,
      pages,
      limit,
      results,
      contact_url: WHATSAPP,
    });
  } catch (err) {
    console.error("ask.js error:", err);
    // ¡Nunca devolvemos 500 al front!
    return res.status(200).json({
      ok: false,
      error: "server_error",
      message: "Ocurrió un error y ya lo estamos revisando.",
      contact_url: WHATSAPP,
    });
  }
}
