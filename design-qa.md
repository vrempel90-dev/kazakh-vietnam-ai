# Telegram Mini App reference QA

final result: passed

The attached six-part reference was compared side by side with the search, notification, and booking screenshots at 375 × 812. The client UI matches its Telegram blue header, pale blue chat background, white message bubbles, compact image-led flight cards, green actions, notification card, and white form. Production omits device hardware chrome as explicitly required. Flight routes, prices, dates, and airlines come from the current feed, so the example values in the reference are not reproduced as fake offers.

## Verification

- 320, 360, 375, 390, and 430 px: no horizontal overflow; prices and action buttons stay inside cards.
- 375 × 812, 390 × 844, and 430 × 932: captured search screenshots.
- 375 × 812: captured notification, booking, and prepared application states.
- Normal URL: no `PhoneFrame`, bezel, or device picker in the DOM. `?preview=1` retains the developer frame.
- Live feed, city/country filters, KZT/USD/EUR, favorites, alerts, admin entry, and WhatsApp message fields: browser test passed.
- `npm ci`, `npm run check:runtime`, `npm run test:pricing`, `npm run test:telegram`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`: completed successfully.

## Intentional differences from the illustration

- Real flight data replaces the illustration's sample offer values and routes.
- Destinations without a relevant local photograph use a neutral destination tile.
- The four existing bottom navigation destinations remain in a compact Telegram-like bar.
- WhatsApp opens a prefilled message; the green confirmation says the application is prepared because the browser cannot confirm that the customer pressed Send in WhatsApp.
