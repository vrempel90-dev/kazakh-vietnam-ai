# Mobile Prototype Agent Guide

## Production Mini App direction (2026-09-25)

The user explicitly requested a full-screen Telegram Mini App without the template's phone frame, device picker, fake status bar, or home indicator. On the normal URL, `App.tsx` mounts `Prototype` directly. The `MobileRuntime` and its protected device assets remain available only at `?preview=1`. The runtime guidance below applies to that developer preview; do not reintroduce it into production. Keep pricing admin, parsers, Railway, Telegram webhook, and server behavior outside client redesign work.

## Prototype Instructions

In ChatGPT Work Mode, run `sites-preview start "$PWD"`, open `http://terminal.local:4173/` in the cloud browser, and verify the rendered app and its primary interactions. Keep that preview open and tell the user to inspect it in the cloud browser; do not present the local URL as a user-facing chat link. In Codex Desktop, run the local server yourself, open the preview in the in-app browser, and provide the clickable local URL. Do not deploy to Sites unless the user explicitly asks to share, publish, or deploy. Do not give the user server-start instructions when you can run it.

Before planning or implementing any mobile-app change, read this `AGENTS.md` in full. It is the source of truth for the template's runtime and component guidance.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Editing Boundary

- Build app-specific UI in `src/Prototype.tsx` and `src/prototype.css`.
- Treat `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/mobile/`, `public/assets/iphone/`, `public/assets/android/`, `public/assets/status/`, `vite.config.ts`, `worker/index.js`, and `scripts/prepare-sites-build.mjs` as protected runtime files. Do not edit, replace, remove, or recreate them unless the user explicitly asks to change the mobile runtime itself. For an explicit runtime change, update the affected lock hashes only after verifying the new runtime behavior.
- Run `npm run check:runtime` before preview or handoff. If it fails, restore the protected runtime instead of weakening or bypassing the check.
- `npm run build` preserves the mobile runtime and prepares the static Cloudflare Worker output required by Sites. Before a Sites handoff, confirm `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json`, and source `.openai/hosting.json` exist, then run `npm run test:sites`. Do not replace this project with a Vinext starter.

## Runtime Contract

