// api/reindex.js
import { setTimeout as wait } from "node:timers/promises";

const SITE = "https://www.electrominds.com.co";
const ROOT_SITEMAP = `${SITE}/sitemap.xml`;

// util: descarga con pequeño timeout
async function fetchText(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

function decode(str = "") {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function pick(re, html) {
  const m = html.match(re);
  return m ? decode(m[1]).trim() : "";
}

// extrae metadatos básicos de una página Wix/Store
function extractDoc(html, url) {
  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, html) ||
    pick(/<title>([^<]+)<\/title>/i, html);

  const text =
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, html);

  const image =
    pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i, html);

  const price =
    pick(/"price"\s*:\s*"([^"]+)"/i, html) ||
    pick(/itemprop=["']price["'][^>]+content=["']([^"']+)["']/i, html) ||
    "";

  return {
    title: title || url,
    text,
    url,
    price: price || null,
    image: image || null,
  };
}

async function scrapeMany(urls, { concurrency = 8 } = {}) {
  const docs = [];
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const my = i++;
      const u = urls[my];
      try {
        const html = await fetchText(u, { timeoutMs: 12000 });
        const doc = extractDoc(html, u);
        docs.push(doc);
      } catch {
        // ignora errores individuales
      }
      // micro-respiro para no abrumar
      await wait(5);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return docs;
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const max = Math.max(1, Math.min(Number(url.searchParams.get("max")) || 120, 600));
  const includeData = url.searchParams.has("data"); // /api/reindex?data=1
  const t0 = Date.now();

  // 1) lee el sitemap raíz y toma los sub-sitemaps
  let xml;
  try {
    xml = await fetchText(ROOT_SITEMAP, { timeoutMs: 12000 });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "No pude leer el sitemap raíz", detail: String(e) });
  }
  const subMaps = [...xml.matchAll(/<loc>([^<]+\.xml)<\/loc>/g)]
    .map(m => m[1])
    .filter(href => href.startsWith(SITE));

  // 2) obtiene URLs de páginas desde cada sub-sitemap
  const pageUrls = [];
  for (const sm of subMaps) {
    try {
      const sx = await fetchText(sm, { timeoutMs: 12000 });
      for (const m of sx.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const u = m[1];
        if (u.startsWith(SITE)) pageUrls.push(u);
      }
    } catch {
      // continúa con los demás
    }
  }

  // 3) desduplica y recorta
  const urls = [...new Set(pageUrls)].slice(0, max);

  // 4) extrae metadatos (en paralelo controlado)
  const docs = await scrapeMany(urls, { concurrency: 8 });

  const payload = {
    ok: true,
    count: docs.length,
    sitemapCount: subMaps.length,
    taken: Date.now() - t0,
    updatedAt: Date.now(),
    sample: docs.slice(0, 3),
  };
  if (includeData) payload.docs = docs;
  res.status(200).json(payload);
}
