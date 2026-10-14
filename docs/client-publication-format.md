# Charter publication contract

The client example is synthetic test data in `tests/client-publications.test.mjs`
only. Collection and production rendering never import it. Prices, sources,
validation, the customer bot, Mini App and buy button retain their existing roles.

## Message layout

One country heading, then bold route, ticket type on the next line, a blank line,
and offers sorted by departure and return date. Types are `В одну сторону`,
`Обратные билеты`, `Туда обратно`. RT requires two valid ordered calendar dates;
its nights are the date difference. An incomplete RT goes to diagnostics.
Routes retain their original direction. An unknown carrier keeps its supplied
name; no arbitrary initial is invented. Approximate/unknown availability prints
no seat count. A sorted legend lists only the codes used on that page. Each page
ends with `Цены и наличие уточняются при бронировании.`

Equal dates are not sufficient for deduplication. Normalized route, type, dates,
carrier, price, seats, baggage and supplied fare conditions define an offer.
Legacy ids remain valid; newly retained variants with colliding ids get a stable
suffix. Collection no longer truncates at 300 offers. Ordered route blocks fill
the smallest number of pages possible while preserving whole routes that fit;
only an oversized route is split between offer rows, with continuation headings.
The last chunk can share a page with the next route. An individual row exceeding
the configured message limit stops the run with an explicit error, never truncates.

## Commercial regions (Asia/Almaty)

| Window | Countries |
|---|---|
| 10:00–12:00 | Vietnam, Thailand, China, Malaysia (Kuala Lumpur), Maldives, Sri Lanka, India |
| 14:00–15:00 | UAE, Oman, Egypt |
| 17:00–18:00 | Italy, Czechia, Serbia, Hungary, Germany |

Closing boundaries are exclusive. Sending/editing is rechecked before every API
call, including after saving its intent. Unlisted countries and routes between
foreign countries stay in storage but are excluded from automatic regional posts.

Change `config/telegram-publication-windows.json`, or supply the same JSON array
in `TELEGRAM_PUBLICATION_WINDOWS_JSON`; no code rewrite is necessary. Windows
must not overlap, ids and countries must be unique, and all countries/cities must
resolve in the existing geography registry. Invalid overrides stop publication.
The time zone remains Asia/Almaty. Existing Railway variables need no changes
for the defaults to apply.

## Updates, restart and recovery

One completed run per channel/local date/window. The 15-minute collector cannot
reopen it. Partial runs retry only gaps; confirmed unchanged parts are skipped.
Changed country digests edit their existing message in the next permitted window.
Startup and GitHub Actions do not publish. A file mutex covers state reads and
writes; the state schema remains v2 with existing v1 migration support. On Railway
the state path must be inside `RAILWAY_VOLUME_MOUNT_PATH` (currently `/data`).

`pending` after a crash and `unconfirmed` after timeout are held for manual review
and never expire into an automatic retry. Corrupt/unsupported state is preserved
and closes publishing. A failed edit retains the known message id for retry.
After an ungraceful kill, an orphan `.lock` may remain: stop publishers, verify its
owner is no longer running, reconcile uncertain sends against Telegram, and remove
only that orphan lock before resuming. Never clear the state file or steal a lock
solely because its TTL elapsed. Multiple containers with independent filesystems
are not supported; use one replica and the shared persistent volume.

## Verification and rollout

`npm run test:publisher` includes the exact client snapshot, country/time rules,
lossless pagination, conditions, corrupt/pending state, and actual separate Node
processes competing for the mutex and restarting against the same state file.
`npm run test:pipeline` exercises parsing through mocked delivery; it is not a live
Telegram send.

Inspect real feed data without network sends or state writes:

```sh
npm run publish:dry-run -- --print
npm run publish:dry-run -- --at=2026-10-14T05:05:00Z
npm run publish:dry-run -- --at=2026-10-14T09:05:00Z
npm run publish:dry-run -- --at=2026-10-14T12:05:00Z
```

`--at` simulates a time for planning only and is forbidden with `--send-test`.
Before production rollout, back up `/data/telegram-publications.json`, inspect
pending/unconfirmed attempts and any orphan mutex, and retain the single replica
and existing `/data` mount. Deploy the reviewed commit through the usual release
process. Existing completed windows are honored; the next regional occurrence
will apply the format. No test messages or deployment are part of the dry-run.
