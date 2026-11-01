# Premier Express Business Manager V2

This directory is the isolated Next.js application deployed by the V2 Vercel project. The Vercel project root directory is configured as `apps/v2`, so legacy API handlers and the existing application are not bundled into this deployment.

## Local setup

1. Install dependencies with `npm install`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the local environment.
3. Run `npm run dev`.
4. Run `npm run build` before opening a pull request.

## Data and security

- V2 uses its own Supabase project; it does not point to the legacy production database.
- Every exposed public table has RLS enabled.
- User-owned relationships use composite foreign keys to prevent cross-owner references.
- Social media uploads use a private bucket with per-user folder policies.
- OAuth secrets are not readable through the authenticated Data API.
- Website publication policy is locked to Content 90+ and SEO 100, with both approvals required and dry-run as the default.
- External publishing and WordPress execution remain disabled until their adapters, approvals and end-to-end tests are completed.

## Current delivery status

This is an actively built foundation, not yet the complete business manager. Provider OAuth, publishing queues, GSC ingestion, WordPress intelligence execution, and full acceptance testing remain separate delivery stages.
