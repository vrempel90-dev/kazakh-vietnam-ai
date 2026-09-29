# Чартерные авиабилеты — Telegram Mini App

Система поиска и публикации дешёвых чартерных рейсов.

## Источники

Production ingestion работает **только с открытыми Telegram-каналами**.

Система не использует:
- сайты туроператоров;
- B2B-кабинеты;
- SAMO API;
- Google Sheets;
- Telegram user-session;
- `TG_API_ID`, `TG_API_HASH` или `TG_SESSION`.

Открытые каналы читаются напрямую через публичные страницы `https://t.me/s/<channel>`.

В проекте есть два базовых публичных источника:

- `charter_forever_travel`
- `charterkaz`

Дополнительные каналы задаются через `TELEGRAM_SOURCE_CHANNELS`, например:

```env
TELEGRAM_SOURCE_CHANNELS=channel_one,channel_two,@channel_three
```

## Как работает pipeline

```text
Публичные Telegram-каналы
        ↓
сбор свежих постов
        ↓
парсер маршрута / дат / цены / мест / багажа / авиакомпании
        ↓
удаление дублей
        ↓
pricing engine + наша наценка
        ↓
TTL / проверка свежести
        ↓
public/flights.json
        ↓
Mini App + наш Telegram-канал
```

Синхронизация запускается каждые 15 минут. По умолчанию используются только сообщения не старше 24 часов.

Парсер поддерживает в том числе:

- `Алматы → Анталия`
- `ALA-AYT`
- `Из Астаны в Хургаду`
- `17.09`
- `17 сентября`
- `23-28.09`
- `150 тыс`
- багаж;
- количество мест;
- OW / RT.

Источники и исходные цены не публикуются в клиентском feed.

## Локальный запуск

```bash
npm ci
npm run dev
```

Ручной запуск синхронизации:

```bash
npm run sync:flights
```

## Проверки

```bash
npm run test:sources
npm run test:pricing
npm run test:lifecycle
npm run test:telegram
npm run test:publisher
npm run typecheck
npm run lint
npm run build
```
