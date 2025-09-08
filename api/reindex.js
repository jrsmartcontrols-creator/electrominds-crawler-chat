// api/reindex.js
// Node 22 / Edge-friendly
export const config = { runtime: "nodejs" };

const SITE = "https://www.electrominds.com.co";
const ROOT_SITEMAP = `${SITE}/sitemap.xml`;

// Guardamos en memoria para “calentamiento” de la misma instancia
globalThis.__CATALOGO__ ??= { docs: [], updatedAt: 0 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  const r = await fetch(url, { headers: { "user-agent": "ElectroMindsBot/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.text();
}

function xmlLocs(xml) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/gim;
  let m;
  while ((m = re.exec(xml))) locs.push(m[1].trim());
  return locs;
}

function ogMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] : "";
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function getProductImage(url) {
  try {
    const html = await fetchText(url);
    // 1) OpenGraph image
    const og = ogMeta(html, "og:image");
    if (og) return og;
    // 2) Wix images dentro del HTML (fallback simple)
    const m = html.match(/https:\/\/static\.wixstatic\.com\/[^"']+\.(?:jpg|png|webp)/i);
    return m ? m[0] : "";
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Parámetros
    const max = Math.max(1, Math.min(parseInt(url.searchParams.get("max") || "120", 10), 400));
    const full = url.searchParams.get("full") === "1"; // Si 1, abrimos cada página para sacar imagen (más lento)

    // 1) Tomamos todos los sitemaps del índice
    const idxXml = await fetchText(ROOT_SITEMAP);
    let sitemapUrls = xmlLocs(idxXml).filter(u => u.endsWith(".xml"));

    // 2) De esos sitemaps, traemos las URLs de páginas. Filtramos las que lucen a producto.
    const pageUrls = [];
    for (const sm of sitemapUrls) {
      const xml = await fetchText(sm);
      const locs = xmlLocs(xml);
      for (const loc of locs) {
        if (
          /\/product-page\//i.test(loc) ||
          /\/store-products/i.test(loc) ||
          /\/product\//i.test(loc)
        ) {
          pageUrls.push(loc);
        }
      }
    }

    // 3) Creamos documentos (limitando por max)
    const docs = [];
    const limited = pageUrls.slice(0, max);

    // Para thumbnails sólo si piden full=1 (puede tardar). Fallback: sin imagen.
    for (let i = 0; i < limited.length; i++) {
      const url = limited[i];
      // Un título rápido con la última parte de la URL, por si no hacemos "full"
      const fallbackTitle = decodeURIComponent(url.split("/").filter(Boolean).pop() || "")
        .replace(/[-_]/g, " ");

      let image = "";
      let title = fallbackTitle;
      let price = null;

      if (full) {
        // Pedimos la página y sacamos meta og:title / og:image (y si hubiera, el precio)
        const html = await fetchText(url);
        title = ogMeta(html, "og:title") || fallbackTitle;
        image = ogMeta(html, "og:image") || "";
        const priceMeta = html.match(
          /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i
        );
        price = priceMeta ? priceMeta[1] : null;

        // Pequeña pausa cada 10 para no saturar
        if (i % 10 === 9) await sleep(150);
      }

      docs.push({
        title: title.trim(),
        url,
        price,
        image,
        _norm: normalize(title)
      });
    }

    // Guardamos en memoria de esta instancia (sirve mientras no cambie de lambda)
    globalThis.__CATALOGO__ = { docs, updatedAt: Date.now() };

    return res.status(200).json({
      ok: true,
      count: docs.length,
      sample: docs.slice(0, 3).map(({ _norm, ...d }) => d),
      sitemapCount: sitemapUrls.length,
      taken: Date.now() - t0,
      updatedAt: globalThis.__CATALOGO__.updatedAt
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err),
    });
  }
}
