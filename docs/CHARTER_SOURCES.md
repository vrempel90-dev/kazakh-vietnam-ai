# Current production source pipeline

Verified against the production audit branch based on `973c5d61ecec50980042a33b96234850cc593476` on 2026-10-01.

## Sources and processing

`source-registry.mjs` enables six public Telegram channels: `charter_forever_travel`, `bilettu`, `biletuu`, `avia07`, `chartersavia`, `charter_antalya`. `TELEGRAM_SOURCE_CHANNELS` adds unique handles. There is no production B2B, Google Sheets, user-session, or PostgreSQL adapter in this repository.

```text
t.me/s/<handle> pages + post timestamps
  -> telegram-source-adapter: route/date/raw price/metadata
  -> pricing-engine: configured rule and upward rounding
  -> flight-identity: physical identity and source provenance union
  -> flight-validator: independent direction and strict calendar/OW/RT checks
  -> offer-lifecycle: lastSeenAt + unchanged fixed TTL policy
  -> private observations: retain unexpired offers supported only by failed sources
  -> atomic public sale-price feed
  -> persistent Telegram publication journal
  -> Mini App filters, booking selection, manager handoff
```

Pricing deliberately preserves the existing production policy: ingestion treats the parsed Telegram price as the base for enabled markup rules. Defaults are OW +10,000 KZT and RT +20,000 KZT, rounded upward to the configured increment. This code does not verify that a channel price is a contractual supplier net price. Confirm that commercial assumption before changing margins; the audit does not invent supplier authorization or a price-basis migration. No markup is applied to the public cached sale price again.

## Processes

- `serve-dist.mjs` serves the built client, health/readiness, webhook, signed Telegram admin login and authenticated pricing/status/sync APIs.
- The server starts a child sync after startup and every configured interval (default 15 minutes). Its in-process flag blocks overlapping server requests.
- All sync entry points additionally acquire the same exclusive filesystem lock before reading/writing feeds or publication state.
- GitHub Actions also refreshes the checked-in static feed every 15 minutes. It has no bot token configured in this workflow. This parallel external ingestion and automatic deployment churn remains an infrastructure concern; it does not share the Railway filesystem lock.
- `sync:public-telegram` remains available and now delegates to the validated common pipeline rather than its old unpriced, undated parser.

## State and publication

| State | Default location | Behavior |
|---|---|---|
| Customer feed | `public/flights.json`; server sets `dist/client/flights.json` | Sale prices and lifecycle only; atomic write; source provenance hidden |
| Private source observations | Railway `/data/flight-observations.json`; local `.state/flight-observations.json` | Source IDs and unextended expiry; never served as customer feed |
| Pricing | Runtime `/data/pricing-rules.json` | Defaults only if missing; corruption fails explicitly; atomic update |
| Publication journal | `/data/telegram-publications.json` | Backward-compatible version 1; per-target digest, plan and flight tombstones |
| Sync lock | Explicit `FLIGHT_SYNC_LOCK_PATH`, otherwise publication state suffix when publishing, feed suffix otherwise | Exclusive `wx`; finally release; abrupt crash remains locked for operator reconciliation |
| Source diagnostics | `/tmp/charter-source-status.json` | Atomic, optional diagnostics; not a publication source of truth |

Railway publication and admin pricing writes require `RAILWAY_VOLUME_MOUNT_PATH` to contain their state file. Creating an ordinary `/data` directory does not establish persistence. Keep one replica with one attached volume. See [the runbook](production-state-runbook.md).

The Almaty local day governs the digest (10:00 <= hour < 12:00) and daytime window (10:00 <= hour < 20:00). Each country includes outbound flights first, then inbound, sorted by departure date. A single country becomes numbered parts only when its full rendered text exceeds Telegram's 4096-character limit; fields and HTML entities are preserved.

Normal price/availability changes do not create daytime posts. Hot notices are once per physical flight; future departure tombstones survive retention pruning. Cached offers never create Telegram posts. Each send is reserved durably before the API call and confirmed afterward. Explicit rejection can retry; an uncertain response stays reserved. A pending unsent country refreshes against current offers before retry; changes after partial country delivery require operator review instead of sending stale data. New hot offers can proceed while an older send is uncertain.

All-source failure retains the previous feed with its original expiry and fails the job. Partial failure retains only previously verified, future, unexpired offers whose entire provenance failed; a healthy source removal is never treated as an outage.

Production logging emits counts and duration. Detailed source diagnostics require `DEBUG_FLIGHT_SYNC=true`. Tokens and webhook secrets are redacted from Telegram errors.
