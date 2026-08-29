const BASE = "https://dubaipremiertourism.com";

function headers(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function read(path, limit = 800000) {
  const response = await fetch(BASE + path, {
    redirect: "follow",
    headers: { "user-agent": "PremierExpressReadOnlySEOAudit/1.0" },
    signal: AbortSignal.timeout(10000)
  });
  const text = (await response.text()).slice(0, limit);
  return {
    ok: response.ok,
    status: response.status,
    final_url: response.url,
    content_type: response.headers.get("content-type") || "",
    cache_control: response.headers.get("cache-control") || "",
    text
  };
}

function count(source, pattern) { return (source.match(pattern) || []).length; }
function first(source, pattern) { return source.match(pattern)?.[1]?.trim() || ""; }

export default async function handler(req, res) {
  headers(res);
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "METHOD_NOT_ALLOWED" });
  if (!sameOrigin(req)) return res.status(403).json({ success: false, error: "SAME_ORIGIN_REQUIRED" });
  if (req.body?.action !== "technical_snapshot") return res.status(400).json({ success: false, error: "READ_ONLY_ACTION_REQUIRED" });
  try {
    const [home, robots, sitemap] = await Promise.all([read("/"), read("/robots.txt", 20000), read("/sitemap_index.xml", 100000)]);
    const html = home.text;
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(x => x[0]);
    const lazyImages = images.filter(x => /loading\s*=\s*["']lazy["']/i.test(x)).length;
    const result = {
      success: true,
      mode: "READ_ONLY_TECHNICAL_SNAPSHOT",
      target: BASE,
      writes: 0,
      checked_at: new Date().toISOString(),
      availability: { status: home.status, final_url: home.final_url, content_type: home.content_type, cache_control: home.cache_control },
      crawl: {
        robots_status: robots.status,
        robots_has_sitemap: /\bsitemap\s*:/i.test(robots.text),
        robots_blocks_all: /user-agent\s*:\s*\*[\s\S]{0,500}?disallow\s*:\s*\/\s*(?:\r?\n|$)/i.test(robots.text),
        sitemap_status: sitemap.status,
        sitemap_entries: count(sitemap.text, /<sitemap\b/gi)
      },
      on_page: {
        title: first(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
        meta_description: first(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) || first(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i),
        canonical: first(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i) || first(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i),
        viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
        h1_count: count(html, /<h1\b/gi),
        h2_count: count(html, /<h2\b/gi),
        structured_data_blocks: count(html, /<script[^>]+type=["']application\/ld\+json["']/gi)
      },
      ux_markup: {
        image_count: images.length,
        lazy_image_count: lazyImages,
        form_count: count(html, /<form\b/gi),
        button_count: count(html, /<button\b/gi),
        nav_count: count(html, /<nav\b/gi),
        lang_declared: /<html[^>]+lang=["'][^"']+["']/i.test(html)
      },
      limitations: ["No Core Web Vitals field data", "No JavaScript-rendered interaction test", "Homepage snapshot only", "No change or write capability"]
    };
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ success: false, error: "READ_ONLY_AUDIT_FAILED", detail: error?.message || String(error), writes: 0 });
  }
}
