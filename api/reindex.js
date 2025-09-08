// /api/reindex.js
export const config = { runtime: "edge" };

const ORIGIN = "https://www.electrominds.com.co";
const SITEMAP_INDEX = `${ORIGIN}/sitemap.xml`;

// cache global en memoria del runtime
globalThis.__ELECTRO_IDX ||= { docs: [], updatedAt: 0 };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pickAll(text, re) {
  const out = [];
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

async function fetchText(url) {
  const r = await fetch(url, { headers:{ "user-agent":"Mozilla/5.0 (chat-crawler)" }});
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return await r.text();
}

function normalizeTitle(t) {
  return (t||"")
    .replace(/\s*\|\s*Electrominds\s*$/i,"")
    .replace(/\s+/g," ")
    .trim();
}

async function listProductUrls() {
  const xml = await fetchText(SITEMAP_INDEX);
  const locs = pickAll(xml, /<loc>(.*?)<\/loc>/g);
  const wanted = locs.filter(u =>
    /store-products-sitemap\.xml|pages-sitemap\.xml|product-.*-sitemap\.xml/i.test(u)
  );

  const urls = new Set();
  for (const sm of wanted) {
    try {
      const x = await fetchText(sm);
      pickAll(x, /<loc>(.*?)<\/loc>/g)
        .filter(u => /\/product-page\//i.test(u))
        .forEach(u => urls.add(u));
    } catch {}
  }
  return [...urls];
}

function parseMeta(html, prop) {
  const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

async function parseProduct(url, full) {
  if (!full) {
    // título aproximado a partir del slug
    const slug = decodeURIComponent(url.split("/product-page/")[1] || url).replace(/[-_]+/g," ");
    return { url, title: slug.trim(), price: null, image: "" };
  }
  try {
    const html = await fetchText(url);
    const title = normalizeTitle(parseMeta(html, "og:title"));
    const image = parseMeta(html, "og:image") || parseMeta(html, "twitter:image");
    return { url, title: title || url, price: null, image };
  } catch {
    return { url, title: url, price: null, image: "" };
  }
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0, active = 0;
  return await new Promise((resolve) => {
    const go = async () => {
      while (active < limit && i < items.length) {
        const idx = i++, it = items[idx];
        active++;
        fn(it).then(v => out[idx] = v).catch(()=> out[idx]=null).finally(() => {
          active--;
          if (i >= items.length && active === 0) resolve(out);
          else go();
        });
      }
    };
    go();
  });
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const max = Math.max(1, Math.min(600, Number(searchParams.get("max")) || 120));
  const full = (searchParams.get("full") === "1" || searchParams.get("full") === "true");

  let urls = [];
  try {
    urls = await listProductUrls();
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e) }), { status:500 });
  }
  urls = urls.slice(0, max);

  // limitar concurrencia al pedir páginas completas
  const CONC = full ? 5 : 10;
  const started = Date.now();

  const docs = (await mapLimit(urls, CONC, u => parseProduct(u, full)))
    .filter(Boolean);

  globalThis.__ELECTRO_IDX.docs = docs;
  globalThis.__ELECTRO_IDX.updatedAt = Date.now();

  const sample = docs.slice(0, 3).map(d => ({ title:d.title, url:d.url, price:d.price, image:d.image }));

  return new Response(JSON.stringify({
    ok: true,
    count: docs.length,
    sample,
    sitemapCount: urls.length,
    taken: Date.now() - started,
    updatedAt: globalThis.__ELECTRO_IDX.updatedAt
  }), { headers:{ "content-type":"application/json" }});
}