- Preserve the mobile device runtime unless the user's task explicitly asks otherwise. Do not replace it with a standalone page. Visual fidelity applies to app-owned content inside the device screen, not to template-owned device chrome.
- Keep `App` composed around `PhoneFrame` -> `KeyboardProvider`, with `StatusBar`, app content, `HomeIndicator`, and `KeyboardDock` mounted inside the phone frame. `StatusBar` and the iOS home indicator are overlaid device chrome. When the Android keyboard is closed, the app viewport reserves the protected navigation-bar region instead of painting behind it. When the Android keyboard is open, preserve the current full-screen keyboard layout: its asset includes the IME navigation strip and the separate black navigation bar is hidden. iOS screens continue to paint behind the home-indicator area and own their safe-area content padding.
- Preserve the `iPhone` / `Pixel 10` device picker and both calibrated device presets. The Pixel screen is `427 x 952`; its `32 x 32` camera circle and `public/assets/android/navigation-bar.svg` bottom navigation bar are protected device chrome, not app content.
- Preserve the device picker's intentionally lightweight Codex styling in the top-right corner: its trigger wrapper is borderless and transparent, its trigger sizes to content, and its right-aligned menu uses the compact 3px inset plus the specified hairline and elevation shadow layers. Keep the prototype root and default app screen white.
- Preserve `StatusBar` as live device chrome, including its platform-specific typography, source status-icon assets, and spacing. Pixel 10 uses Roboto, Android indicators, and 32px top, left, and right padding. iPhone uses its iOS indicators, system typography, and calibrated spacing. Do not hardcode screenshot times like `9:41` into the status bar, replace its real-time clock, or move status bar content into app markup unless the user explicitly asks for a fixed/mock device time.
- `PhoneFrame` owns the calibrated device frame, screen portal, device picker, camera cutout, and custom cursor. Keep device assets in `public/assets/iphone/` and `public/assets/android/`; if an asset fails to load, repair the asset path or restore the asset instead of removing the frame, keyboard, or image render.
- Use `MobileScroll` directly for simple single-screen prototypes. Use `FlowStack` for conventional multi-screen flows whose routes can own their fixed header and footer; when using it, define each route as a `FlowScreen`: `{ id, header?, headerHeight?, footer?, footerHeight?, render }`, and use `flow.push(screen)`, `flow.pop()`, and `flow.replace(screen)` from `FlowStack` render callbacks or `useFlow()` instead of introducing another router.
- Use `Carousel` for a carousel, horizontal rail, swipeable cards, image or media strip, horizontally scrollable cards, chip rail, or other horizontal collection.
- For a layered app shell—such as a persistent composer, independently presented sheet, pushed/peek sidebar, or app-wide transition—compose directly in `Prototype.tsx` rather than forcing it through `FlowStack`. Keep app-owned fixed chrome as sibling layers outside `MobileScroll`.
- When using `FlowScreen`, put route-owned fixed headers or footers in `FlowScreen.header` or `FlowScreen.footer`. Set `headerHeight` to the visible app-toolbar height; `FlowStack` adds the device's top safe-area/status-bar inset automatically. Do not include `StatusBar` or its height in the header. Set `footerHeight` to the full app-footer height. `FlowScreen.footer` is an overlay, not reserved layout space; screens using it must add their own bottom content padding such as `padding-bottom: calc(var(--flow-footer-height) + var(--mobile-safe-area-height) + 24px)` so final content can scroll above the footer while still painting behind it.
- Render only scrollable content inside `MobileScroll`; it is for content that should move with scroll and rubber-band overscroll. Keep app-owned headers, nav bars, tabs, composers, and overlays outside it. This keeps scroll physics, safe areas, keyboard insets, scrollbars, and drag click suppression active without letting content paint under fixed chrome.
- Buttons, links, cards, and images inside `MobileScroll` should still allow drag scrolling when the pointer moves beyond tap slop. Use `data-scroll-drag="ignore"` only for rare controls that must own the drag gesture themselves.
- Do not add `var(--keyboard-height)` to ordinary screen/content padding inside `MobileScroll`; the scroll viewport already shrinks above the simulated keyboard. For custom fixed composers, search bars, or toast chrome, use `useKeyboardInsets().bottomInset`. It is relative to the app viewport: Android returns `0` while the closed-keyboard viewport already reserves navigation, then returns the keyboard height while open; iOS continues to clear the home indicator while closed and ride directly above the keyboard while open. Do not pin custom bottom chrome to `bottom: 0` or only `keyboardHeight`.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for every text-entry control. A raw `input` or `textarea` disconnects focus, keyboard animation, safe-area insets, and attached surfaces.
- Use `BottomSheet` for phone-scoped sheets. Its props are `open`, `onOpenChange`, `title`, optional `description`, optional `snap`, and `children`; it renders through the phone screen portal and dismisses the keyboard before opening.

## Horizontal Carousels

- Use `Carousel` for horizontally draggable cards, images, media, chips, or other horizontal collections. Do not recreate these with `overflow-x`, custom pointer handlers, or a generic div.
- `Carousel` can be nested directly inside `MobileScroll`. It owns horizontal gestures and automatically yields vertical gestures to the parent.
- Never put `data-scroll-drag="ignore"` on or around a `Carousel`; doing so prevents vertical parent scrolling when a gesture begins inside it.
- Do not add CSS scroll snapping to `Carousel`; its runtime owns momentum and release motion.
- Use `data-scroll-drag="ignore"` only when a control must prevent parent scrolling in every drag direction.

See `src/mobile/COMPONENTS.md` for the full component and gesture contract.

## Keyboard Rule

The simulated keyboard is a separate top-layer component. Before presenting anything that behaves like iOS navigation or modal UI, dismiss it first.

Call `keyboard.hide()` before:

- pushing, popping, or replacing FlowStack routes
- opening bottom sheets, action sheets, dialogs, menus, or navigation sheets
- starting transitions where the destination should not inherit text-input focus

`FlowStack` already hides the keyboard for `push`, `pop`, and `replace`. `BottomSheet` already hides it before opening. If you add new modal/sheet/navigation primitives, follow the same rule.

