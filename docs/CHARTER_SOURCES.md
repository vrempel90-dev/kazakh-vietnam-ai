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

Cost-based sources use:

`sale = cost × FX_to_KZT × (1 + markup_percent / 100)`

The result is rounded up to `SALE_PRICE_ROUNDING` (default 1000 KZT).

Example only:
if a confirmed supplier cost is 100,000 KZT and markup is 7%, the customer price is 107,000 KZT.

## Refresh behavior

- GitHub Actions source refresh: every 15 minutes.
- Mini App feed refresh while open: every 60 seconds.
- If a source fails, the previous customer feed is kept instead of being erased.
- Duplicate customer offers are collapsed by route/date/trip/airline and the lowest sale price is kept.
