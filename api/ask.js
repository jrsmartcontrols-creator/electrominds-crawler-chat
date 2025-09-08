// Busca en el índice en memoria. Devuelve items con título + url + group.
// Incluye CORS, manejo de OPTIONS y mensajes claros.

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const q =
    (req.method === "POST" ? req.body?.q : req.query?.q)?.toString().trim() || "";
  const limit = Math.min(24, parseInt(req.query?.limit || "12", 10));
  const page = Math.max(1, parseInt(req.query?.page || "1", 10));

  const contact_url =
    "https://wa.me/573203440092?text=" +
    encodeURIComponent("Hola Electrominds, necesito asesor 🆘");

  const idx = globalThis.__EM_INDEX__?.docs || [];

  if (!idx.length) {
    return res.status(200).json({
      ok: true,
      found: false,
      total: 0,
      page,
      pages: 1,
      limit,
      message:
        "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      contact_url,
      results: [],
    });
  }

  if (!q) {
    return res.status(400).json({ ok: false, error: "Falta parámetro q" });
  }

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = idx
    .map((d) => {
      const hay = (d.title + " " + (d.text || "")).toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 2;
      if (d.group && hay.includes(d.group)) score += 1;
      return { ...d, _score: score };
    })
    .filter((d) => d._score > 0)
    .sort((a, b) => b._score - a._score);

  const total = scored.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const results = scored.slice(start, start + limit).map((d) => ({
    title: d.title,
    url: d.url,
    group: d.group || "otros",
  }));

  return res.status(200).json({
    ok: true,
    found: total > 0,
    total,
    page,
    pages,
    limit,
    contact_url,
    results,
  });
}
