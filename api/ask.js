// api/ask.js
import { getIndex } from "./reindex.js";

const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

// Normaliza texto para buscar (minúsculas y sin tildes)
function norm(s = "") {
  return s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function scoreDoc(doc, qn) {
  const t = norm(doc.title);
  const txt = norm(doc.text || "");
  let s = 0;
  if (t.includes(qn)) s += 3;
  if (txt.includes(qn)) s += 1;
  return s;
}

export default async function handler(req, res) {
  const { q = "", limit = "12", page = "1" } = req.query;

  const { docs, updatedAt } = getIndex();
  const L = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
  const P = Math.max(1, parseInt(page, 10) || 1);

  if (!docs || docs.length === 0) {
    return res.status(200).json({
      ok: true,
      found: false,
      total: 0,
      page: P,
      pages: 1,
      limit: L,
      message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      contact_url: WHATSAPP,
      results: [],
    });
  }

  const qn = norm(q);
  const ranked = qn
    ? docs
        .map((d) => ({ ...d, _s: scoreDoc(d, qn) }))
        .filter((d) => d._s > 0)
        .sort((a, b) => b._s - a._s)
    : docs.map((d) => ({ ...d, _s: 0 }));

  const total = ranked.length;
  const pages = Math.max(1, Math.ceil(total / L));
  const slice = ranked.slice((P - 1) * L, (P - 1) * L + L);

  return res.status(200).json({
    ok: true,
    found: total > 0,
    total,
    page: P,
    pages,
    limit: L,
    contact_url: WHATSAPP,
    results: slice.map(({ _s, ...r }) => r),
    updatedAt,
  });
}
