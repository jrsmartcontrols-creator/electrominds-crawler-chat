import axios from "axios";
import { parseStringPromise } from "xml2js";
import cheerio from "cheerio";

let INDEX = globalThis.__EM_INDEX__ || { docs: [], ts: 0 };
globalThis.__EM_INDEX__ = INDEX;

const SITEMAP_URL = "https://www.electrominds.com.co/sitemap.xml";
const isUseful = (url) => /product|collections|blog|servicios|about|contact/i.test(url);

async function fetchSitemapUrls() {
  const { data } = await axios.get(SITEMAP_URL, { timeout: 20000 });
  const xml = await parseStringPromise(data);
  const urls = (xml.urlset?.url || []).map((u) => u.loc?.[0]).filter(Boolean);
  return urls.filter(isUseful);
}

async function scrape(url) {
  try {
    const { data: html } = await axios.get(url, { timeout: 20000 });
    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr("content") || $("title").text().trim() || $("h1").first().text().trim();
    const desc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") ||
      $("p").map((_, el) => $(el).text()).get().join(" ").replace(/\s+/g, " ");
    const price = $('[data-hook="formatted-price"]').first().text().trim() || $('[itemprop="price"]').first().attr("content") || "";
    const text = [title, price, desc].filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase();
    return { url, title: title || url, price, text };
  } catch {
    return null;
  }
}

function scoreDoc(qTokens, doc) {
  let score = 0;
  for (const t of qTokens) {
    const c = doc.text.split(t).length - 1;
    if (c > 0) score += Math.log(1 + c);
  }
  for (const t of qTokens) if (doc.title.toLowerCase().includes(t)) score += 0.5;
  return score;
}

export default async function handler(req, res) {
  try {
    const urls = await fetchSitemapUrls();
    const docs = [];
    for (const url of urls) {
      const d = await scrape(url);
      if (d) docs.push(d);
    }
    INDEX.docs = docs;
    INDEX.ts = Date.now();
    res.status(200).json({ ok: true, count: docs.length, updatedAt: INDEX.ts });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}

export function getIndex() { return INDEX; }
export function queryIndex(q) {
  const idx = getIndex();
  if (!idx.docs.length) return [];
  const qTokens = q.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  const scored = idx.docs.map((d) => ({ ...d, _score: scoreDoc(qTokens, d) }))
    .sort((a, b) => b._score - a._score);
  return scored.filter((d) => d._score > 0).slice(0, 3);
}
