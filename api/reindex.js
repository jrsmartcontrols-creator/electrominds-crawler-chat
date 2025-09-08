// Reindex mínimo: lee el sitemap de productos directo y raspa título/precio
import axios from "axios";
import { load } from "cheerio";

const PRODUCTS_SITEMAP = "https://www.electrominds.com.co/store-products-sitemap.xml";

let INDEX = globalThis.__EM_INDEX__ || { docs: [], updatedAt: 0 };
globalThis.__EM_INDEX__ = INDEX;

// Utilidad: sacar <loc> del XML con regex simple (evitamos parsers que a veces fallan)
function extractLocs(xml) {
  const locs = [];
  const re = /<loc>(.*?)<\/loc>/g;
  for (const m of xml.matchAll(re)) locs.push(m[1]);
  return locs;
}

async function scrape(url) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const $ = load(html);

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim() ||
      $("h1").first().text().trim() ||
      url;

    const price =
      $('[data-hook="formatted-price"]').first().text().trim() ||
      $('[itemprop="price"]').first().attr("content") ||
      $("meta[itemprop='price']").attr("content") ||
      "";

    const desc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      $("p").map((_, el) => $(el).text()).get().join(" ");

    const text = [title, price, desc].join(" ").replace(/\s+/g, " ").toLowerCase();
    return { url, title, price, text };
  } catch (e) {
    console.error("SCRAPE_FAIL:", url, String(e));
    return null;
  }
}

export function getIndex() { return INDEX; }

function scoreDoc(qTokens, doc) {
  let score = 0;
  for (const t of qTokens) {
    const c = doc.text.split(t).length - 1;
    if (c > 0) score += Math.log(1 + c);
    if (doc.title.toLowerCase().includes(t)) score += 0.5;
  }
  return score;
}

export function queryIndex(q) {
  const idx = getIndex();
  if (!idx.docs.length) return [];
  const qTokens = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return idx.docs
    .map(d => ({ ...d, _score: scoreDoc(qTokens, d) }))
    .sort((a, b) => b._score - a._score)
    .filter(d => d._score > 0)
    .slice(0, 3);
}

export default async function handler(req, res) {
  try {
    // 1) Descargar sitemap de productos
    const { data: xml } = await axios.get(PRODUCTS_SITEMAP, {
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    // 2) Extraer URLs de <loc>
    const allUrls = extractLocs(xml)
      .filter(u => typeof u === "string" && /^https?:\/\//.test(u))
      // wix suele tener /product-page/
      .filter(u => /product-page/i.test(u));

    // 3) Únicos y límite
    const productUrls = [...new Set(allUrls)].slice(0, 40);

    // 4) Raspar productos
    const results = await Promise.allSettled(productUrls.map(scrape));
    const docs = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value);

    INDEX.docs = docs;
    INDEX.updatedAt = Date.now();

    return res.status(200).json({
      ok: true,
      count: docs.length,
      sample: docs.slice(0, 3).map(({ title, price, url }) => ({ title, price, url })),
      debug: { sitemapCount: allUrls.length, taken: productUrls.length },
      updatedAt: INDEX.updatedAt
    });
  } catch (err) {
    console.error("REINDEX_ERROR:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
