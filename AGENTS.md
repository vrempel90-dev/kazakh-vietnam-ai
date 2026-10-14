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
- `scripts/telegram-digest.mjs` renders **one digest per country**, with bold
  route headings followed immediately by `В одну сторону` / `Обратные билеты`
  / `Туда обратно` and then the dated offers. Never go back to one message per
  country-and-direction. Oversized digests split into `Часть N/M` and splitting
  must stay lossless.
- `scripts/telegram-schedule.mjs` owns the only schedule: 10:00-12:00,
  14:00-15:00 and 17:00-18:00 `Asia/Almaty`. Collection may run every 15
  minutes; sending outside a window is refused, including while a run is in
  progress. Commercial country groups and hours live in
  `config/telegram-publication-windows.json`, optionally overridden by
  `TELEGRAM_PUBLICATION_WINDOWS_JSON`. Morning: VN TH CN MY (KUL) MV LK IN;
  afternoon: AE OM EG; evening: IT CZ RS HU DE. Unlisted countries remain in
  the feed. A completed window is not reopened by price updates; changes wait
  for the next occurrence of that country's window and edit the existing post.
- `scripts/charter-offer.mjs` owns trusted carrier codes and commercial offer
  identity. Different prices, baggage, seats or fare conditions must survive
  collection and rendering. Only complete, valid date pairs are published as RT.
- `scripts/telegram-publication-state.mjs` is schema v2 on the Railway `/data`
  volume. It records chat, local date, window, country, category, offer ids,
  content hash, Telegram message id, status, timestamps and errors, and it
  carries a `.lock` file mutex. v1 state migrates automatically: offer history
  is preserved, but v1 message ids are archived and never reused for edits.
- `scripts/telegram-publish-run.mjs` is the single entry point and the only
  component allowed to call Telegram during a sync.

Rules that must not be weakened:

- A changed country digest is **edited in place**; a new post is only created
  when no confirmed message exists for that digest key.
- An offer that cannot be resolved to a country and a category goes to
  diagnostics. There is no "Другие направления" bucket, and no invented
  country, carrier, seat count, baggage rule or return date.
- A sync whose `SYNC_REASON` is `startup` never publishes, so a redeploy or a
  crash-restart cannot fire an unscheduled package.
- A send whose outcome Telegram never confirmed is recorded as `unconfirmed`
  and held for review, not retried blindly. `TELEGRAM_RETRY_UNCONFIRMED=true`
  is a manual override only.
- A persisted `pending` attempt is also held after restart. Corrupt state stops
  delivery without replacing history. A stale lock alone is not proof that
  its owner died; never steal it on elapsed time during automatic publishing.
  After a hard kill, check the owner and uncertain deliveries before removing
  an orphan lock. Railway publication state must be under its mounted volume.
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
