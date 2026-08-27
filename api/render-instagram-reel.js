const { spawn } = require("node:child_process");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const ffmpegPath = require("ffmpeg-static");

const SUPABASE_URL = "https://ivtwkyfiagouazopttlc.supabase.co";
const ALLOWED_MEDIA_HOSTS = new Set(["ivtwkyfiagouazopttlc.supabase.co"]);

function reply(res, status, body, type = "application/json") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function validateUser(req) {
  const authorization = req.headers.authorization || "";
  const apikey = req.headers["x-supabase-apikey"] || "";
  if (!authorization.startsWith("Bearer ") || !apikey) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { authorization, apikey } });
  return response.ok ? { authorization, apikey } : null;
}

async function loadPostImages(postId, auth) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/manual-media-register`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list_reel_images", post_id: postId })
  });
  const text = await response.text();
  let result = {};
  try { result = JSON.parse(text); } catch {}
  if (!response.ok || result.success === false) throw new Error(result.error || text || `Could not read Reel images (${response.status}).`);
  return [...new Set((result.image_urls || []).map(String).filter(Boolean))].slice(0, 6);
}

async function downloadImage(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_MEDIA_HOSTS.has(parsed.hostname)) throw new Error("Only registered Premier Express media can be rendered.");
  const response = await fetch(parsed, { redirect: "error" });
  if (!response.ok) throw new Error(`Could not download source image (${response.status}).`);
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/")) throw new Error("Every Reel source must be an image.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15 * 1024 * 1024) throw new Error("A source image exceeds 15 MB.");
  await writeFile(destination, bytes);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", chunk => { if (errorText.length < 12000) errorText += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`Reel rendering failed (${code}): ${errorText.slice(-1200)}`)));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { success: false, error: "Method not allowed" });
  let workdir;
  try {
    const auth = await validateUser(req);
    if (!auth) return reply(res, 401, { success: false, error: "Authenticated Social Manager session required." });
    const postId = String(req.body?.post_id || "");
    if (!postId) return reply(res, 400, { success: false, error: "post_id is required." });
    const urls = await loadPostImages(postId, auth);
    if (!urls.length) return reply(res, 400, { success: false, error: "At least one image is required." });
    const seconds = Math.max(6, Math.min(18, Math.max(Number(req.body?.duration_seconds || 0), Math.max(8, urls.length * 3))));
    workdir = await mkdtemp(path.join(tmpdir(), "ig-reel-"));
    const inputs = [];
    for (let i = 0; i < urls.length; i++) {
      const file = path.join(workdir, `source-${i}.img`);
      await downloadImage(urls[i], file);
      inputs.push(file);
    }
    const perImage = seconds / inputs.length;
    const args = ["-hide_banner", "-loglevel", "error"];
    for (const input of inputs) args.push("-i", input);
    args.push("-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    const chains = inputs.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0007,1.08)':d=${Math.ceil(perImage * 30)}:s=1080x1920:fps=30,setsar=1[v${i}]`);
    const concatInputs = inputs.map((_, i) => `[v${i}]`).join("");
    args.push("-filter_complex", `${chains.join(";")};${concatInputs}concat=n=${inputs.length}:v=1:a=0,format=yuv420p[outv]`, "-map", "[outv]", "-map", `${inputs.length}:a:0`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest", "-t", String(seconds), path.join(workdir, "reel.mp4"));
    await runFfmpeg(args);
    const output = await readFile(path.join(workdir, "reel.mp4"));
    if (output.length > 20 * 1024 * 1024) throw new Error("Rendered Reel exceeds the 20 MB pilot limit.");
    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", String(output.length));
    res.setHeader("X-Reel-Image-Count", String(urls.length));
    res.setHeader("Access-Control-Expose-Headers", "X-Reel-Image-Count");
    res.setHeader("Cache-Control", "no-store");
    res.end(output);
  } catch (error) {
    reply(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
};
