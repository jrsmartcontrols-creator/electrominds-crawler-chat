// api/ask.js
import { getIndex, queryIndex } from "./reindex.js";

// ⚠️ Cambia por tu número real de WhatsApp
const WHATSAPP =
  "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%C3%ADa";

// --- CORS helpers ---
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// --- Handler ---
export default async function handler(req, res) {
  // Preflight CORS (Wix/iframes suelen hacer OPTIONS)
  if (req.method === "OPTIONS") {
    cors(res);
    return res.status(204).end();
  }

  try {
    // Soporta GET ?q=... y POST { q: ... }
    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const q = String(params.q || "").trim();

    if (!q) {
      cors(res);
      return res.status(400).json({ ok: false, error: "Falta parámetro q" });
    }

    // Si aún no hay índice en memoria, forzamos una reindexación rápida
    const idx = getIndex();
    if (!idx?.docs?.length) {
      const { default: reindex } = await import("./reindex.js");
      await reindex(
        { method: "GET" },
        { status: () => ({ json: () => {} }) } // dummy res
      );
    }

    // Consulta en el índice
    const hits = queryIndex(q);

    // Fallback a humano si no hay resultados
    if (!hits.length) {
      cors(res);
      return res.status(200).json({
        ok: true,
        found: false,
        message:
          "❌ No encontré información sobre eso en nuestra web. ¿Quieres que te contacte un asesor humano?",
        contact_url: WHATSAPP,
      });
    }

    // Formato de salida
    const results = hits.map((h) => ({
      title: h.title,
      price: h.price || null,
      url: h.url,
    }));

    cors(res);
    return res.status(200).json({ ok: true, found: true, results });
  } catch (err) {
    console.error("ASK_ERROR:", err);
    cors(res);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
