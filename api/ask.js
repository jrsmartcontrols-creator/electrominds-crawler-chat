// api/ask.js
import { getIndex, queryIndex, hydrateIndex } from "./reindex.js";

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
    const src   = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const q     = String(src.q || "").trim();
    const limit = Math.max(1, Math.min(parseInt(src.limit ?? 12, 10) || 12, 50));
    const page  = Math.max(1, parseInt(src.page ?? 1, 10) || 1);

    if (!q) {
      return res.status(400).json({ ok: false, error: "Falta parámetro q" });
    }

    // 1) ¿Índice vacío en esta instancia? → hidratar llamando a /api/reindex?full=1
    let idx = getIndex();
    if (!idx?.docs?.length) {
      try {
        const base = `https://${req.headers.host}`;
        const r = await fetch(`${base}/api/reindex?max=400&full=1`, { headers: { "accept": "application/json" } });
        const j = await r.json();
        if (j?.ok && Array.isArray(j.docs) && j.docs.length) {
          hydrateIndex(j.docs);
          idx = getIndex();
        }
      } catch (e) {
        // si falla, seguimos y devolvemos fallback elegante más abajo
        console.warn("Hydration fetch failed:", e?.message || e);
      }
    }

    // 2) Si sigue vacío, responder sin romper
    if (!idx?.docs?.length) {
      return res.status(200).json({
        ok: true,
        found: false,
        total: 0,
        page: 1,
        pages: 1,
        limit,
        message: "Índice temporalmente vacío. Intenta de nuevo en unos segundos.",
        contact_url: WHATSAPP,
        results: []
      });
    }

    // 3) Buscar + paginar
    const hits   = queryIndex(q);
    const total  = hits.length;
    const pages  = Math.max(1, Math.ceil(total / limit));
    const start  = (page - 1) * limit;
    const results = hits.slice(start, start + limit);

    return res.status(200).json({
      ok: true,
      found: results.length > 0,
      total,
      page,
      pages,
      limit,
      results,
      contact_url: WHATSAPP
    });
  } catch (err) {
    console.error("ask.js error:", err);
    return res.status(200).json({
      ok: false,
      error: "server_error",
      message: "Ocurrió un error y ya lo estamos revisando.",
      contact_url: WHATSAPP
    });
  }
}

