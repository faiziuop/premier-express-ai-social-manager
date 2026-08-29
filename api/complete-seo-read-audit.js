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

async function read(path, limit = 800000, timeoutMs = 10000) {
  const response = await fetch(BASE + path, {
    redirect: "follow",
    headers: { "user-agent": "PremierExpressReadOnlySEOAudit/1.0" },
    signal: AbortSignal.timeout(timeoutMs)
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

function robotsGroups(source) {
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => {
    if (agents.length) groups.push({ agents: [...agents], rules: [...rules] });
    agents = [];
    rules = [];
  };
  for (const raw of String(source || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) {
      if (rules.length) flush();
      continue;
    }
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if (agents.length && (key === "allow" || key === "disallow")) {
      rules.push({ key, value });
    }
  }
  flush();
  return groups;
}

function botDirectiveEvidence(source) {
  const groups = robotsGroups(source);
  return ["GPTBot", "ChatGPT-User", "Google-Extended", "ClaudeBot", "PerplexityBot"].map(bot => {
    const exact = groups.filter(group => group.agents.includes(bot.toLowerCase()));
    const applicable = exact.length ? exact : groups.filter(group => group.agents.includes("*"));
    const explicitlyBlocked = applicable.some(group => group.rules.some(rule => rule.key === "disallow" && rule.value === "/"));
    return {
      bot,
      status: explicitlyBlocked ? "explicitly_blocked" : "not_explicitly_blocked",
      source_group: exact.length ? "specific" : "wildcard_or_none"
    };
  });
}

function schemaTypes(source) {
  const types = new Set();
  const blocks = [...String(source || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const type = value["@type"];
    (Array.isArray(type) ? type : [type]).filter(Boolean).forEach(item => types.add(String(item)));
    Object.values(value).forEach(visit);
  };
  for (const block of blocks) {
    try { visit(JSON.parse(block[1])); } catch {
      for (const match of block[1].matchAll(/["']@type["']\s*:\s*["']([^"']+)["']/gi)) types.add(match[1]);
    }
  }
  return [...types].sort((a, b) => a.localeCompare(b));
}

function validTarget(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "dubaipremiertourism.com";
  } catch { return false; }
}

function excludedPath(pathname) {
  return /\/(?:wp-admin|wp-login|my-account|cart|checkout)(?:\/|$)/i.test(pathname);
}

function decodeXml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function xmlLocations(source) {
  return [...String(source || "").matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map(match => decodeXml(match[1].trim()));
}

function normalizePublicUrl(value) {
  try {
    const url = new URL(value);
    if (!validTarget(url) || url.search || excludedPath(url.pathname)) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

function robotsRuleMatches(path, pattern) {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const expression = raw.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  try { return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(path); } catch { return false; }
}

function robotsAllows(source, url) {
  const groups = robotsGroups(source);
  const named = groups.filter(group => group.agents.includes("premierexpressreadonlyseoaudit"));
  const applicable = named.length ? named : groups.filter(group => group.agents.includes("*"));
  const path = new URL(url).pathname;
  const matches = applicable.flatMap(group => group.rules).filter(rule => rule.value && robotsRuleMatches(path, rule.value));
  if (!matches.length) return true;
  matches.sort((a, b) => b.value.length - a.value.length || (a.key === "allow" ? -1 : 1));
  return matches[0].key === "allow";
}

async function boundedReadUrl(initialUrl, limit = 350000, timeoutMs = 10000) {
  let current = initialUrl;
  const redirects = [];
  for (let hop = 0; hop <= 5; hop += 1) {
    if (!validTarget(current)) throw Error("TARGET_OUTSIDE_ALLOWLIST");
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": "PremierExpressReadOnlySEOAudit/1.0" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      const next = new URL(response.headers.get("location"), current).href;
      if (!validTarget(next)) throw Error("REDIRECT_OUTSIDE_ALLOWLIST");
      redirects.push({ status: response.status, from: current, to: next });
      current = next;
      continue;
    }
    return {
      status: response.status,
      final_url: current,
      content_type: response.headers.get("content-type") || "",
      x_robots_tag: response.headers.get("x-robots-tag") || "",
      redirects,
      text: (await response.text()).slice(0, limit)
    };
  }
  throw Error("TOO_MANY_REDIRECTS");
}

async function mapLimit(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return output;
}

async function discoverCrawlUrls() {
  const robots = await read("/robots.txt", 30000, 20000);
  if (robots.status !== 200) throw Error("ROBOTS_UNAVAILABLE");
  const declared = [...robots.text.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)].map(match => match[1]).filter(validTarget);
  const queue = declared.length ? declared.slice(0, 20) : [`${BASE}/sitemap_index.xml`];
  const seenSitemaps = new Set();
  const urls = [];
  const seenUrls = new Set();
  while (queue.length && seenSitemaps.size < 30 && urls.length < 250) {
    const batch = queue.splice(0, 3).filter(url => !seenSitemaps.has(url));
    batch.forEach(url => seenSitemaps.add(url));
    const documents = await mapLimit(batch, 3, async url => {
      try { return { url, response: await boundedReadUrl(url, 600000, 20000), error: "" }; }
      catch (error) { return { url, response: null, error: error?.message || String(error) }; }
    });
    for (const document of documents) {
      if (!document.response || document.response.status !== 200) continue;
      const locations = xmlLocations(document.response.text);
      if (/<sitemapindex\b/i.test(document.response.text)) {
        for (const location of locations) if (validTarget(location) && !seenSitemaps.has(location) && queue.length < 30) queue.push(location);
      } else {
        for (const location of locations) {
          const normalized = normalizePublicUrl(location);
          if (!normalized || seenUrls.has(normalized) || !robotsAllows(robots.text, normalized)) continue;
          seenUrls.add(normalized);
          urls.push(normalized);
          if (urls.length >= 250) break;
        }
      }
    }
  }
  if (!urls.length) throw Error("SITEMAP_DISCOVERY_EMPTY");
  return { urls, robots_status: robots.status, sitemap_documents: seenSitemaps.size };
}

async function auditCrawlPage(url) {
  try {
    const response = await boundedReadUrl(url);
    const html = /text\/html/i.test(response.content_type) ? response.text : "";
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
    const h1Elements = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
    const nonemptyH1Count = h1Elements.filter(match => match[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").trim()).length;
    const emptyH1Count = h1Elements.length - nonemptyH1Count;
    const imagesMissingAltAttribute = images.filter(tag => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;
    const imagesEmptyAlt = images.filter(tag => /\balt\s*=\s*["']\s*["']/i.test(tag)).length;
    const links = [...html.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)].map(match => match[1]);
    const internalLinks = links.filter(link => { try { return new URL(link, response.final_url).hostname === "dubaipremiertourism.com"; } catch { return false; } }).length;
    const metaRobots = first(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["'][^>]*>/i) || first(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["'][^>]*>/i);
    const title = first(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, " ");
    const metaDescription = first(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) || first(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
    const canonical = first(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i) || first(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
    const noindex = /\bnoindex\b/i.test(`${response.x_robots_tag} ${metaRobots}`);
    return {
      url,
      status: response.status,
      final_url: response.final_url,
      redirect_count: response.redirects.length,
      content_type: response.content_type,
      indexable_observation: response.status >= 200 && response.status < 300 && !noindex,
      title,
      title_length: title.length,
      meta_description_length: metaDescription.length,
      canonical,
      h1_count: h1Elements.length,
      h1_nonempty_count: nonemptyH1Count,
      empty_h1_count: emptyH1Count,
      h2_count: count(html, /<h2\b/gi),
      structured_data_blocks: count(html, /<script[^>]+type=["']application\/ld\+json["']/gi),
      internal_link_count: internalLinks,
      image_count: images.length,
      images_missing_alt: imagesMissingAltAttribute,
      images_missing_alt_attribute: imagesMissingAltAttribute,
      images_empty_alt: imagesEmptyAlt,
      error: ""
    };
  } catch (error) {
    return { url, status: 0, final_url: url, redirect_count: 0, indexable_observation: false, error: error?.message || String(error) };
  }
}

async function crawlDryRunBatch(req, res) {
  if (!req.headers.origin) return res.status(403).json({ success: false, error: "BROWSER_ORIGIN_REQUIRED", writes: 0 });
  const offset = Number(req.body?.offset);
  if (!Number.isInteger(offset) || offset < 0 || offset >= 250) return res.status(400).json({ success: false, error: "INVALID_BATCH_OFFSET", writes: 0 });
  const discovery = await discoverCrawlUrls();
  const batchUrls = discovery.urls.slice(offset, Math.min(offset + 10, 250));
  const pages = await mapLimit(batchUrls, 3, auditCrawlPage);
  const nextOffset = offset + pages.length;
  return res.status(200).json({
    success: true,
    mode: "READ_ONLY_SITEWIDE_CRAWL_DRY_RUN",
    target: BASE,
    writes: 0,
    persistence: 0,
    checked_at: new Date().toISOString(),
    controls: { max_urls: 250, batch_size: 10, concurrency: 3, methods: ["GET"], sitemap_only: true },
    discovery: { eligible_urls_capped: discovery.urls.length, robots_status: discovery.robots_status, sitemap_documents: discovery.sitemap_documents },
    batch: { offset, count: pages.length, next_offset: nextOffset, done: nextOffset >= discovery.urls.length || nextOffset >= 250 },
    pages,
    limitations: ["No JavaScript rendering", "No Core Web Vitals call", "No browser interaction", "No durable storage", "No numerical SEO score"]
  });
}

export default async function handler(req, res) {
  headers(res);
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "METHOD_NOT_ALLOWED" });
  if (!sameOrigin(req)) return res.status(403).json({ success: false, error: "SAME_ORIGIN_REQUIRED" });
  const action = req.body?.action;
  if (!new Set(["technical_snapshot", "crawl_dry_run_batch"]).has(action)) return res.status(400).json({ success: false, error: "READ_ONLY_ACTION_REQUIRED" });
  try {
    if (action === "crawl_dry_run_batch") return await crawlDryRunBatch(req, res);
    const [home, robots, sitemap] = await Promise.all([read("/"), read("/robots.txt", 20000), read("/sitemap_index.xml", 100000)]);
    const html = home.text;
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(x => x[0]);
    const lazyImages = images.filter(x => /loading\s*=\s*["']lazy["']/i.test(x)).length;
    const entityTypes = schemaTypes(html);
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
      ai_readiness: {
        robots_directives: botDirectiveEvidence(robots.text),
        schema_types: entityTypes,
        organization_type_present: entityTypes.some(type => /^(Organization|LocalBusiness|TravelAgency)$/i.test(type)),
        brand_name_present: /Premier\s+Express\s+Tourism/i.test(html),
        answer_tests_run: 0,
        citations_measured: false,
        interpretation: "Crawler directives and entity markup are readiness signals only; they do not prove crawling, answer inclusion, ranking, or citation."
      },
      limitations: ["No Core Web Vitals field data", "No JavaScript-rendered interaction test", "Homepage snapshot only", "No change or write capability"]
    };
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ success: false, error: "READ_ONLY_AUDIT_FAILED", detail: error?.message || String(error), writes: 0 });
  }
}
