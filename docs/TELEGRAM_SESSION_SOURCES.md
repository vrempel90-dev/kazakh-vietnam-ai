# Telegram user-session sources

This project supports a KatokPass-style Telegram ingestion mode in addition to public `t.me/s` feeds.

## What it does

1. Authenticates a dedicated Telegram user account with `TG_API_ID`, `TG_API_HASH` and `TG_SESSION`.
2. Reads enabled channels from `config/telegram-session-sources.json`.
3. Collects posts inside the configured TTL window (24 hours by default).
4. Writes a temporary JSON handoff file.
5. The existing Node aggregation pipeline parses routes/dates/prices, applies customer pricing, deduplicates offers, applies lifecycle TTL, updates the Mini App feed and can publish fresh offers to Telegram.

The temporary collector file is not committed.

## Secrets

Configure these as GitHub Actions secrets:

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION`

The session grants access to the Telegram account. Use a dedicated account subscribed only to the required supplier channels.

## Sources

Edit `config/telegram-session-sources.json`.

A source can be resolved by:

- numeric Telegram channel id (`-100...`);
- a title substring among the account dialogs;
- an invite link when the account is already joined;
- a public `@username` or Telegram link.

## Runtime

The scheduled GitHub Action runs every 15 minutes. If the three Telegram user-session secrets are absent, the collector is skipped and the rest of the aggregation pipeline continues normally.
