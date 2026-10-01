# Production state migration and recovery

## Verified live infrastructure on 2026-10-01

Railway project `418d5866-c312-4516-bbee-5236735d4634`, production environment `d5679c89-0392-4f84-89d6-70325c399609`, service `charter-app` (`2f94fcce-eafd-4da6-9932-7e407a6f3738`) runs from `main`. The live configuration has one replica and no attached volume. There is no PostgreSQL service in this project.

Pending patch `9d79cd5a-ca08-43d9-9fd2-0cf5bc9e0b93` contains two volume resources (`af84edc7-75c1-4b07-96a7-5e024d476d4e` and `da048b93-5796-42e6-99d3-f216f73af16a`) both targeting `/data`. It is staged, not deployed. Do not blindly accept the entire patch: inspect its service changes and choose exactly one volume/mount. The audit has not modified or accepted that patch, restarted a service, or deployed its branch.

## Safe migration before enabling the audited publisher

1. Review the PR and the complete staged Railway patch. Prepare one `/data` volume on this single-replica service. Do not add an empty PostgreSQL just for this migration: the existing application has no database adapter.
2. Temporarily stop publication and pricing edits, and wait for the running sync to finish. Confirm no old process can publish while state is copied. Keep the application and read-only feed available as deployment mechanics permit.
3. Export the actual current `TELEGRAM_PUBLISH_STATE_PATH` and `PRICING_RULES_PATH` files from the old running container before attaching a volume. Keep private backups outside the ephemeral container, validate JSON/version/rules, and retain original files. Connector read-only configuration cannot export container files; an operator with container access must perform this step. Do not log file contents or tokens.
4. If a state file is missing/corrupt, recover its last known good backup. If no publication backup exists, reconcile current-day channel posts and hot-flight IDs before bootstrap. An empty journal would lose past dedupe evidence. An empty pricing file would apply defaults rather than recover current custom rules.
5. Mount exactly one volume at `/data`, restore the verified backups to their configured paths, and give the runtime account access. Mounting an empty volume hides the old container directory, so backup comes first.
6. Preserve `PRICING_RULES_PATH=/data/pricing-rules.json` and `TELEGRAM_PUBLISH_STATE_PATH=/data/telegram-publications.json`. Set `FLIGHT_OBSERVATION_STATE_PATH=/data/flight-observations.json` and one shared `FLIGHT_SYNC_LOCK_PATH=/data/flight-sync.lock` for all publishing sync entry points. Let Railway supply `RAILWAY_VOLUME_MOUNT_PATH`; never fake that variable to bypass the guard.
7. Deploy the reviewed branch only through the owner's normal merge/deploy process. Inspect `/health`, `/ready`, authenticated pricing/status endpoints, and source summaries with publication still disabled. Confirm the live mount and restored custom rules. Start a sync, then verify the journal and private observations remain readable after a controlled restart and a subsequent deployment.
8. Re-enable publication after confirming channel history and journal agree. Verify one country digest, part numbers when required, and a repeat sync that sends no duplicates. Retain backups until post-deployment checks pass. These are required live checks, not results of the local audit tests.

Version-1 publication files remain readable: missing newly introduced `targetPlans` is initialized safely. New normalized flight IDs carry an internal legacy ID lookup, preserving earlier lifecycle timestamps and hot dedupe evidence. This does not rewrite the old supplier per-offer override identifiers.

## Failed or uncertain sends

- `pending`: Telegram explicitly rejected the attempt or the post is queued. A future retry rechecks current source identity, price and expiry.
- `sending`: intent was persisted, but delivery is uncertain (timeout, abrupt crash, failed confirmation write). Automatic resending is prohibited. Inspect the channel and backup the journal first. If delivered, record the observed message ID and confirm that post; only reset a reservation when non-delivery is established. If certainty is impossible, retain the reservation and resolve manually.
- `review`: remaining parts changed after a country was partly sent. Reconcile already delivered parts and current source data; do not reset the entire digest and repeat successful posts.
- `sent`: persistently confirmed; never clear simply to retry another failed post.
- `expired`: no longer valid, removed before sending, or otherwise cancelled; no stale post is sent.

Future hot tombstones cannot be discarded just because 30 days or a nominal entry cap elapsed. The current implementation retains them until departure. Legacy entries without a departure date learn it from current observations when available.

## Crash lock and storage errors

Normal success/failure releases the sync lock in `finally`. SIGKILL/container loss can leave its owner record. An existing lock fails closed with `SYNC_LOCKED`; it is never deleted automatically based on a guessed timeout or container PID. This deliberately favors avoiding concurrent sends over automatic recovery.

Before removing a stale lock, establish that its recorded process/container is dead and that no alternate sync is active, back up/reconcile the publication journal, and remove only that lock file. Restart exactly one sync. Never delete pricing/publication state to clear a lock. This operator recovery is required after abrupt crashes; automatic distributed-lock recovery is not claimed.

Corrupt/unreadable pricing, publication, customer feed, or private observation state fails explicitly and retains the original artifact. Restore a validated backup after investigating the storage failure. Optional source diagnostics may fail without blocking ingestion, but produce a warning.

Without a configured Railway volume containing the private observation path, fresh feed ingestion continues with an explicit warning and skips observation ledger reads/writes. Source-specific retention during a partial outage is unavailable in this degraded mode; an all-source outage still preserves the existing public feed and its original expiry. Publication and admin pricing writes remain blocked until storage is migrated. A passing local guard test validates configured path handling, not an actual production mount.

## Remaining operational decisions

The GitHub feed workflow and Railway runtime both scrape sources, and data commits can cause repeated deployment/startup ingestion. Consider making the GitHub workflow manual after validating the runtime feed as the sole production scheduler. The audit preserves the existing schedule.

Per-offer overrides still key on Telegram post plus row index. Before migrating to semantic offer IDs, export enabled override rules, map them to physical route/date/trip/carrier identities with operator review, support old/new aliases during transition, then retire old IDs only after comparison. Do not remap rules by guessing a reordered row.

References: [Railway volumes](https://docs.railway.com/volumes), [volume limitations](https://docs.railway.com/volumes/reference), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage).
