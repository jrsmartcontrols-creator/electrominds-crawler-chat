// /api/ask.js
const HUMAN_WHATSAPP =
  "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

const CACHE_KEY = "__EM_INDEX__";

function words(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreDoc(doc, qWords) {
  const hay = (doc.title + " " + (doc.text || "")).toLowerCase();
  let s = 0;
  for (const w of qWords) {
    // +3 si aparece en título, +1 si aparece en descripción, pequeño bonus de longitud
    if (doc.title.toLowerCase().includes(w)) s += 3;
    if (hay.includes(w)) s += 1;
  }
  return s + Math.min(2, doc.title.length / 100);
}

function detectGroupFromQuery(q) {
  const s = q.toLowerCase();
  if (s.includes("arduino")) return "arduino";
  if (s.includes("raspberry")) return "raspberry";
  if (s.includes("sensor")) return "sensor";
  if (s.includes("interruptor") || s.includes("sonoff") || s.includes("wifi")) return "interruptor wifi";
  if (s.includes("vga") || s.includes("cable")) return "cables vga";
  return null; // sin grupo => buscar en todo
}

async function ensureIndexReady() {
  if (!globalThis[CACHE_KEY] || !globalThis[CACHE_KEY].docs?.length) {
    // si no hay índice cargado, pedimos a /api/reindex que lo genere con un tamaño razonable
    try {
      const host = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      // generamos un índice fresquito (120 items por defecto)
      await fetch(`${host}/api/reindex?max=120`, { headers: { "user-agent": "Mozilla/5.0" } });
    } catch (e) {
      // si falla, no detenemos; devolveremos mensaje de contacto humano
      console.error("warmup failed:", e);
    }
  }
  return globalThis[CACHE_KEY] || { docs: [] };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 12));
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

    // Si no hay query, devolvemos vacío + CTA humano
    if (!q) {
      return res.status(200).json({
        ok: true,
        found: false,
        total: 0,
        page, pages: 1, limit,
        contact_url: HUMAN_WHATSAPP,
        results: [],
        message: "Escribe qué producto buscas (ej. arduino, sensor, interruptor wifi).",
      });
    }

    // nos aseguramos de tener índice en memoria
    const idx = await ensureIndexReady();
    const docs = idx.docs || [];

    if (!docs.length) {
      return res.status(200).json({
        ok: true,
        found: false,
        total: 0,
        page, pages: 1, limit,
        message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
        contact_url: HUMAN_WHATSAPP,
        results: [],
      });
    }

    // búsqueda simple con score
    const qWords = words(q);
    const group = detectGroupFromQuery(q);
    const pool = group ? docs.filter(d => d.group === group) : docs;

    const ranked = pool
      .map(d => ({ ...d, _s: scoreDoc(d, qWords) }))
      .filter(d => d._s > 0) // algo de coincidencia
      .sort((a, b) => b._s - a._s);

    const total = ranked.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const slice = ranked.slice((page - 1) * limit, (page - 1) * limit + limit);

    const results = slice.map(d => ({
      title: d.title,
      url: d.url,
      // la UI del chat usará estos campos para renderizar
      buttons: [
        { label: "Ver producto", href: d.url },
        { label: "Asesor humano", href: HUMAN_WHATSAPP }
      ]
    }));

    res.status(200).json({
      ok: true,
      found: total > 0,
      total, page, pages, limit,
      contact_url: HUMAN_WHATSAPP,
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "ask_failed", contact_url: HUMAN_WHATSAPP });
  }
}
