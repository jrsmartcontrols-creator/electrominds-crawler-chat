// /api/ask.js
// Responde con resultados {title, url}, filtrando por grupo si la consulta
// contiene "arduino", "sensor", "interruptor wifi", "raspberry", "cables".
// Si no hay índice, lo reconstruye automáticamente.

export const config = { runtime: "nodejs" };

const WA_NUMBER = "573203440092";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function wantGroup(q) {
  const s = String(q || "").toLowerCase();
  if (s.includes("arduino")) return "arduino";
  if (s.includes("raspberry")) return "raspberry";
  if (s.includes("sensor")) return "sensor";
  if (s.includes("interruptor") || s.includes("wifi")) return "interruptor wifi";
  if (s.includes("cable") || s.includes("vga") || s.includes("rj45") || s.includes("cat")) return "cables";
  return null;
}

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreDoc(doc, tokens) {
  const hay = (doc.title + " " + doc.url).toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (hay.includes(t)) score += 2;
  }
  // un pequeño plus si el token aparece completo en el título
  for (const t of tokens) {
    if (new RegExp(`\\b${t}\\b`, "i").test(doc.title)) score += 3;
  }
  return score;
}

// import lazy del builder de /api/reindex para reusar la misma lógica
async function ensureIndex() {
  const idx = globalThis.__electrominds_index;
  const freshEnough = idx && idx.docs && idx.docs.length > 0 && Date.now() - idx.updatedAt < 1000 * 60 * 60 * 6; // 6h
  if (freshEnough) return idx;

  // reconstruye un índice chico para no pasarse del timeout
  try {
    const mod = await import("./reindex.js");
    if (typeof mod.default === "function") {
      // simula llamada interna
      await mod.default(
        { method: "GET", url: "/api/reindex?max=120" },
        { setHeader(){}, status(){return { json(){} }}, json(){} } // dummy res (no usado)
      );
    }
  } catch (_) {
    // si falla el import, seguimos; tal vez otro lambda ya indexó
  }
  return globalThis.__electrominds_index || { docs: [], updatedAt: 0 };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams.get("q") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.max(1, Math.min(24, Number(url.searchParams.get("limit") || 12)));

  const idx = await ensureIndex();
  const docs = idx.docs || [];

  const contact_url = `https://wa.me/${WA_NUMBER}?text=` +
    encodeURIComponent(`Hola Electrominds, necesito asesor 😊`);

  if (!docs.length) {
    return res.status(200).json({
      ok: true, found: false, total: 0, page, pages: 1, limit,
      message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
      contact_url, results: []
    });
  }

  const tokens = tokenize(q);
  const grp = wantGroup(q);

  // filtra por grupo si aplica
  let pool = grp ? docs.filter(d => d.group === grp) : docs.slice();

  // ranking
  const ranked = pool
    .map(d => ({ d, s: scoreDoc(d, tokens) }))
    .filter(x => tokens.length === 0 ? true : x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.d);

  const total = ranked.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const pageItems = ranked.slice(start, start + limit);

  return res.status(200).json({
    ok: true,
    found: total > 0,
    total, page, pages, limit,
    contact_url,
    results: pageItems.map(({ title, url }) => ({ title, url }))
  });
}
