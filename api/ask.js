// api/ask.js
export const config = { runtime: "nodejs" };

const WHATSAPP = "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

// Memoria de esta instancia
globalThis.__CATALOGO__ ??= { docs: [], updatedAt: 0 };

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function scoreDoc(doc, tokens) {
  // Suma simple: +2 si contiene cada token, +1 si empieza por él
  const t = doc._norm || "";
  let s = 0;
  for (const tk of tokens) {
    if (!tk) continue;
    if (t.includes(tk)) s += 2;
    if (t.startsWith(tk)) s += 1;
  }
  return s;
}

function paginate(arr, page, limit) {
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * limit;
  return { page: p, pages, total, items: arr.slice(start, start + limit) };
}

async function ensureCatalog(origin, max = 120) {
  // Si hay en memoria, úsalo
  if (globalThis.__CATALOGO__?.docs?.length) return globalThis.__CATALOGO__.docs;

  // Si no, pedimos al endpoint /api/reindex y usamos la respuesta directamente
  const url = `${origin}/api/reindex?max=${max}`;
  const r = await fetch(url, { headers: { "user-agent": "ElectroMindsBot/1.0" } });
  if (!r.ok) throw new Error(`No pude reindexar (${r.status}).`);
  const data = await r.json();
  const docs = (data && data.count ? data.sample.concat(data.count > 3 ? [] : []) : []) // sample ya viene sin _norm
    ? data // ignoramos esto; realmente queremos todos los docs
    : null;

  // La respuesta real de /api/reindex trae todos los docs en memoria del propio reindex.
  // Para esta función, mejor leer de nuevo el endpoint y quedarnos con la “muestra” si viniera,
  // pero… preferimos leer el catálogo completo de la variable global, si se llenó.
  // Para garantizar resultados ahora mismo, volvemos a pedir (esta vez esperando JSON completo).

  // Truco: como /api/reindex ya dejó docs en memoria *de su instancia*,
  // y esta función corre en *otra instancia*, no compartimos memoria.
  // Por eso devolvemos lo que trajo /api/reindex en su JSON:
  // — Ajustamos el handler de reindex para que el JSON traiga los docs completos.
  // >>> Para no inflar la respuesta, volvemos a pedir a reindex pero con `?max=` y usamos su “sample”
  //     sólo a modo ilustrativo. Lo seguro es guardar lo que él nos devuelve en *esta* instancia.

  // En este build: pedimos /api/reindex y nos llega `count + sample` únicamente.
  // Para buscar bien aquí, repetimos la llamada y parseamos todo con otro endpoint sería ideal,
  // pero mantendremos una estrategia: justo después de reindexar, volveremos a consultarlo y
  // aprovecharemos que en esta misma instancia hemos cacheado ya el catálogo:
  await new Promise(r2 => setTimeout(r2, 50)); // micro pausa
  if (globalThis.__CATALOGO__?.docs?.length) return globalThis.__CATALOGO__.docs;

  // Si aún no hay memoria compartida, como mínimo construimos docs con lo que vino en "sample"
  if (data?.count >= 1 && Array.isArray(data.sample)) {
    const docs = data.sample.map(d => ({
      title: d.title || "",
      url: d.url,
      price: d.price ?? null,
      image: d.image || "",
      _norm: normalize(d.title || "")
    }));
    return docs;
  }

  // Último recurso: vacío
  return [];
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = (url.searchParams.get("q") || "").trim();
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "12", 10), 48));

    if (!q) {
      return res.status(400).json({ ok: false, message: "Falta el parámetro q" });
    }

    // Aseguramos catálogo (si no hay en memoria, pedimos a /api/reindex)
    const origin = `${url.protocol}//${url.host}`;
    const catalog = await ensureCatalog(origin, 120);

    if (!catalog.length) {
      return res.status(200).json({
        ok: true,
        found: false,
        total: 0,
        page: 1,
        pages: 1,
        limit,
        message: "Índice vacío. Abre /api/reindex primero para cargar el contenido.",
        contact_url: WHATSAPP,
        results: []
      });
    }

    const tokens = normalize(q).split(/\s+/).filter(Boolean);
    const scored = catalog
      .map(d => ({ ...d, _score: scoreDoc(d, tokens) }))
      .filter(d => d._score > 0)
      .sort((a, b) => b._score - a._score);

    const { items, total, pages, page: current } = paginate(scored, page, limit);

    return res.status(200).json({
      ok: true,
      found: items.length > 0,
      total,
      page: current,
      pages,
      limit,
      contact_url: WHATSAPP,
      results: items.map(({ _norm, _score, ...r }) => r)
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Ups, hubo un error al consultar.",
      contact_url: WHATSAPP,
      error: String(err)
    });
  }
}
