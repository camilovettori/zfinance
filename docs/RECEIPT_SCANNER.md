# Scan receipts directly in HomeCoin

Open **Add → Scan receipt** on desktop, or **+ → Scan receipt photo** on mobile.
Take or choose a JPG, PNG or WebP photo below 5 MB. The image goes to Anthropic for extraction; HomeCoin does not save the photo. Review and edit merchant, amount, date, category and account, then select **Save paid expense**. Nothing is recorded before this confirmation.

The scanner creates a normal local paid expense tagged `receipt-scan`, updates the balance with the existing calculation code and queues the transaction for normal household sync. Retrying a save uses the same ID, preventing a second expense. Images in another currency, unclear totals and invalid dates are rejected. Missing dates default to today's Dublin date and can be edited before saving. The selected account must use the household currency.

## Server setup (no Meta account required)

1. Authenticate the Supabase CLI with `npx supabase login`.
2. Deploy only `20261104190405_receipt_scan_quota.sql` using the normal reviewed migration workflow. It is independent of WhatsApp tables. Do not replay historical migrations against the existing project.
3. Configure `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`) and optionally `RECEIPT_ALLOWED_ORIGINS` in Supabase secrets. Use a server-only ignored `.env.local` file; never use a `VITE_` prefix for the Claude key.
4. Deploy `receipt-scan` with the shared import map specified in `supabase/config.toml`. JWT gateway validation is disabled because the function validates the user token with Supabase Auth and uses that token for RLS-protected household reads. The quota RPC also checks membership and limits scans to 20 per user per hour.

```sh
npx supabase secrets set --remote=hwiejxfiaestmycfkdzy --env-file supabase/functions/.env.receipt.local
npx supabase functions deploy receipt-scan --remote=hwiejxfiaestmycfkdzy --no-verify-jwt
```

Check `functions deploy --help` if your installed CLI uses different target flags.

The browser must be signed in to cloud sync to scan. Once extraction finishes, saving uses the local-first database. The function never inserts financial transactions or holds the service-role key. Only extraction consumes Claude API usage.

## Checks

`pnpm exec vitest run src/tests/receipt-scanner.test.tsx src/tests/whatsapp.test.ts`

`npx deno check --config supabase/functions/deno.json supabase/functions/receipt-scan/index.ts`

`npx deno run --no-config --node-modules-dir=none -A supabase/tests/whatsapp.integration.ts`

The SQL test exercises the quota in an isolated PostgreSQL instance, without hosted data or credentials. Provider delivery must additionally be verified with a real receipt after secrets are configured.

An optional live smoke test is available with `node scripts/test-receipt-scan.mjs`. It uses the existing test-user credentials in `.env.test.local`, renders a fictional receipt and calls the deployed scanner. It consumes one Claude scan, but does not insert any expense. Live validation on 4 November 2026 returned HTTP 200 with the correct total (1,999 cents) and receipt date.
