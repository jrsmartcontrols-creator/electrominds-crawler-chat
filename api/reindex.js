// /api/reindex.js
import axios from "axios";
import { XMLParser } from "fast-xml-parser";

// --- CORS helper ---
function withCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
export default async function handler(req, res) {
  withCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const max = Math.min(parseInt(req.query.max || "120", 10), 500);
    const takeImages = req.query.full === "1" || req.query.full === "true";

    // Guardamos el índice en memoria entre invocaciones
    globalThis.__EM_INDEX__ ||= { docs: [], updatedAt: 0 };

    // 1) Descarga del sitemap principal de Electrominds (Wix)
    const SITEMAP_URL = "https://www.electrominds.com.co/sitemap.xml";
    const xml = (await axios.get(SITEMAP_URL, { timeout: 20000 })).data;
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    // Obtiene la lista de sitemaps secundarios
    const sm = parsed?.sitemapindex?.sitemap || [];
    const sitemapUrls = (Array.isArray(sm) ? sm : [sm])
      .map((s) => s?.loc)
      .filter(Boolean);

    const urls = [];
    // 2) Abre cada sitemap secundario y recoge las URLs de páginas
    for (const smUrl of sitemapUrls) {
      try {
        const xml2 = (await axios.get(smUrl, { timeout: 20000 })).data;
        const p2 = parser.parse(xml2);
        const urlset = p2?.urlset?.url || [];
        const items = (Array.isArray(urlset) ? urlset : [urlset])
          .map((u) => u?.loc)
          .filter(Boolean);
        urls.push(...items);
        if (urls.length >= max) break;
      } catch {
        // continúa con el siguiente sitemap
      }
    }

    // 3) Baja cada página (limitado por "max") y extrae título, imagen y texto
    const docs = [];
    for (const url of urls.slice(0, max)) {
      try {
        const html = (await axios.get(url, { timeout: 20000 })).data;

        // Título
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = (titleMatch?.[1] || "Electrominds").trim();

        // Imagen (og:image)
        let image = "";
        const ogImg =
          html.match(
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
          )?.[1] ||
          html.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*product/i)
            ?.[1] ||
          "";

        if (takeImages) image = ogImg || "";

        // Texto plano (muy básico)
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 2000)
          .trim();

        docs.push({
          title,
          url,
          image,
          price: null,
          text
        });
      } catch {
        // continua
      }
    }

    globalThis.__EM_INDEX__.docs = docs;
    globalThis.__EM_INDEX__.updatedAt = Date.now();

    return res.status(200).json({
      ok: true,
      count: docs.length,
      sample: docs.slice(0, 3).map((d) => ({ title: d.title, url: d.url, image: d.image })),
      sitemapCount: sitemapUrls.length,
      taken: urls.length,
      updatedAt: globalThis.__EM_INDEX__.updatedAt
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "index_failed",
      message: err?.message || "Index error"
    });
  }
}