When a composer, search surface, or other keyboard-attached component closes, call `keyboard.hide()` in the same event before changing that component's open state. Position attached surfaces from `useKeyboardInsets()` rather than a separate timer or visibility flag so both dismiss together.

When any text-entry control loses focus, dismiss the simulated keyboard. If the control is custom or does not use the runtime's keyboard-aware fields, handle its blur event and call `keyboard.hide()` explicitly. Keep the keyboard open only when focus is moving directly to another text-entry control that should share the same keyboard session.

## Interaction Rules

- Do not trigger buttons or inputs after a pointer has become a drag. Preserve the drag suppression behavior in `MobileScroll`.
- Do not allow native browser image/file dragging inside the phone frame. Preserve the phone-level `dragstart` suppression and non-draggable image styles so scroll drags that begin on images still scroll the prototype.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for text entry so the simulated keyboard and safe-area insets stay connected.
- Fixed phone chrome should not animate with pushed screens. Screen content can animate; the status bar, camera cutout, and preview chrome should stay put.
- Keep the keyboard below the home indicator/safe area layer in z-index, and above ordinary app UI while visible.
- Keep the home indicator as the topmost safe-area layer in the z-index above everything else in the prototype.

## Project-specific direction

The user renamed this prototype to «Чартерные авиабилеты». Preserve the blue header, white rounded cards, minimal mobile-first typography, iPhone/Pixel runtime, and light/dark themes. Home and primary navigation focus on charter-flight search. Display sample prices and availability only as clearly labeled demonstration data until a live supplier is connected.

## Telegram charter publisher (2026-10-12)

The publication pipeline was rebuilt around five single-purpose modules. Keep
these boundaries: the duplicate posts, the split countries and the lost offers
all came from each stage keeping its own city table, its own notion of
"direction" and its own grouping key.

- `scripts/charter-geo.mjs` is the only place that maps a city spelling to a
  country and a ticket category. Add new cities and aliases (Russian forms,
  Latin transliterations, IATA codes, airport names) here and nowhere else.
- `scripts/telegram-digest.mjs` renders **one digest per country**, with
  `БИЛЕТЫ ТУДА` / `ОБРАТНЫЕ БИЛЕТЫ` / `ТУДА И ОБРАТНО` / `МЕЖДУ СТРАНАМИ` as
  sections inside that single message. Never go back to one message per
  country-and-direction. Oversized digests split into `Часть N/M` and splitting
  must stay lossless.
- `scripts/telegram-schedule.mjs` owns the only schedule: 10:00-12:00,
  14:00-15:00 and 17:00-18:00 `Asia/Almaty`. Collection may run every 15
  minutes; sending outside a window is refused. It also owns the only
  country-to-window mapping: `REGIONS` gives 10:00-12:00 to Asia (VN, TH, CN,
  MY, MV, LK, IN), 14:00-15:00 to the Middle East (AE, OM, EG) and 17:00-18:00
  to Europe (IT, CZ, RS, HU, DE). To move a country, move its code in that
  table - never add a time check anywhere else.
  `REGIONS` gives a country its own window. A country no region claims still
  publishes, in the single `DEFAULT_REGION_ID` window - exactly one, never
  all three. A country outside the current window is reported as
  `out_of_region_window`, never as a loss, and an empty region sends no message
  and leaves its window open for a later sync.
- `scripts/charter-publication-policy.mjs` is the only gate that decides
  whether one offer may be published. The rule: exactly one endpoint in
  Kazakhstan, and the other endpoint's country on the allowed list. Both
  directions pass. The customer feed, the digest renderer and the publication
  orchestrator all ask it, so no stage can admit something another stage would
  refuse. It is also where `localDayOffset` freshness and route admissibility
  stay in one order: policy first, then validation.
- `scripts/telegram-publication-state.mjs` is schema v2 on the Railway `/data`
  volume. It records chat, local date, window, country, category, offer ids,
  content hash, Telegram message id, status, timestamps and errors, and it
  carries a `.lock` file mutex. v1 state migrates automatically: offer history
  is preserved, but v1 message ids are archived and never reused for edits.
- `scripts/telegram-publish-run.mjs` is the single entry point and the only
  component allowed to call Telegram during a sync.

