# Charter source integration

The synchronizer runs every 15 minutes and keeps the customer-facing `public/flights.json` feed updated.

## Security model

- Supplier COST prices must never be written to `public/flights.json`.
- Supplier credentials must only live in GitHub Actions Secrets / deployment secrets.
- The public feed contains customer sale prices only.
- A cost source is not published until its currency, FX conversion (when needed), and markup are configured.

## Connected sources

### Public Telegram sale feeds
- Forever Travel Telegram
- Charterkaz Telegram

These sources already contain customer-facing prices and are therefore imported as sale prices without an additional markup.

### NEOS Google Sheet
The provided NEOS Google Sheet is connected as a COST source. Its data is parsed automatically, but it is intentionally not published to customers until these settings are configured:

- `NEOS_SOURCE_CURRENCY`
- `MARKUP_NEOS_PERCENT` or `MARKUP_PERCENT_DEFAULT`
- `FX_<CURRENCY>_KZT` if the sheet is not already in KZT

The code does not guess the sheet currency.

### B2B operator sites
All supplied operator sites are registered and health-checked. A public-browser discovery run confirmed that several sources require agency authentication and some public search pages require JavaScript/browser automation.

The source registry contains:
- FUN&SUN
- KAZUNION
- KOMPAS
- ANEX
- SELFIE
- JOINUP
- PEGAS Touristik
- Crystal Bay
- ABK Tourism
- SPACE / Travel Luxe
- VIETRA
- SANAT

For authenticated sources, credentials must be supplied as repository/deployment secrets. No CAPTCHA or anti-bot bypass is implemented.

## Pricing

Supplier COST feeds use a rule-based Pricing Engine. No COST offer is published unless an enabled rule matches.

Supported formulas:

- add a fixed amount in KZT, e.g. `cost + 10,000 ₸`;
- add a percentage, e.g. `cost + 7%`;
- set an exact customer sale price in KZT.

Rule priority is deterministic:

1. exact offer ID;
2. route + OW/RT;
3. route;
4. supplier + OW/RT;
5. supplier;
6. OW/RT;
7. global rule.

This lets the agency keep simple defaults while overriding individual directions or flights.

The result is rounded up to `SALE_PRICE_ROUNDING` (default 1000 KZT). Supplier COST prices are never written to the public feed.

Pricing rules are stored in `PRICING_RULES_PATH`. In Railway production this path is backed by a persistent volume. The admin page is available at `/?admin=1` and requires `ADMIN_PRICING_TOKEN`.

The two sample rules, OW +10,000 KZT and RT +20,000 KZT, are shipped **disabled** because the customer's actual formula has not yet been confirmed.

## Refresh behavior

- Railway runtime source refresh: every `SYNC_INTERVAL_MINUTES` (default 15 minutes).
- Changing pricing rules triggers an immediate recalculation.
- Mini App feed refresh while open: every 60 seconds.
- GitHub Actions sync is manual-only and kept as a diagnostic fallback.
- If a source fails, the previous customer feed is kept instead of being erased.
- Duplicate customer offers are collapsed by route/date/trip/airline and the lowest sale price is kept.


## Verified integration status (2026-09-25)

A browser/network discovery pass was run against every supplied source.

- **Forever Travel Telegram / charterkaz Telegram:** live parsing works. These are treated as SALE-price feeds.
- **NEOS Google Sheet:** live table access and parsing work. 60 data rows were readable and 54 future priced rows were parseable at the time of verification. Publishing is intentionally blocked until the sheet currency and markup are configured.
- **KAZUNION:** the ticket search is publicly accessible. The page uses SAMO-Soft dynamic requests (`samo_action=PRICES`). Public fare extraction is technically possible without agency credentials, but the production route/date enumerator still needs to be implemented before this source can publish offers.
- **Crystal Bay:** public SAMO-Soft ticket search is accessible and exposes `samo_action=PRICES`; production fare extraction still needs the route/date enumerator.
- **ABK Tourism:** public SAMO-Soft ticket search is accessible and exposes `samo_action=PRICES`; production fare extraction still needs the route/date enumerator.
- **SANAT:** its public JavaScript client exposes a reachable backend at `/TourSearchOwin/`; currency and departure-city endpoints were verified. The fare-search request contract still needs to be mapped before publishing offers.
- **KOMPAS, ANEX, SELFIE, JOINUP, PEGAS Touristik, SPACE / Travel Luxe, VIETRA:** the supplied ticket flows require agency authentication before fare data can be extracted. Put credentials in repository/deployment secrets only.
- **FUN&SUN:** the supplied B2B page returned a Forbidden response from the GitHub-hosted runner during verification. No anti-bot or CAPTCHA bypass will be implemented; use an allowed partner access method or a runner/network accepted by the partner.

A source being registered or reachable does **not** mean customer fares are already being published from it. The synchronizer only publishes a source after its fare parser and pricing rules have been validated.
