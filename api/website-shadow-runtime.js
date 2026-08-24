const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN"
];

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (!sameOrigin(req)) {
    return res.status(403).json({
      success: false,
      status: "ORIGIN_REJECTED"
    });
  }

  const configured = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, Boolean(process.env[name])])
  );
  const runtimeEnabled =
    process.env.WEBSITE_SHADOW_RUNTIME_ENABLED === "true";

  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({
      success: true,
      service: "website-shadow-runtime",
      status:
        runtimeEnabled && Object.values(configured).every(Boolean)
          ? "CONFIGURED_BUT_EXECUTION_LOCKED"
          : "CONFIGURATION_LOCKED",
      configured,
      controls: {
        authentication_required: true,
        owner_rls_required: true,
        source_hash_required: true,
        immutable_draft_required: true,
        independent_excellence_required: true,
        factual_verification_required: true,
        approval_available: false,
        execution_available: false,
        wordpress_write_available: false,
        yoast_write_available: false
      }
    });
  }

  res.setHeader("Allow", "GET, HEAD");
  return res.status(423).json({
    success: false,
    status: "EXECUTION_LOCKED",
    message:
      "Website Intelligence generation is not activated. No proposal, WordPress or Yoast write was attempted."
  });
}
