# Premier Express Business Manager V2 — Rebuild Charter

## Safety and release rules
- This is an isolated V2. The legacy production Vercel project and Supabase project remain unchanged and available as fallback.
- Never delete or overwrite legacy data during development. Migrate only after table-by-table mapping, row counts, integrity checks, and explicit validation.
- All external writes (social publishing, Google Business Profile posts/replies, WordPress edits/publication, payments) require authenticated authorization and an auditable approval record.
- Secrets are server-only. Never expose service-role keys, OAuth tokens, refresh tokens, or provider credentials to browser code.
- All user-owned records use owner-scoped Row Level Security. No broad authenticated-only policies without ownership checks.
- Use idempotency keys, bounded retries, queue leases, backoff, provider rate limits, and dead-letter handling for asynchronous work.
- Keep scheduled jobs small and bounded. Avoid broad polling, full-table scans, and duplicate snapshots that increase egress.
- No automatic production deployment or destructive migration from a feature branch.

## Company defaults
- Premier Express Tourism LLC
- https://www.dubaipremiertourism.com
- WhatsApp +971562026553
- info@dubaipremiertourism.com
- Default timezone Asia/Dubai
- Default tour guide language English; Arabic or another requested language is arranged on customer request.

## Required modules
1. Dashboard: system health, agent runs, failed tasks, approval queue, notifications, and usage/egress visibility.
2. AI Social Manager: research, content calendar, drafts, manual edits, approvals, scheduling, publishing, analytics, and audit history.
3. Facebook: JPG/PNG/WebP optional media; WhatsApp CTA on every post including text-only posts; native CTA where supported, otherwise tracked WhatsApp URL; persist external post ID.
4. Instagram: agent-created Reel as default media plan with manual image/video upload and replacement controls; H.264 1080x1920 pilot profile; preserve separate Facebook publishing behavior.
5. WhatsApp/CRM: leads, customer follow-up, booking pipeline, attribution, revenue, and historical record preservation.
6. Website Intelligence / SEO Control Center: WordPress/WooCommerce read and draft workflow, GSC data, product-level research, scoring, approval, and publication audit.
7. Google Business Profile: account connection, business information, posts, review management/replies; provider API access and human approval required.
8. LinkedIn: company page connection, posts, analytics; only scopes/API products actually approved by LinkedIn.
9. Quotations: searchable records, PDF preview/print, Times New Roman, narrow margins, Company label, client and quotation details, PO number PET-MMM-####, lifecycle status after creation.
10. Letters: searchable records and PDFs; signatory Said Mustafa, Manager, PREMIER EXPRESS TOURISM LLC; signature above compact signatory details and blue company stamp.
11. Integrations: secure OAuth state, token lifecycle, revocation, health checks, provider-specific permission status.

## SEO content and publishing policy — immutable
- SEO target: exactly 100/100.
- Content target: 100/100.
- Publication blocked below Content 90/100.
- Publication allowed only at Content 90–100 AND SEO 100/100, with all factual/duplicate/technical checks passed.
- Never clamp or misrender scores above 100 as 91; scores must be integer 0–100 with explicit component evidence.
- First approval and final execute approval are both required before WordPress writes.
- Default to shadow/dry-run. No automatic WordPress publication.
- Before draft: Yoast focus keyphrase, four related keyphrases, and 4–5 synonyms per phrase.
- Page layout: 70–110-word short description; Tour/Service Overview; What to Expect; Highlights; Inclusions; Exclusions; Timings & Duration; Booking Cancellation & Refund Policy; Why Choose Premier Express Tourism (5–6 useful bullets); Related Experiences after Why Choose with real internal links; FAQs; Vehicle Capacity only when verified.
- Distinct primary/related terms per product. Use terms naturally in short description, body, H2/H3, and meta description.
- English-speaking guides included by default; Arabic or other language guide on customer request.
- Never invent prices, capacities, timings, inclusions, permits, availability, refund terms, or other commercial facts.

## Google Search Console data integrity
- Store daily, property-scoped snapshots and query/page dimensions separately.
- Compare identical date ranges and the same property.
- Deduplicate overlapping snapshots; never sum repeated full-range snapshots.
- CTR = clicks / impressions; average position is impression-weighted.
- Preserve raw source rows and fetch metadata for audit.

## Architecture requirements
- Next.js App Router + TypeScript, server/client boundaries explicit.
- Supabase Auth, Postgres, Storage, Edge Functions only where justified.
- Separate dev/preview/production environments and migration history.
- Service-role credentials are server-only; prefer user-scoped authenticated queries for user-facing CRUD.
- Use explicit ownership columns and RLS for every exposed table.
- OAuth tokens encrypted at rest and accessible only to trusted server execution.
- Provider adapters isolate Meta, Instagram, LinkedIn, Google Business Profile, WordPress, and Search Console.
- Durable queue with idempotency, bounded retries, lock/lease expiry, and observability.
- Automated unit, integration, RLS, migration, and end-to-end tests.
- Monitoring for latency, errors, auth failures, queue depth, token expiry, provider quotas, and database egress.

## Phased delivery
A. Inventory legacy code, schema, data counts, storage, functions, cron, secrets (names only), integrations, and failures.
B. Build clean foundation and secure schema.
C. Implement auth, roles, dashboard, audit log, settings, and health monitoring.
D. Implement CRM, leads, bookings, quotations, and letters.
E. Implement social content, approvals, queues, publishing adapters, and analytics.
F. Implement Website Intelligence and GSC without weakening the immutable policy.
G. Implement Google Business Profile and LinkedIn only to the extent external approvals permit.
H. Migrate validated historical data and test parity.
I. Run acceptance, security, performance, quota, and failure-recovery tests.
J. Cut over only after all acceptance gates pass. Keep legacy available until the owner explicitly confirms retirement.

## Initial V2 database
The initial Supabase migration creates owner-scoped tables for profiles, business settings, services, agent runs/settings, social connections, campaigns, posts, versions, approvals, publishing queue, leads, bookings, payments, quotations, letters, website properties, SEO product reviews, immutable SEO publication policy, Search Console snapshots, media assets, and audit events. OAuth secrets are isolated from authenticated Data API access.
