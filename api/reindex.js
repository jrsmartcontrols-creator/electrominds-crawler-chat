// Construye un índice rápido leyendo el sitemap de Electrominds
import axios from "axios";
import { parseStringPromise } from "xml2js";
import { load } from "cheerio";   // 👈 cambio clave: import { load } from "cheerio"

// Índice en memoria (se mantiene mientras la función esté “caliente”)
let INDEX = globalThis.__EM_INDEX__ || { docs: [], updatedAt: 0 };
globalThis.__EM_INDEX__ = INDEX;

// URL del sitemap de tu Wix
const SITEMAP_URL = "https://www.electrominds.com.co/sitemap.xml";

// Filtramos URLs útiles (productos, colecciones, etc.)
const isUseful = (url = "") =>
  /product-page|collections|tienda|shop|productos|product/i.test(url);

// Lee y parsea el sitemap
async function fetchSitemapUrls() {
  const { data } = await axios.get(SITEMAP_URL, {
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const xml = await parseStringPromise(data);
  const urls = (xml.urlset?.url || [])
    .map((u) => u?.loc?.[0])
    .filter(Boolean);
  return [...new Set(urls.filter(isUseful))];
}

// Extrae título, precio y texto de una página
async function scrape(url) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = load(html); // 👈 cambio aquí

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim() ||
      $("h1").first().text().trim() ||
      url;

    // Selectores típicos de Wix para precio (puede variar)
    const price =
      $('[data-hook="formatted-price"]').first().text().trim() ||
      $('[itemprop="price"]').first().attr("content") ||
      $("meta[itemprop='price']").attr("content") ||
      "";

    const desc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      $("p")
        .map((_, el) => $(el).text())
        .get()
        .join(" ");

    const text = [title, price, desc].join(" ").replace(/\s+/g, " ").toLowerCase();

    return { url, title, price, text };
  } catch (e) {
    // Si una página falla, devolvemos null y seguimos con las demás
    return null;
  }
}

// Endpoint: /api/reindex
export default async function handler(req, res) {
  try {
    const urls = await fetchSitemapUrls();

    // Limitar para que no se pase de tiempo (ajustable)
    const LIMITED = urls.slice(0, 15);

    const results = await Promise.allSettled(LIMITED.map((u) => scrape(u)));
    const docs = results
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => r.value);

    INDEX.docs = docs;
    INDEX.updatedAt = Date.now();

    res.status(200).json({
      ok: true,
      count: docs.length,
      sample: docs.slice(0, 3).map(({ title, price, url }) => ({ title, price, url })),
      updatedAt: INDEX.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// Helpers para /api/ask
export function getIndex() {
  return INDEX;
}

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
    .map((d) => ({ ...d, _score: scoreDoc(qTokens, d) }))
    .sort((a, b) => b._score - a._score)
    .filter((d) => d._score > 0)
    .slice(0, 3);
}

