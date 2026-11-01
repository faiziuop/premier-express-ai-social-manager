# V2 legacy data preservation and migration map

**Source:** legacy Supabase project `ivtwkyfiagouazopttlc`  
**Destination:** isolated V2 Supabase project `oqwavqgjolbgqlrgdxgp`  
**Status:** read-only inventory completed; data copy has not started.

## Inventory observed

| Legacy table | Rows | V2 destination / handling |
|---|---:|---|
| business_profiles | 1 | `business_profiles` |
| services | 13 | `services` |
| social_accounts | 7 | Map non-secret account metadata to `social_connections`; reconnect tokens |
| social_connections | 2 | `social_connections`; migrate metadata only, never encrypted token columns |
| content_posts | 148 | `content_posts`; preserve platform variants, statuses, external IDs, CTA and edit history |
| media_assets | 393 | `media_assets`; copy file objects separately into private V2 storage and verify checksums |
| approval_events | 133 | `approval_events` |
| publish_jobs | 66 | `publishing_queue`; preserve status, attempts, external IDs and verification metadata |
| content_post_metrics | 66 | `content_post_metrics` |
| agent_runs | 585 | `agent_runs`; preserve run metadata, outcomes and errors |
| agent_settings | 1 | `agent_settings`; map settings selectively after validation |
| agent_campaigns | 24 | `website_intelligence_records` (agent_campaign) / content campaign mapping |
| agent_opportunities | 948 | `website_intelligence_records` (agent_opportunity) |
| agent_learning_signals | 282 | `website_intelligence_records` (agent_learning_signal) |
| product_knowledge | 99 | `product_knowledge` |
| product_knowledge_sync_runs | 43 | `website_intelligence_records` (product_knowledge_sync_run) |
| media_intelligence_plans | 102 | `media_intelligence_plans` |
| website_inventory | 2,168 | `website_inventory` |
| website_seo_audits | 606 | `website_seo_audits` |
| search_console_connections | 1 | `website_properties` metadata only; reconnect OAuth |
| search_console_metrics | 50,643 | `search_console_raw_metrics`; preserve daily query/page/country/device dimensions and source timestamps |
| seo_opportunities | 169 | `website_intelligence_records` (seo_opportunity) |
| seo_change_proposals | 312 | `website_intelligence_records` (seo_change_proposal) |
| product_seo_lifecycle | 247 | `website_intelligence_records` (product_seo_lifecycle) |
| product_seo_research_queue | 247 | `website_intelligence_records` (product_seo_research_queue) |
| seo_execution_ledger | 122 | `website_intelligence_records` (seo_execution_ledger) |
| seo_execution_events | 762 | `website_intelligence_records` (seo_execution_event) |
| seo_measurement_snapshots | 1,809 | `website_intelligence_records` (seo_measurement_snapshot) |
| seo_optimization_outcomes | 87 | `website_intelligence_records` (seo_optimization_outcome) |
| product_content_reviews | 44 | `website_intelligence_records` (product_content_review) |
| website_shadow_jobs | 244 | `website_intelligence_records` (shadow_job) |
| website_shadow_events | 626 | `website_intelligence_records` (shadow_event) |
| website_shadow_evidence | 1,729 | `website_intelligence_records` (shadow_evidence) |
| website_shadow_drafts | 406 | `website_intelligence_records` (shadow_draft) |
| website_shadow_publications | 344 | `website_intelligence_records` (shadow_publication) |
| quotations | 2 | `quotations`; preserve client, VAT, discount, terms and status fields |
| quotation_items | 8 | `quotation_items`; preserve line numbers, UOM and amounts |
| business_letters | 1 | `letters`; preserve recipient, body, status and signatory fields |
| whatsapp_tracking_registry | 73 | `whatsapp_tracking_registry` |
| learning_recommendation_snapshots | 98,351 | archive selectively as `website_intelligence_records` or `legacy_archive_records` |
| external_intelligence_signals | 16,378 | archive with source, expiry, evidence tier and metadata |
| scheduled_job_execution_ledger | 7,018 | `website_intelligence_records` (scheduled_job_execution) |
| scheduled_job_daily_summary | 1,449 | `website_intelligence_records` (scheduled_job_summary) |
| social_interaction_sync_runs | 7,704 | archive sync history; do not replay jobs |
| social_metric_sync_runs | 638 | archive sync history; do not replay jobs |
| social_profile_snapshots | 28 | `website_intelligence_records` (social_profile_snapshot) |

Other tables were also inventoried, including governance controls, provider health, anomalies, repair proposals, GBP drafts, and integration state.

## Never migrate as reusable credentials

Do not copy encrypted access/refresh tokens, OAuth state rows, service-role secrets, API keys, password material, or expired/temporary authorization state. In particular, the legacy `social_connections.encrypted_access_token` and `search_console_connections.encrypted_access_token` / `encrypted_refresh_token` columns are excluded. Reconnect Facebook, Instagram, LinkedIn and Google/Search Console in V2 through fresh provider authorization.

## Migration sequence and validation

1. Create the V2 owner account and establish its owner UUID.
2. Export source rows in bounded batches with a stable primary-key order; do not use one unbounded request.
3. Transform legacy identifiers to V2 owner-scoped IDs while preserving source IDs in migration metadata.
4. Import parent records before child records; preserve original timestamps and statuses.
5. Copy media files separately into the private `social-media` bucket, verify MIME type, size and SHA-256, then update V2 storage paths.
6. Import GSC daily rows without summing overlapping period snapshots. Keep source date, query, page, country, device and collection metadata.
7. Import Website Intelligence jobs, drafts, evidence, publication/rollback records and SEO measurement history as historical records. Do not execute queued jobs or replay publications.
8. Compare source/destination row counts, per-table checksums, key relationships, external post IDs, quotation totals, line-item totals and media hashes.
9. Keep V2 WordPress writes and social publishing disabled until the migrated state passes validation and provider reconnections are tested.

## Current migration status

No legacy records or media files have been copied. The source database and legacy production application remain unchanged. The destination schema now includes owner-scoped structures for the primary business modules, social metrics and media plans, Search Console raw metrics, website inventory/audits, generic Website Intelligence history, and a legacy archive. This document is the source-to-destination mapping baseline; the import process must still be implemented and verified.
