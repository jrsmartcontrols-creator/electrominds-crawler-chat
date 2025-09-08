import fetch from "node-fetch";
import * as cheerio from "cheerio";

let index = { docs: [], updatedAt: null };

export function getIndex() {
  return index;
}

export function queryIndex(q) {
  q = q.toLowerCase();
  return index.docs.filter(d => d.title.toLowerCase().includes(q));
}

export default async function handler(req, res) {
  try {
    const sitemapUrl = "https://www.electrominds.com.co/sitemap.xml";
    const toVisit = [sitemapUrl];
    const urls = [];

    while (toVisit.length) {
      const url = toVisit.pop();
      const resp = await fetch(url);
      const xml = await resp.text();

      const $ = cheerio.load(xml, { xmlMode: true });

      $("sitemap > loc").each((_, el) => {
        const loc = $(el).text();
        if (loc.endsWith("-sitemap.xml")) {
          toVisit.push(loc); // agregar sub-sitemap
        }
      });

      $("url > loc").each((_, el) => {
        urls.push($(el).text());
      });
    }

    // Guardar índice
    index = {
      docs: urls.map(u => ({ title: u.split("/").pop(), url: u })),
      updatedAt: Date.now()
    };

    return res.status(200).json({
      ok: true,
      count: index.docs.length,
      sample: index.docs.slice(0, 5),
      updatedAt: index.updatedAt
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
