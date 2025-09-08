// /api/reindex.js
import { load as cheerioLoad } from "cheerio";
import { parseStringPromise } from "xml2js";

// --- CONFIG ---
const BASE = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${BASE}/sitemap.xml`;
const HUMAN_WHATSAPP =
  "https://wa.me/573203440092?text=Hola%20Electrominds,%20necesito%20asesor%20🙂";

// cache en memoria de la función serverless
const CACHE_KEY = "__EM_INDEX__";
const MAX_DEFAULT = 120; // puedes subirlo si ves que responde bien

// --- util: fetch con timeout y fallback ---
async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// --- util: limitador de concurrencia ---
async function mapLimit(items, limit, mapper) {
  const out = [];
  let i = 0, active = 0, rej;
  return new Promise((resolve, reject) => {
    rej = reject;
    const next = () => {
      if (i >= items.length && active === 0) return resolve(out);
      while (active < limit && i < items.length) {
        const idx = i++;
        active++;
        Promise.resolve(mapper(items[idx], idx))
          .then(v => out[idx] = v)
          .catch(e => { /* no frenamos todo, sólo log */ console.error(e); out[idx] = null; })
          .finally(() => { active--; next(); });
      }
    };
    next();
  });
}

// --- categorizar para “grupos” simples ---
function categorize(text) {
  const s = text.toLowerCase();
  if (s.includes("arduino")) return "arduino";
  if (s.includes("raspberry")) return "raspberry";
  if (s.includes("sensor")) return "sensor";
  if (s.includes("interruptor") || s.includes("sonoff") || s.includes("wifi")) return "interruptor wifi";
  if (s.includes("vga") || s.includes("cable")) return "cables vga";
  return "otros";
}

// --- lee el sitemap index y devuelve los sitemaps hijos ---
async function listChildSitemaps() {
  const xml = await fetchText(SITEMAP_INDEX);
  const parsed = await parseStringPromise(xml);
  const entries = parsed?.sitemapindex?.sitemap || [];
  const locs = entries.map(e => e.loc?.[0]).filter(Boolean);

  // priorizamos los que suelen traer productos / páginas de producto
  // pero admitimos todos por si Wix cambió nombres
  return locs;
}

// --- de un sitemap (xml) saca las URLs ---
async function urlsFromSitemap(sitemapUrl) {
  try {
    const xml = await fetchText(sitemapUrl);
    const parsed = await parseStringPromise(xml);
    const urlset = parsed?.urlset?.url || [];
    return urlset.map(u => u.loc?.[0]).filter(Boolean);
  } catch {
    return [];
  }
}

// --- extrae info básica de una página de producto ---
async function scrapeProduct(url) {
  try {
    const html = await fetchText(url, 12000);
    const $ = cheerioLoad(html);

    // og:title suele ser muy fiable en Wix
    const ogTitle = $('meta[property="og:title"]').attr("content");
    const h1 = $("h1").first().text();
    const title = (ogTitle || h1 || "").trim();

    if (!title) return null; // si no hay título, descartamos

    // una descripción corta para mejorar la búsqueda (no se muestra)
    const ogDesc = $('meta[property="og:description"]').attr("content") || "";
    const text = `${title} ${ogDesc}`.trim();

    return {
      title,
      url,
      text,
      group: categorize(text),
    };
  } catch {
    return null;
  }
}

// --- construir índice, con tope "max" ---
async function buildIndex(max = MAX_DEFAULT) {
  const sitemaps = await listChildSitemaps();

  // juntamos URLs de sitemaps en paralelo moderado
  const urlLists = await mapLimit(sitemaps, 4, urlsFromSitemap);
  let urls = urlLists.flat().filter(Boolean);

  // nos quedamos con posibles productos
  urls = urls.filter(u =>
    u.includes("/product") || u.includes("/product-page") || u.includes("/store")
  );

  // quitamos duplicados y recortamos a "max"
  const seen = new Set();
  const uniq = [];
  for (const u of urls) {
    if (!seen.has(u)) { seen.add(u); uniq.push(u); }
    if (uniq.length >= max) break;
  }

  // scrapeamos en paralelo moderado
  const docs = (await mapLimit(uniq, 6, scrapeProduct)).filter(Boolean);

  return {
    ok: true,
    count: docs.length,
    docs,
    taken: uniq.length,
    updatedAt: Date.now(),
  };
}

// --- acceso a cache global (se regenera sola si está vacía) ---
async function getIndex(force, max) {
  if (!globalThis[CACHE_KEY]) globalThis[CACHE_KEY] = { docs: [], updatedAt: 0 };
  const cached = globalThis[CACHE_KEY];

  if (force || !cached.docs?.length) {
    const idx = await buildIndex(max);
    globalThis[CACHE_KEY] = idx;
  }
  return globalThis[CACHE_KEY];
}

// --- handler HTTP ---
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const max = Math.max(10, Math.min(1000, Number(url.searchParams.get("max")) || MAX_DEFAULT));
    const force = true; // siempre forzamos cuando se llama /reindex

    const idx = await getIndex(force, max);

    res.status(200).json({
      ok: true,
      count: idx.count || 0,
      sitemapCount: undefined, // ya no reportamos hijos; no hace falta
      taken: idx.taken || 0,
      updatedAt: idx.updatedAt,
      sample: idx.docs.slice(0, 3).map(d => ({ title: d.title, url: d.url, group: d.group })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "crawler_failed" });
  }
}