- `scripts/telegram-source-adapter.mjs` parses channel text. A route part may
  not contain a digit, a currency or a fare class: channel posts put fare rows
  ("V 14.10 - Business от 194 000 (1 место)") right next to route headings, and
  those rows used to parse as routes and travel into the customer feed. A route
  separator is a dash with whitespace on at least one side, so
  "Shymkent - Seoul- Shymkent" splits into three cities while
  "Усть-Каменогорск" stays one.

Monitoring (added 2026-10-15, after three silent days read as `status: ok`):

- An edit is never a publication. `PUBLICATION_STATUS` in
  `telegram-publish-run.mjs` reports `PUBLISH_SENT`, `PUBLISH_EDITED`,
  `PUBLISH_PLANNED` (dry run only), `NO_NEW_OFFERS`, `PUBLISH_BLOCKED` or
  `PUBLISH_FAILED`, and the sync's source status carries that value, not "ok".
- `telegram-publication-state.mjs` keeps `meta.monitor` and per-channel
  `telemetry` with `lastSyncAt`, `lastPublishAttemptAt`, `lastPlannedSendAt`,
  `lastNewPostAt`, `lastEditAt`, `lastSuccessfulDeliveryAt`, `lastFailureAt`
  and the window's totals. `/health` serves them and answers 503 while the
  publisher is stale.
- `publicationHealth` compares `lastNewPostAt` against `lastPlannedSendAt`:
  only a post the publisher actually decided to create counts as due, so a
  quiet source or a closed schedule can never raise a false alert.
  `TELEGRAM_NO_POST_ALERT_HOURS` (default 26) is the silence budget.

Rules that must not be weakened:

- **Exactly one endpoint in Kazakhstan, and the other country not on the
  block list.** A flight between two foreign countries (Sharjah -> Tashkent) is
  never published, whichever countries they are; there is no "МЕЖДУ СТРАНАМИ"
  section and `TICKET_CATEGORIES.FOREIGN` is not a publishable category. An
  unresolved country is a refusal, never a publication.
- **The country rule is a BLOCK list, not an allow list** (client decision,
  2026-10-22: every country except Uzbekistan). `BLOCKED_COUNTRY_CODES` in
  `telegram-schedule.mjs` is the only place a country is refused by name.
  Uzbekistan in practice only ever appeared as Sharjah -> Tashkent, which the
  no-Kazakhstan-endpoint rule already refuses; the block list is the belt to
  that braces.
- **A country publishes in exactly ONE window, never several.**
  `TELEGRAM_UNASSIGNED_COUNTRY_POLICY` and its `all-windows` default are gone
  on purpose - that default published a region-less country three times a day,
  which is how Uzbekistan and Saudi Arabia filled the channel - and no
  environment variable may bring it back. A country with no region of its own
  falls back to `DEFAULT_REGION_ID`, one window.
- **Turkiye is in `REGIONS` explicitly** rather than left to the fallback: it
  carries more inventory than any other single country (572 of 1326 offers on
  22.10.2026), so its window is a deliberate choice, not a default.
- **Freshness is counted in `Asia/Almaty`, and a departure today is valid.**
  `localDayOffset` in `telegram-schedule.mjs` is the only day arithmetic in the
  pipeline. The `offset <= 0` guards it replaced measured against the UTC
  calendar day and silently deleted every same-day charter seat, which is the
  most urgent inventory there is. Reject only `offset < 0` and beyond
  `MAX_DEPARTURE_HORIZON_DAYS`, and report which.
- **Never cap the number of offers.** `dedupeFlights` had a `.slice(0, 300)`
  that cut the far end of the season, sorted by departure date, reporting
  nothing. Message size is handled by splitting a country digest into
  "Часть N/M", which never drops an offer.
- **Entity decoding is not optional.** t.me serves "Астана -> Фукуок" as
  "Астана -&gt; Фукуок". `&gt;`/`&lt;` were missing from `decodeHtml`, the
  route split at the dash and the destination became the literal string
  "&gt; Фукуок" - about a third of the feed, Astana -> Phu Quoc worst of all.
  Entities are decoded in `decodeHtml`, again in `parseRouteLine` and
  `normalizeCity`, and once more in `charter-geo.cityKey`. That redundancy is
  deliberate.
