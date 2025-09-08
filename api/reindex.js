// api/reindex.js
import axios from "axios";
import { parseStringPromise } from "xml2js";
import * as cheerio from "cheerio";

// ===== Estado en memoria (se conserva en caliente) =====
let DOCS = [];
let UPDATED_AT = 0;

// Exportado para que ask.js pueda leerlo
export function getIndex() {
  return { docs: DOCS, updatedAt: UPDATED_AT };
}

// ===== Helpers =====
const ORIGIN = "https://www.electrominds.com.co";
const SITEMAP_INDEX_URL = `${ORIGIN}/sitemap.xml`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36";

const http = axios.create({
  timeout: 10000,
  headers: { "User-Agent": UA, Accept: "*/*" },
  // Wix a veces redirige; sigue redirecciones
  maxRedirects: 5,
});

async function fetchXml(url) {
  const { data } = await http.get(url);
  return await parseStringPromise(data);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Corre tareas con concurrencia controlada (sin lib externa)
async function runPool(items, worker, pool = 8) {
  const out = [];
  let i = 0;
  async function next() {
    while (i < items.length) {
      const cur = i++;
      try {
        const v = await worker(items[cur], cur);
        if (v) out.push(v);
      } catch {
        // ignora y sigue
      }
    }
  }
  const runners = Array.from({ length: Math.min(pool, items.length) }, next);
  await Promise.all(runners);
  return out;
}

function pick(str) {
  return (str || "").trim();
}

async function scrapeProduct(url, wantFull) {
  try {
    const { data } = await http.get(url);
    const $ = cheerio.load(data);

    // Título
    const title =
      pick($('meta[property="og:title"]').attr("content")) ||
      pick($("h1").first().text()) ||
      url;

    // Imagen principal
    const image =
      pick($('meta[property="og:image"]').attr("content")) ||
      pick($("img").first().attr("src")) ||
      "";

    // Precio (si aparece en meta product)
    const price =
      pick($('meta[property="product:price:amount"]').attr("content")) || "";

    let text = "";
    if (wantFull) {
      // Tomamos un poco de texto descriptivo (sin pasarnos)
      text =
        pick($('meta[name="description"]').attr("content")) ||
        pick($("p").slice(0, 2).text()).slice(0, 500);
    }

    return { title, url, image, price, text };
  } catch (err) {
    // Falla sola esta página, seguimos con las demás
    return null;
  }
}

async function collectProductUrls(max) {
  // 1) sitemap index
  const xml = await fetchXml(SITEMAP_INDEX_URL);
  const sitemaps = (xml.sitemapindex?.sitemap || [])
    .map((s) => s.loc?.[0])
    .filter(Boolean);

  // De todos los sitemaps, prioriza los de “store-products”
  const wanted = sitemaps.filter((u) =>
    /store-products-sitemap\.xml/i.test(u)
  );
  const all = wanted.length ? wanted : sitemaps;

  let urls = [];
  for (const sm of all) {
    try {
      const xm = await fetchXml(sm);
      const set = xm.urlset?.url || [];
      const locs = set.map((u) => u.loc?.[0]).filter(Boolean);
      // Filtra productos (evita miembros/foros si vienen mezclados)
      const prods = locs.filter((u) => /product-page\//i.test(u));
      urls.push(...prods);
      if (urls.length >= max) break;
    } catch {
      // continua
    }
  }

  // dedupe + recorta a max
  urls = Array.from(new Set(urls)).slice(0, max);
  return urls;
}

// ===== Handler principal =====
export default async function handler(req, res) {
  try {
    const { max = "120", full = "0" } = req.query;
    const wantFull = full === "1";
    const MAX = Math.max(1, Math.min(400, parseInt(max, 10) || 120));

    const urls = await collectProductUrls(MAX);

    // Concurrencia moderada: 6 con full=1, 10 con full=0
    const pool = wantFull ? 6 : 10;

    const results = await runPool(
      urls,
      async (u) => await scrapeProduct(u, wantFull),
      pool
    );

    // Limpia nulos
    const docs = results.filter(Boolean);

    DOCS = docs;
    UPDATED_AT = Date.now();

    return res.status(200).json({
      ok: true,
      count: DOCS.length,
      sample: DOCS.slice(0, 3),
      taken: urls.length,
      updatedAt: UPDATED_AT,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "INDEX_FAILED", message: String(err) });
  }
}

