# Roadmap

## Phase A — local mobile PWA (complete)

- mobile shell and Planner Week/Day/Month;
- installable offline PWA;
- IndexedDB primary storage/localStorage migration;
- Tauri SQLite persistence and local backups.

## Phase B — shared household phase 1 (implemented behind flag)

- Supabase email/password Auth, password reset, persisted session, safe logout;
- owner/member household and one-time expiring email invite;
- versioned entity tables, RLS, soft delete, audit metadata;
- explicit backed-up upload of current local data;
- deterministic push/pull, persistent queue, bounded backoff, optimistic versions;
- manual Keep mine / Use remote / Cancel conflicts;
- Realtime only after queue and pull;
- compact sync status and safe missing-configuration fallback.

Production activation still requires applying/reviewing the migration and completing two-user RLS tests in the target Supabase project.

## Phase C — hardening and desktop parity

- enable the already prepared SQLite queue adapter for Tauri cloud sync;
- multi-household local snapshots/switching rather than one active aggregate;
- hosted integration test environment for Auth/RLS/Realtime;
- server-side email delivery wrapper and abuse monitoring;
- schema constraints/generated columns for operational reporting without exposing payloads;
- conflict history and richer audit review.

## Phase D — later entities

- goals and goal transfers;
- attachments with private Storage policies;
- imports/import rows and categorization rules;
- advanced audit/export APIs.

## Phase E — production resilience

- managed backup and point-in-time restore drills;
- dependency, RLS, CSP, privacy, and threat-model review;
- monitoring without financial values/tokens;
- optional encrypted backups and local biometric/PIN gate.