- **A route line must have at least one resolvable city.** A country heading
  written with spaced hyphens ("Шри - Ланка") otherwise parses as a route,
  becomes the active route and captures the fare rows belonging to the real
  route beneath it.
- **A same-day A->B / B->A pair with one Kazakhstan endpoint is not
  suspicious.** One aircraft flies both legs and one channel carries both, so
  the mirrored-route quarantine in `flight-validator.mjs` used to hold back
  BOTH directions of an entire charter programme. It is scoped to routes that
  are not a clean Kazakhstan-to-foreign pair.
- **A completed window is re-entered, not refused.** Collection runs every 15
  minutes but a window is 1-2 hours and each country now belongs to exactly
  one window; refusing the window after its first run held everything the later
  syncs collected until the next day, which for a departure today is never.
  Duplicate protection stays with `planMessageAction`, per digest key, content
  hash and publication date - not with the window record.
- **A live message is NEVER rewritten.** An earlier build replaced the body of
  any same-day post whose country had left the list with a withdrawal notice.
  On 22.10.2026 the deploy landed at 11:43 Almaty, inside the morning window,
  and the next sync rewrote the Turkiye and South Korea digests published at
  10:06 that morning into a notice carrying a "Купить билет" button and no
  tickets. A post already in the channel belongs to the people reading it:
  the publisher stops producing forbidden ones and reports what is standing
  (`forbiddenLiveMessages`). Removing a published message is a human decision.
- **Outside a window the run continues in EDIT-ONLY mode.** A price that moves
  at 15:00 for a country whose window was 10:00-12:00 must still reach the
  channel the same day; editing an existing post adds no message and cannot
  reach a country that has not been posted today. Creating a NEW post stays
  restricted to the window, enforced both in the per-message plan
  (`out_of_window_no_new_post`) and by leaving the window record untouched.
- **Discovery finds channels; it must not be the only thing that reads them.**
  A discovered source arrives with `prefetchedOffers` covering only the last
  `TELEGRAM_DISCOVERY_RECENT_MESSAGES` messages, so taking those as the whole
  channel left most of a busy day invisible (`pages: 0` in every production
  log; 702 offers where the paginated feed yields ~1200). Both reads run and
  merge on `externalId`.

- A changed country digest is **edited in place within its publication day**;
  a new post is created when no confirmed message exists for that digest key
  **on the current local date**. Editing is bounded to one day on purpose: the
  digest key is only country+part, so an unbounded edit rule turns a country's
  first post into its permanent message and the channel stops receiving
  anything new (this is exactly what happened between 13 and 15 October 2026).
- An offer that cannot be resolved to a country and a category goes to
  diagnostics. There is no "Другие направления" bucket, and no invented
  country, carrier, seat count, baggage rule or return date.
- A sync whose `SYNC_REASON` is `startup` never publishes, so a redeploy or a
  crash-restart cannot fire an unscheduled package.
- A send whose outcome Telegram never confirmed is recorded as `unconfirmed`
  and held for review, not retried blindly. The same applies to a `pending`
  send left behind by a run that died between the Telegram call and its state
  write: it is held, because Telegram may already have accepted that post. An
  interrupted *edit* is repeated instead, since editing the same message twice
  changes nothing. `TELEGRAM_RETRY_UNCONFIRMED=true` is a manual override only.
- Publishing is refused when `GITHUB_ACTIONS` is set. GitHub Actions only
  refreshes `public/flights.json`; Railway owns delivery.
- Never cap delivery by dropping messages. The per-window ceiling defers and
  reports; it must not truncate a digest.

Layout choices worth keeping: the legend is sorted by carrier letter so the
rendered text (and therefore its content hash) is stable; carrier names come
from a canonical table because channel text arrives as "Scat" or "PEGASUS";
a departure outside the current year prints a two-digit year (`14.09.27`) so it
cannot be read as a past date.

Use `npm run publish:dry-run` to inspect the plan against real data without
touching Telegram, and `npm run publish:test-chat` to deliver to
`TELEGRAM_TEST_CHAT_ID` only.
