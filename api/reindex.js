// api/reindex.js
import axios from "axios";
import { parseStringPromise } from "xml2js";
import * as cheerio from "cheerio";

/**
 * Sitio base (Wix)
 */
const SITE = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${SITE}/sitemap.xml`;

/**
 * Memoria en caliente (dura mientras no haya cold start)
 */
const STATE = globalThis.__EM_INDEX || (globalThis.__EM_INDEX = { docs: [], updatedAt: 0 });

/**
 * Extrae todas las URLs de los sitemaps de Wix
 */
async function getAllSitemapUrls() {
  const { data } = await axios.get(SITEMAP_INDEX, { timeout: 20000 });
  const xml = await parseStringPromise(data);
  const sitemapList = xml.sitemapindex?.sitemap?.map(s => s.loc[0]) || [];
  const urls = [];

  for (const sm of sitemapList) {
    try {
      const { data: smxml } = await axios.get(sm, { timeout: 20000 });
      const smp = await parseStringPromise(smxml);
      const locs = smp.urlset?.url?.map(u => u.loc[0]) || [];
      urls.push(...locs);
    } catch {}
  }
  // Solo páginas del dominio
  return urls.filter(u => u.startsWith(SITE));
}

/**
 * Saca una etiqueta (grupo) simple a partir de la URL
 */
function inferGroupFromUrl(url) {
  const slug = url.toLowerCase();
  if (slug.includes("arduino")) return "arduino";
  if (slug.includes("raspberry")) return "raspberry";
  if (slug.includes("sensor")) return "sensor";
  if (slug.includes("interruptor")) return "interruptor wifi";
  if (slug.includes("vga")) return "cables vga";
  if (slug.includes("cable")) return "cables";
  return "otros";
}

/**
 * Lee título + descripción meta (rápido) para evitar timeouts
 */
async function fetchMeta(url) {
  try {
    const { data: html } = await axios.get(url, { timeout: 20000 });
    const $ = cheerio.load(html);
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim() ||
      $("h1").first().text().trim() ||
      url;

    const desc =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      "";

    return { title: title.replace(/\s+/g, " "), text: desc.replace(/\s+/g, " ") };
  } catch {
    return { title: url, text: "" };
  }
}

/**
 * GET /api/reindex?max=120
 * Reconstruye el índice en memoria (rápido: solo título/desc)
 */
export default async function handler(req, res) {
  try {
    const max = Math.max(1, Math.min(1000, Number(req.query.max) || 120));

    const allUrls = await getAllSitemapUrls();
    const productUrls = allUrls
      .filter(u => u.includes("/product-page/") || u.includes("/producto"))
      .slice(0, max);

    const start = Date.now();
    const docs = [];

    for (const url of productUrls) {
      const meta = await fetchMeta(url);
      docs.push({
        title: meta.title,
        url,
        text: meta.text,
        group: inferGroupFromUrl(url),
      });
    }

    STATE.docs = docs;
    STATE.updatedAt = Date.now();

    res.status(200).json({
      ok: true,
      count: docs.length,
      sitemapCount: allUrls.length,
      taken: Date.now() - start,
      updatedAt: STATE.updatedAt,
      sample: docs.slice(0, 3).map(d => ({ title: d.title, url: d.url, group: d.group })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "reindex_failed" });
  }
}
