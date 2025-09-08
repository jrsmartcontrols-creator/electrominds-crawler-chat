import { getIndex, queryIndex } from "./reindex.js";

const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%C3%ADa";

export default async function handler(req, res) {
  const { q } = req.method === "POST" ? (req.body || {}) : (req.query || {});
  if (!q || !String(q).trim()) {
    return res.status(400).json({ ok: false, error: "Falta parámetro q" });
  }

  const idx = getIndex();
  if (!idx.docs.length) {
    await (await import("./reindex.js")).default(
      { method: "GET" },
      { status: () => ({ json: () => {} }) }
    );
  }

  const hits = queryIndex(String(q));
  if (!hits.length) {
    return res.status(200).json({
      ok: true,
      found: false,
      message: "❌ No encontré información sobre eso en nuestra web. ¿Quieres que te contacte un asesor humano?",
      contact_url: WHATSAPP
    });
  }

  const results = hits.map(h => ({ title: h.title, price: h.price || null, url: h.url }));
  res.status(200).json({ ok: true, found: true, results });
}
