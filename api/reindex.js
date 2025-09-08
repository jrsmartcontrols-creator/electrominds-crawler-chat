import axios from "axios";
import { parseStringPromise } from "xml2js";
import { load } from "cheerio";

const SITE = "https://www.electrominds.com.co";
const ROOT_SITEMAP = `${SITE}/sitemap.xml`;

let INDEX = globalThis.__EM_INDEX__ || { docs: [], updatedAt: 0 };
globalThis.__EM_INDEX__ = INDEX;

// Utilidades --------------------------
async function getXml(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return parseStringPromise(data);
}

function okUrl(u) {
  return typeof u === "string" && /^https?:\/\//.test(u);
}

async function scrapeProduct(url) {
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
    // Registramos en log de Vercel para depurar
    console.error("SCRAPE_FAIL:", url, String(e));
    return null;
  }
}

// Handler -----------------------------
export default async function handler(req, res) {
  try {
    // 1) Leer sitemap raíz
    const root = await getXml(ROOT_SITEMAP);

    // 2) Buscar el sub-sitemap de productos
    const submaps = (root?.sitemapindex?.sitemap || [])
      .map(s => s?.loc?.[0])
      .filter(okUrl);

    const productsMap = submaps.find(u => /store-products-sitemap\.xml/i.test(u));
    if (!productsMap) {
      return res.status(200).json({
        ok: true,
        count: 0,
        reason: "No se encontró store-products-sitemap.xml",
        submaps
      });
    }

    // 3) Leer el sitemap de productos
    const prodXml = await getXml(productsMap);
    const productUrls = (prodXml?.urlset?.url || [])
      .map(u => u?.loc?.[0])
      .filter(okUrl)
      .filter(u => /product-page/i.test(u)); // wix típico

    // Seguridad: único y límite
    const uniqueUrls = [...new Set(productUrls)].slice(0, 40);

    // 4) Raspar productos
    const results = await Promise.allSettled(uniqueUrls.map(u => scrapeProduct(u)));
    const docs = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value);

    INDEX.docs = docs;
    INDEX.updatedAt = Date.now();

    return res.status(200).json({
      ok: true,
      count: docs.length,
      sample: docs.slice(0, 3).map(({ title, price, url }) => ({ title, price, url })),
      productsMap,
      updatedAt: INDEX.updatedAt
    });
  } catch (err) {
    console.error("REINDEX_ERROR:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

// Helpers para /api/ask
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
