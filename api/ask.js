// api/ask.js
const STATE = globalThis.__EM_INDEX || (globalThis.__EM_INDEX = { docs: [], updatedAt: 0 });

const WHATS = "https://wa.me/573203440092?text=" +
  encodeURIComponent("Hola Electrominds, necesito asesor 🙂");

function norm(s) {
  return String(s || "").toLowerCase();
}

function guessQueryGroup(q) {
  const s = norm(q);
  if (s.includes("arduino")) return "arduino";
  if (s.includes("raspberry")) return "raspberry";
  if (s.includes("sensor")) return "sensor";
  if (s.includes("interruptor")) return "interruptor wifi";
  if (s.includes("vga")) return "cables vga";
  if (s.includes("cable")) return "cables";
  return null;
}

export default async function handler(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));
    const page = Math.max(1, Number(req.query.page) || 1);

    if (!STATE.docs || STATE.docs.length === 0) {
      return res.status(200).json({
        ok: true,
        found: false,
        total: 0,
        page,
        pages: 1,
        limit,
        message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
        contact_url: WHATS,
        results: [],
      });
    }

    if (!q) {
      // si no mandan consulta, devolvemos nada pero con whatsapp
      return res.status(200).json({
        ok: true,
        found: false,
        total: 0,
        page,
        pages: 1,
        limit,
        contact_url: WHATS,
        results: [],
      });
    }

    // Si la consulta menciona un grupo, filtramos por grupo.
    const group = guessQueryGroup(q);

    // Búsqueda por score sencillo (título + texto)
    const words = norm(q).split(/\s+/).filter(Boolean);

    const scored = STATE.docs
      .filter(d => (group ? d.group === group : true))
      .map(d => {
        const haystack = norm(d.title + " " + d.text);
        let score = 0;
        for (const w of words) {
          if (haystack.includes(w)) score += 1;
        }
        // bonus por coincidencia completa de frase
        if (haystack.includes(norm(q))) score += 2;
        return { ...d, _score: score };
      })
      .filter(d => d._score > 0)
      .sort((a, b) => b._score - a._score);

    const total = scored.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const slice = scored.slice((page - 1) * limit, page * limit);

    const results = slice.map(d => ({
      title: d.title,
      url: d.url,
      group: d.group,
    }));

    res.status(200).json({
      ok: true,
      found: total > 0,
      total,
      page,
      pages,
      limit,
      contact_url: WHATS,
      results,
      // si no encontró nada, devolvemos un mensajito útil
      message: total === 0 ? "No encontré resultados para esa búsqueda." : undefined,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "ask_failed", contact_url: WHATS });
  }
}
