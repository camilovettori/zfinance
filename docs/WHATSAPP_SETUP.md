# WhatsApp assistant

Implemented locally; inactive until Meta, Anthropic and Supabase are configured.
No numbers, credentials, cron jobs or outbound messages are provisioned by the migration.

## What is included

- Settings → WhatsApp: link your own number by sending a one-use code from WhatsApp; choose an expense account and fallback category; reminders, Dublin wall time, connection test and receipt history.
- Signed Meta webhook → durable inbox → scheduled worker → Claude receipt extraction → paid expense in `homecoin.transactions`. Existing desktop/mobile sync picks it up. Amounts remain integer cents.
- `balance` / `saldo`, `this week` / `semana`, `tomorrow` / `amanha`, `add 50 groceries`, `help`, `undo`, `START`, `STOP`.
- UNDO cancels the latest paid WhatsApp expense from that contact within 24 hours and preserves its audit/history. It does not delete historical entries.
- Daily opted-in reminders use an approved Meta template, including outside the customer service window. Summer/winter time follows `Europe/Dublin`.
- Same provider message ID is recorded once; SQL commits the transaction and receipt result atomically. Duplicate webhook deliveries cannot duplicate the expense. Delivery confirmations can repeat if a provider accepts a message and the worker crashes before recording its acknowledgement.

## External setup

1. Create a Meta business app with WhatsApp Cloud API, a business number (or a test number and allowed test recipients), and a supported Graph API version. Obtain a sending token, phone number ID and app secret. Meta account creation, number verification and billing setup are manual.
2. Create an Anthropic API key and select an available vision model. Images are transmitted to Meta and Anthropic. HomeCoin does not persist images, but provider retention policies still apply. Do not send receipts until you accept those policies.
3. Create an approved **utility template** named `homecoin_daily_reminder`, language matching `WHATSAPP_TEMPLATE_LANGUAGE`. Its body must accept **one text parameter**, for example `Your HomeCoin update: {{1}}. Reply STOP to stop reminders.` Check Meta's template eligibility and approval; provisioning this repository does not approve a template.
4. Set server-only secrets from [the example](../supabase/functions/.env.example). Generate independent random verify/cron secrets (at least 32 random bytes). Never put Meta/Anthropic/service-role keys in browser environment variables, Git or chat. Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into deployed Edge Functions.

## Deployment

Use Supabase CLI in the repo root after reviewing the target project. The existing project is `hwiejxfiaestmycfkdzy`.

```sh
npx supabase link --project-ref hwiejxfiaestmycfkdzy
npx supabase db push --dry-run
# Confirm only the intended migration will run before pushing.
npx supabase db push
npx supabase secrets set --env-file supabase/functions/.env.local
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-reminders --no-verify-jwt
npx supabase functions deploy whatsapp-test --no-verify-jwt
```

Copy `.env.example` to `.env.local` and fill it locally first. The latter is ignored by Git. This repository has historical migrations; if the hosted migration history differs, reconcile it before `db push` rather than replaying old migrations blindly.

The shared `supabase/functions/deno.json` import map reuses the app's planning/calculation code and pinned dependencies. Exact import mappings resolve the existing extensionless app imports without unstable runtime flags. Verify with the commands below before deploying. Build and publish the frontend using the normal Git/Vercel workflow after the migration is installed. Old frontend versions cannot decode the new `source: 'whatsapp'`; update installed PWAs before sending receipts.

In Meta, set callback URL:

```
https://hwiejxfiaestmycfkdzy.supabase.co/functions/v1/whatsapp-webhook
```

Use `WHATSAPP_VERIFY_TOKEN` as the verification token, subscribe to `messages`, and ensure the phone number ID matches. The webhook is intentionally public at the Supabase JWT gateway; every POST must pass the Meta HMAC signature check. The worker uses its separate cron secret. `whatsapp-test` validates the user's JWT with Auth, ownership, verified number and live household membership.

## Worker schedule (required for both scans and reminders)

Enable `pg_cron`, `pg_net` and Vault through the Supabase dashboard. Store the cron secret in Vault as `homecoin_whatsapp_cron_secret`. Then run the following once, replacing the project URL if needed. It creates no recipients and sends only to contacts who verified and opted in.

```sql
select cron.schedule('homecoin-whatsapp-worker', '* * * * *', $job$
  select net.http_post(
    url := 'https://hwiejxfiaestmycfkdzy.supabase.co/functions/v1/whatsapp-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'homecoin_whatsapp_cron_secret' limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
$job$);
```

Run every minute, not at a fixed UTC hour: reminder dispatch checks the selected Dublin local time and deduplicates each contact/date. It retries transient sends within a 10-minute window. Receipt commands are normally processed on the next tick; the personal-use worker handles up to two jobs per tick, retries extraction at most five times with five-minute leases, and never keeps the webhook connection open for vision processing. Use a dedicated queue worker before scaling beyond personal household use.

## Connect and verify

1. Sign in to cloud sync, open Settings → WhatsApp. Select an existing synced account and expense category in the household currency. Add your own international number. Another member signs in and links their own number.
2. Send `link <code>` from that number to the configured business number within 15 minutes. Refresh Settings. Codes can be read only by their owner; the server, not browser clients, controls verification.
3. Send `help`, then `balance`. Compare with the app. Click **Send test message** while the reply window is open. This is rate limited to once per minute.
4. Send a small receipt photo. Within the next worker tick check the confirmation, receipt history and paid transaction on mobile/desktop. If amount/date/currency cannot be validated, no expense is created. Category matching uses your existing expense categories, falling back to the category you selected; review the resulting category and total.
5. Repeat the same webhook provider ID in a test environment: there must be one transaction. Send UNDO: the expense is cancelled and its account effect is reversed. Do not test retries by sending the same receipt as a new WhatsApp message, which is a new expense.
6. Enable reminders, select an upcoming local time and check an approved template arrives once. Reply STOP and check notifications disable. Removing household membership must prevent data access and writes.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run src/tests/whatsapp.test.ts
npx deno check --config supabase/functions/deno.json supabase/functions/whatsapp-webhook/index.ts supabase/functions/whatsapp-reminders/index.ts supabase/functions/whatsapp-test/index.ts
```

The SQL integration test runs in an isolated in-memory PostgreSQL via PGlite, with simulated Supabase roles/Auth and a test-only random-byte shim. It does not touch hosted data:

```sh
npx deno run --no-config --node-modules-dir=none -A supabase/tests/whatsapp.integration.ts
```

Without provider credentials the end-to-end Meta delivery and image extraction cannot be verified. Costs and quotas depend on current provider pricing; the original proposal's free-tier estimates are not assumed.

## Privacy and operation

Unknown/unverified senders are ignored. Verified contacts are limited to 30 incoming messages/hour. Processed raw message payloads/media IDs are cleared; extracted transaction data and message outcomes remain for audit until the contact is disconnected. Disconnection removes WhatsApp contact/message history, preserves finance transactions and disables reminders. The service secret is never exposed to browser clients. WhatsApp writes have a dedicated transaction metadata trigger; unrelated sync tables retain their original authentication requirements.

Inspect worker counters (`jobs`, `reminders`, `failures`), cron run history and message states without logging tokens, phone numbers, receipt images or receipt contents. Retrying business delivery can produce a duplicate reminder after an ambiguous network failure; the financial write itself stays idempotent. No bill is paid by this integration: receipts record already-paid expenses in the planner.

References: [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [Meta WhatsApp messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages), [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create).
