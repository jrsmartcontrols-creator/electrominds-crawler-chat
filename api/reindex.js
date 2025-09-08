// Reindexa Electrominds leyendo sitemap(s) y con fallback desde la home
import axios from "axios";
import { parseStringPromise } from "xml2js";
import { load } from "cheerio";

let INDEX = globalThis.__EM_INDEX__ || { docs: [], updatedAt: 0 };
globalThis.__EM_INDEX__ = INDEX;

const SITE = "https://www.electrominds.com.co";
const SITEMAP_URL = `${SITE}/sitemap.xml`;

// Filtro de URLs "útiles" (ajústalo si quieres ser más o menos agresivo)
const isUseful = (url = "") =>
  /product-page|product|collections|tienda|shop|productos/i.test(url);

// ---------- Lectura de sitemaps ----------
async function fetchXml(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return parseStringPromise(data);
}

// Lee urlset (sitemap "plano")
function extractFromUrlset(xml) {
  const urls = (xml.urlset?.url || [])
    .map(u => u?.loc?.[0])
    .filter(Boolean);
  return urls;
}

// Lee sitemapindex (lista de sitemaps)
function extractFromIndex(xml) {
  const sm = (xml.sitemapindex?.sitemap || [])
    .map(s => s?.loc?.[0])
    .filter(Boolean);
  return sm;
}

async function fetchAllSitemapUrls() {
  const root = await fetchXml(SITEMAP_URL);

  // Caso 1: sitemap index -> recorrer sub-sitemaps
  const submaps = extractFromIndex(root);
  let urls = [];
  if (submaps.length) {
    for (const smUrl of submaps) {
      try {
        const sub = await fetchXml(smUrl);
        urls.push(...extractFromUrlset(sub));
      } catch {
        // ignoramos errores de sitemaps individuales
      }
    }
  } else {
    // Caso 2: sitemap plano
    urls = extractFromUrlset(root);
  }

  // Normalizamos, filtramos por dominio y por utilidad
  const filtered = urls
    .filter(Boolean)
    .map(u => (u.startsWith("http") ? u : SITE + u))
    .filter(u => u.includes("electrominds.com.co"))
    .filter(isUseful);

  // Únicos
  return [...new Set(filtered)];
}

// ---------- Scraping de páginas ----------
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

    const text = [title, price, desc]
      .join(" ")
      .replace(/\s+/g, " ")
      .toLowerCase();

    return { url, title, price, text };
  } catch {
    return null;
  }
}

// ---------- Fallback si no hay sitemap útil ----------
async function fallbackUrlsFromHome() {
  try {
    const { data: html } = await axios.get(SITE, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const $ = load(html);
    const links = $("a[href]")
      .map((_, a) => $(a).attr("href"))
      .get()
      .filter(Boolean)
      .map(href => (href.startsWith("http") ? href : SITE + href))
      .filter(u => u.includes("electrominds.com.co"))
      .filter(isUseful);
    return [...new Set(links)];
  } catch {
    return [];
  }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    let urls = [];
    try {
      urls = await fetchAllSitemapUrls();
    } catch {
      urls = [];
    }

    if (!urls.length) {
      // Intento de respaldo
      urls = await fallbackUrlsFromHome();
    }

    // Limitar por tiempo de ejecución
    const LIMITED = urls.slice(0, 30);

    const results = await Promise.allSettled(LIMITED.map(u => scrape(u)));
    const docs = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value);

    INDEX.docs = docs;
    INDEX.updatedAt = Date.now();

    res.status(200).json({
      ok: true,
      count: docs.length,
      sample: docs.slice(0, 3).map(({ title, price, url }) => ({ title, price, url })),
      updatedAt: INDEX.updatedAt
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ---------- Helpers para /api/ask ----------
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
    .map(d => ({ ...d, _score: scoreDoc(qTokens, d) }))
    .sort((a, b) => b._score - a._score)
    .filter(d => d._score > 0)
    .slice(0, 3);
}

