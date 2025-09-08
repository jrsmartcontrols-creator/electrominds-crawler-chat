// api/ask.js
import { getIndex, queryIndex } from "./reindex.js";

const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%C3%ADa";

export default async function handler(req, res) {
  try {
    const payload = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const q = String(payload.q || "").trim();

    if (!q) {
      return res.status(400).json({ ok: false, error: "Falta parámetro q" });
    }

    // 1) intentamos usar el índice actual
    let hits = [];
    let idx = getIndex();
    if (idx?.docs?.length) {
      hits = queryIndex(q);
    } else {
      // 2) si está vacío, intentamos reindexar SIN romper la función
      try {
        const { default: reindex } = await import("./reindex.js");
        await reindex({ method: "GET" }, { json: () => ({ ok: true }) });
        idx = getIndex();
        if (idx?.docs?.length) hits = queryIndex(q);
      } catch (e) {
        // no pasa nada, seguimos con hits vacíos
      }
    }

    // Paginación
    const limit = Math.max(1, Math.min(parseInt(payload.limit ?? 12, 10), 50));
    const page  = Math.max(1, parseInt(payload.page  ?? 1, 10));
    const total = hits.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const results = hits.slice(start, start + limit);

    // Respuesta uniforme (¡siempre JSON!)
    return res.status(200).json({
      ok: true,
      found: results.length > 0,
      total, page, pages, limit,
      results,
      contact_url: WHATSAPP,
      message: results.length
        ? undefined
        : "No encontré información sobre eso en nuestra web."
    });
  } catch (err) {
    console.error("ask.js error:", err);
    // Nunca devolvemos 500 al front: así el chat no revienta al parsear
    return res.status(200).json({
      ok: false,
      error: "server_error",
      contact_url: WHATSAPP,
      message: "Ocurrió un error y ya estamos revisándolo."
    });
  }
}
