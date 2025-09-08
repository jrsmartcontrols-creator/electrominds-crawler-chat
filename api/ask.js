// /api/ask.js

// --- CORS helper ---
function withCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export default async function handler(req, res) {
  withCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const q = (req.query.q || "").toString().trim();
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "12", 10), 1), 50);

  const idx = globalThis.__EM_INDEX__?.docs || [];
  if (!idx.length) {
    return res.status(200).json({
      ok: true,
      found: false,
      total: 0,
      page,
      pages: 1,
      limit,
      message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      contact_url: WHATSAPP,
      results: []
    });
  }

  if (!q) {
    // sin query devolvemos “populares” (primeros items)
    const results = idx.slice(0, limit).map(small);
    return res.status(200).json({
      ok: true,
      found: !!results.length,
      total: idx.length,
      page: 1,
      pages: Math.ceil(idx.length / limit),
      contact_url: WHATSAPP,
      results
    });
  }

  const nq = normalize(q);
  // scoring simple por coincidencia en título y en texto
  const scored = idx
    .map((d) => {
      const t = normalize(d.title);
      const txt = normalize(d.text || "");
      let score = 0;
      if (t.includes(nq)) score += 3;
      if (txt.includes(nq)) score += 1;
      return { d, score };
    })
    .filter((s) => s.score > 0)
  // descarta duplicados por URL
    .reduce((acc, s) => {
      if (!acc.map.has(s.d.url)) {
        acc.map.set(s.d.url, true);
        acc.arr.push(s);
      }
      return acc;
    }, { map: new Map(), arr: [] }).arr
    .sort((a, b) => b.score - a.score)
    .map((s) => s.d);

  const total = scored.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const results = scored.slice(start, start + limit).map(small);

  return res.status(200).json({
    ok: true,
    found: results.length > 0,
    total,
    page,
    pages,
    limit,
    contact_url: WHATSAPP,
    results
  });
}

function small(d) {
  return {
    title: d.title,
    url: d.url,
    image: d.image || "",
    price: d.price,
    text: (d.text || "").slice(0, 220)
  };
}
