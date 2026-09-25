# Telegram Bot + Mini App setup

The production app is designed to run as a Telegram Mini App and as a normal web app.

## Production URL

`https://charter-app-production-6bf5.up.railway.app`

## BotFather

Create the bot in the official `@BotFather` chat:

1. `/newbot`
2. Bot display name: **Чартерные авиабилеты**
3. Choose an available username ending in `bot`, for example `charter_flights_kz_bot`.
4. Copy the bot token and store it only as the Railway secret `TELEGRAM_BOT_TOKEN`.

The application configures the remaining bot settings automatically after deployment:

- commands: `/start`, `/flights`, `/menu`, `/help`;
- bot description and short description;
- the Telegram chat menu button **Авиабилеты**;
- the menu button opens the production Mini App;
- secure webhook at `/api/telegram/webhook`;
- webhook secret validation;
- `/start` reply with **Открыть авиабилеты** and **Написать менеджеру** buttons.

## Railway variables

Required:

- `TELEGRAM_BOT_TOKEN` — token from BotFather;
- `TELEGRAM_WEBHOOK_SECRET` — random server-side secret;
- `PUBLIC_APP_URL=https://charter-app-production-6bf5.up.railway.app`;
- `VITE_MANAGER_WHATSAPP=77007772414`.

Do not commit the real bot token to GitHub.

## Telegram Mini App client

The page loads Telegram's official Web App SDK. When opened inside Telegram it calls `ready()`, expands to available height, and applies the app header/background colors.

## Runtime behavior

On service startup, if Telegram variables are configured, the server calls Telegram Bot API to:

1. verify the token with `getMe`;
2. register commands;
3. set bot descriptions;
4. set the chat menu Web App button;
5. register the secure webhook.

The health endpoint shows only Telegram status/username and never exposes the token or webhook secret.
