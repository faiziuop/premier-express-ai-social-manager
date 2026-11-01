# V2 database migration ledger

The following migrations are applied to the isolated V2 Supabase project. This ledger mirrors the remote migration history. The source SQL files still need to be backfilled into this repository before the branch is considered fully reproducible.

| Version | Migration |
|---|---|
| 20261101093152 | initial_business_manager_v2_schema |
| 20261101093930 | index_foreign_keys_for_query_performance |
| 20261101093943 | secure_monthly_quotation_numbering |
| 20261101094032 | secure_quote_sequence_with_owner_rls |
| 20261101094102 | lock_profile_permissions_and_seo_approval_gates |
| 20261101094516 | enforce_tenant_safe_relationships |
| 20261101094532 | index_tenant_scoped_foreign_keys |
| 20261101094540 | remove_redundant_single_column_indexes |
| 20261101094602 | prevent_quotation_number_collisions_across_years |
| 20261101094707 | allow_quotation_without_initial_status |
| 20261101095005 | private_owner_scoped_social_media_bucket |
| 20261101095126 | enforce_daily_deduplicated_search_console_snapshots |
| 20261101095136 | enforce_seo_publication_score_and_approval_gates |
| 20261101095745 | add_social_metrics_whatsapp_gsc_and_product_knowledge |
| 20261101095756 | add_website_intelligence_archive_and_social_enrichment |
| 20261101095805 | add_website_seo_audit_history |
| 20261101095816 | extend_agent_runs_media_and_archive_flexibility |
| 20261101095827 | expand_quotation_letter_and_business_profile_legacy_fields |\n| 20261101100318 | index_new_owner_scoped_foreign_keys |

## Current schema checks

- 34 public tables.
- RLS enabled on all 34 public tables.
- OAuth integration secrets have no authenticated Data API policy and are intended for trusted server-side use only.
- 23 composite owner-scoped foreign-key relationships enforce tenant-safe references.
- Private `social-media` Storage bucket accepts JPG, PNG, WebP and MP4 up to 100 MB, with owner-folder policies.
- Search Console raw metrics have a daily deduplication index.
- SEO publication hard gate requires Content >= 90, SEO = 100, both approval timestamps, and approved/published state before authorization can be true.

Do not reset or re-run the remote database migrations. Backfilled repository SQL must match the applied version history exactly before using `supabase db push`.
