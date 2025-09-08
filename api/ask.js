// api/ask.js
const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";
const REINDEX_MAX = 120; // cuánto índice traer para cada consulta (ajústalo)

function norm(s = "") {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreDoc(doc, qTokens) {
  const t = norm(doc.title || "");
  const x = norm(doc.text || "");
  let s = 0;
  for (const tok of qTokens) {
    if (!tok) continue;
    if (t.includes(tok)) s += 3;   // título pesa más
    if (x.includes(tok)) s += 1;   // descripción
  }
  return s;
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 12, 48));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  if (!q) {
    return res.status(400).json({ ok: false, error: "Falta parámetro q" });
  }

  // 1) trae el índice en JSON desde /api/reindex (no depende de memoria)
  let idx;
  try {
    const origin = `${url.protocol}//${url.host}`;
    const r = await fetch(`${origin}/api/reindex?data=1&max=${REINDEX_MAX}`, { cache: "no-store" });
    idx = await r.json();
    if (!idx.ok) throw new Error("reindex no ok");
  } catch (e) {
    return res.status(502).json({
      ok: false,
      message: "No me pude conectar al servidor. Revisa tu conexión e intenta otra vez 🙏",
      contact_url: WHATSAPP,
      detail: String(e),
    });
  }

  const docs = Array.isArray(idx.docs) ? idx.docs : [];
  if (!docs.length) {
    return res.json({
      ok: true,
      found: false,
      total: 0,
      page: 1,
      pages: 1,
      limit,
      contact_url: WHATSAPP,
      message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      results: [],
    });
  }

  // 2) filtra y ordena por puntuación
  const qTokens = norm(q).split(" ");
  const scored = docs
    .map(d => ({ ...d, _score: scoreDoc(d, qTokens) }))
    .filter(d => d._score > 0)
    .sort((a, b) => b._score - a._score);

  const total = scored.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const slice = scored.slice(start, start + limit).map(({ _score, ...d }) => d);

  res.json({
    ok: true,
    found: total > 0,
    total,
    page,
    pages,
    limit,
    contact_url: WHATSAPP,
    results: slice,
  });
}
