// Reindexa productos desde el sitemap del sitio y los guarda en memoria del runtime.
// SIN imágenes. Con grupos simples. Con CORS.
// Node 22.x en package.json

import * as cheerio from "cheerio";

const ROOT = "https://www.electrominds.com.co";

// Heurística de agrupación
function guessGroup(title) {
  const t = title.toLowerCase();
  if (/arduino|mega|uno|nano|shield|atmega|esp/.test(t)) return "arduino";
  if (/sensor|pir|temperatura|humedad|ultrason|termistor|ky-?\d+/.test(t)) return "sensor";
  if (/interruptor|sonoff|relay|rel[eé]/.test(t)) return "interruptor wifi";
  if (/raspberry|pi\s?\d|compute module/.test(t)) return "raspberry";
  if (/vga|hdmi|displayport|cable/.test(t)) return "cables vga";
  return "otros";
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const max = Math.min(300, parseInt(req.query.max || "120", 10));
  const full = req.query.full === "1"; // si quieres extraer un poco de texto

  try {
    const xml = await fetch(`${ROOT}/sitemap.xml`).then(r => r.text());
    const $ = cheerio.load(xml, { xmlMode: true });
    const locs = $("sitemap > loc, urlset > url > loc")
      .map((_, el) => $(el).text())
      .get();

    // Filtra urls de producto; ajusta si tu sitio usa otro patrón
    const productUrls = locs
      .filter(u => /product|product-page|tienda|store|products/.test(u))
      .slice(0, max);

    const docs = [];
    let taken = 0;

    for (const url of productUrls) {
      try {
        const html = await fetch(url).then(r => r.text());
        const $$ = cheerio.load(html);

        const title =
          $$('meta[property="og:title"]').attr("content") ||
          $$("title").first().text() ||
          "";
        if (!title.trim()) continue;

        let text = "";
        if (full) {
          text =
            $$('meta[property="og:description"]').attr("content") ||
            $$('meta[name="description"]').attr("content") ||
            $$(".product-description, .entry-content").text() ||
            $$(".content, body").text() ||
            "";
          text = text.replace(/\s+/g, " ").trim().slice(0, 600);
        }

        docs.push({ title: title.trim(), url, text, group: guessGroup(title) });
        taken++;
      } catch {
        // Ignora errores puntuales por url
      }
    }

    // Guarda en memoria del runtime (se pierde en frío, reindexa si es necesario)
    globalThis.__EM_INDEX__ = { when: Date.now(), docs };

    return res.status(200).json({
      ok: true,
      count: docs.length,
      sitemapCount: locs.length,
      taken,
      updatedAt: Date.now(),
      sample: docs.slice(0, 3),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
