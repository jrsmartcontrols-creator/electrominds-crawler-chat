// /api/reindex.js
// Node 22, ESM. Indexa productos: title + url + group. Sin imágenes.
// Fuente: sitemap de tu Wix. Concurrency baja para evitar timeouts en Vercel Hobby.

export const config = { runtime: "nodejs" };

const SITE = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${SITE}/sitemap.xml`;
const WA_NUMBER = "573203440092"; // <-- WhatsApp de Electrominds

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "ElectromindsBot/1.0" } });
  if (!r.ok) throw new Error(`Fetch ${url} -> ${r.status}`);
  return await r.text();
}

function extractLocs(xml) {
  // Extrae <loc>...</loc> con regex simple
  const locs = [];
  const re = /<loc>(.*?)<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) locs.push(m[1].trim());
  return locs;
}

function classifyGroup(title, url) {
  const t = `${title} ${url}`.toLowerCase();
  if (t.includes("arduino")) return "arduino";
  if (t.includes("raspberry")) return "raspberry";
  if (t.includes("sensor")) return "sensor";
  if (t.includes("interruptor") || t.includes("wifi")) return "interruptor wifi";
  if (t.includes("cable") || t.includes("vga") || t.includes("rj45") || t.includes("cat")) return "cables";
  return "otros";
}

function pickTitle(html) {
  // 1) og:title
  let m = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (m) return decodeHTMLEntities(m[1]);
  // 2) <title>
  m = html.match(/<title>([^<]+)<\/title>/i);
  if (m) return decodeHTMLEntities(m[1]);
  return null;
}
function decodeHTMLEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

async function buildIndex({ max = 120 } = {}) {
  // 1) lee sitemap index y queda con los sitemaps reales
  const root = await fetchText(SITEMAP_INDEX);
  const maps = extractLocs(root).filter((u) =>
    /sitemap\.xml|posts-sitemap\.xml|pages-sitemap\.xml|products-sitemap\.xml|store|forum|pages/i.test(u)
  );
  // 2) junta URLs de páginas
  let urls = [];
  for (const sm of maps) {
    try {
      const xml = await fetchText(sm);
      const locs = extractLocs(xml).filter((u) => u.startsWith("http"));
      urls.push(...locs);
    } catch (e) {
      // sigue
    }
  }
  // filtra URLs “no producto” obvios; deja pages también por si tienes fichas en “product-page”
  urls = urls.filter((u) =>
    /(product-page|store|product|pages|blog|post|forum|electrominds)/i.test(u)
  );

  // cap
  if (urls.length > max) urls = urls.slice(0, max);

  // 3) scrapea títulos con baja concurrencia
  const docs = [];
  const CONC = 4;
  let i = 0;

  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        const html = await fetchText(url);
        const title = pickTitle(html);
        if (!title) continue;
        docs.push({
          title: title.trim(),
          url,
          group: classifyGroup(title, url)
        });
      } catch (_) {
        // ignora errores individuales
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // guarda en memoria global (compartido por /api/ask si corre en el mismo runtime)
  globalThis.__electrominds_index = {
    docs,
    updatedAt: Date.now(),
    contact_url: `https://wa.me/${WA_NUMBER}?text=` +
      encodeURIComponent("Hola Electrominds, necesito asesor 😊"),
  };

  return { count: docs.length, sitemapCount: maps.length, taken: urls.length };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url, "http://localhost");
  const max = Math.max(20, Math.min(200, Number(url.searchParams.get("max") || 120)));

  try {
    const stats = await buildIndex({ max });
    const idx = globalThis.__electrominds_index || { docs: [] };
    return res.status(200).json({
      ok: true,
      ...stats,
      sample: idx.docs.slice(0, 3),
      updatedAt: idx.updatedAt
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
