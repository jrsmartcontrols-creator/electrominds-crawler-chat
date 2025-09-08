// api/ask.js
import { getIndex, queryIndex } from "./reindex.js";

// WhatsApp de Electrominds (formato E.164 sin +, prefijo 57)
const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%C3%ADa";

export default async function handler(req, res) {
  const payload = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const q = String(payload.q || "").trim();

  if (!q) {
    return res.status(400).json({ ok: false, error: "Falta parámetro q" });
  }

  // Asegurarnos de que existe índice (si no, dispara reindex una vez)
  let idx = getIndex();
  if (!idx.docs.length) {
    try {
      const mod = await import("./reindex.js");
      await mod.default({ method: "GET" }, { json: () => ({ ok: true }) });
      idx = getIndex();
    } catch (e) {
      // seguimos igual; intentaremos buscar con lo que haya
    }
  }

  const hits = queryIndex(q);

  // Paginación: /api/ask?q=arduino&limit=12&page=1
  const limit = Math.max(1, Math.min(parseInt(payload.limit ?? 12, 10), 50));
  const page  = Math.max(1, parseInt(payload.page  ?? 1, 10));
  const total = hits.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const results = hits.slice(start, start + limit);

  if (!results.length) {
    return res.status(200).json({
      ok: true,
      found: false,
      total, page, pages, limit,
      message: "No encontré información sobre eso en nuestra web.",
      contact_url: WHATSAPP,
      results: []
    });
  }

  return res.status(200).json({
    ok: true,
    found: true,
    total, page, pages, limit,
    results,
    contact_url: WHATSAPP
  });
}

