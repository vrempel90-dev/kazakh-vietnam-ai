import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 4178, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined),
});
const screenshots = resolve(process.env.SCREENSHOT_DIR || "screenshots");
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const testNow = new Date();
const testDate = offset => {
  const date = new Date(testNow);
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const originalFeed = {
  generatedAt: testNow.toISOString(),
  mode: "telegram-public-only",
  rates: { USD_KZT: 500, EUR_KZT: 600 },
  flights: [
    { id: "ala-cxr", from: "Алматы", to: "Нячанг", offset: 3, price: 185000, trip: "RT", returnDate: testDate(10), airline: "SCAT" },
    { id: "nqz-dxb", from: "Астана", to: "Дубай", offset: 4, price: 110000, trip: "OW", airline: "flydubai" },
    { id: "cxr-ala", from: "Нячанг", to: "Алматы", offset: 5, price: 150000, trip: "OW", airline: "SCAT" },
    { id: "hkt-ala", from: "Пхукет", to: "Алматы", offset: 6, price: 120000, trip: "OW", airline: "Air Astana" }
  ].map(flight => ({ ...flight, departureDate: testDate(flight.offset), hot: false, seats: "Наличие уточняется", publishedAt: testNow.toISOString(), expiresAt: new Date(testNow.getTime() + 86400000).toISOString() }))
};
let flightPayload = originalFeed;
let pricingReadCount = 0;
let pricingSaved = null;
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
await page.route("**/flights.json*", route => route.fulfill({ json: flightPayload }));
await page.route("**/api/admin/pricing", route => {
  if (route.request().method() === "GET") pricingReadCount += 1;
  if (route.request().headers().authorization !== "Bearer test-admin") return route.fulfill({ status: 401, json: { error: "unauthorized" } });
  if (route.request().method() === "PUT") {
    pricingSaved = JSON.parse(route.request().postData()).config;
    return route.fulfill({ json: { config: pricingSaved, syncStarted: false } });
  }
  return route.fulfill({ json: { config: { version: 1, updatedAt: null, rules: [{ id: "legacy", name: "Existing source rule", enabled: true, priority: 0, scope: { sourceId: "legacy-source" }, calculation: { type: "fixed_kzt", value: 10000 } }] }, sync: { running: false } } });
});
await page.route("**/api/admin/sources", route => route.fulfill({ json: { configuredSources: [
  { id: "telegram:custom_charters", kind: "telegram_public", label: "Custom charters" },
  { id: "telegram:charter_forever_travel", kind: "telegram_public", label: "charter_forever_travel" }
], sources: [] } }));
await page.addInitScript(() => {
  const original = window.setInterval.bind(window);
  window.__testMinuteTimers = [];
  window.setInterval = (handler, delay, ...args) => {
    if (delay === 60000 && typeof handler === "function") window.__testMinuteTimers.push(handler);
    return original(handler, delay, ...args);
  };
});
const refreshFeed = () => page.evaluate(() => window.__testMinuteTimers.forEach(callback => callback()));

try {
  await mkdir(screenshots, { recursive: true });
  await page.goto("http://127.0.0.1:4178/");
  await page.getByText("Чартерные авиабилеты", { exact: true }).waitFor();
  await page.getByText("Рейсы обновляются автоматически").waitFor();

  assert.equal(await page.locator(".phone-stage,.phone-bezel,.device-picker-trigger").count(), 0, "Production must not mount device chrome");
  assert.equal(await page.locator(".bottom-nav button").count(), 4);
  for (const currency of ["KZT", "USD", "EUR"]) assert.ok(await page.getByRole("button", { name: currency }).isEnabled());
  assert.ok(await page.locator(".deal-card").count() > 0, "Live feed must render offers");

  await page.getByRole("button", { name: "Город" }).click();
  await page.locator(".picker-sheet").waitFor();
  assert.ok(await page.locator(".picker-list button").count() > 0);
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.getByRole("button", { name: "Страна" }).click();
  await page.locator(".picker-sheet").waitFor();
  await page.getByRole("button", { name: "Закрыть" }).click();

  for (const [width, height] of [[320, 700], [360, 780], [375, 812], [390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height });
    if (width >= 375) await page.screenshot({ path: resolve(screenshots, `search-${width}x${height}.png`) });
    const layout = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      card: document.querySelector(".deal-card")?.getBoundingClientRect().toJSON(),
      price: document.querySelector(".deal-card .price")?.getBoundingClientRect().toJSON(),
      action: document.querySelector(".deal-card .select-flight")?.getBoundingClientRect().toJSON(),
    }));
    assert.ok(layout.page <= layout.viewport + 1, `${width}px page overflows horizontally`);
    assert.ok(layout.card && layout.price && layout.action);
    assert.ok(layout.price.right <= layout.card.right && layout.action.right <= layout.card.right, `${width}px price or button clipped`);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  const vietnamCard = page.locator(".deal-card").filter({ has: page.locator("img.deal-photo") }).first();
  await (await vietnamCard.count() ? vietnamCard : page.locator(".deal-card").first()).getByRole("button", { name: "Выбрать" }).click();
  await page.getByRole("button", { name: "Отправить заявку" }).waitFor();
  assert.ok(await page.getByText("Опубликовано", { exact: false }).count());
  assert.ok(await page.getByRole("button", { name: "Следить за направлением" }).count());
  await page.screenshot({ path: resolve(screenshots, "booking-375x812.png") });

  await page.getByLabel("Количество пассажиров").selectOption("3");
  await page.getByLabel("Взрослые").selectOption("2");
  await page.getByLabel("Ваше имя").fill("Виктор");
  await page.getByLabel(/Номер телефона/).fill("+7 777 123 45 67");
  await page.evaluate(() => {
    window.__openedUrl = "";
    window.open = url => { window.__openedUrl = String(url || ""); return null; };
  });
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  await page.getByText("Заявка подготовлена!", { exact: false }).waitFor();
  const openedUrl = await page.evaluate(() => window.__openedUrl || "");
  assert.ok(openedUrl.startsWith("https://wa.me/77007772414?text="), "Existing manager WhatsApp number must be used");
  const message = new URL(openedUrl).searchParams.get("text") || "";
  for (const field of ["Направление:", "Дата:", "Ночей:", "Авиакомпания:", "Цена:", "Пассажиры: 3", "Взрослые: 2", "Дети: 1", "Имя: Виктор", "Телефон: +7 777 123 45 67"]) {
    assert.ok(message.includes(field), `WhatsApp message is missing ${field}`);
  }
  await page.screenshot({ path: resolve(screenshots, "booking-success-375x812.png") });

  flightPayload = { ...originalFeed, flights: originalFeed.flights.map(flight => flight.id === "ala-cxr" ? { ...flight, price: 250000 } : flight) };
  await refreshFeed();
  await page.locator(".booking-flight b").filter({ hasText: "250" }).waitFor();
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  const repricedMessage = new URL(await page.evaluate(() => window.__openedUrl)).searchParams.get("text");
  assert.ok(repricedMessage.replace(/\s/g, "").includes("Цена:250000"), "Selected booking and handoff follow the latest feed price");

  await page.getByRole("button", { name: "Следить за направлением" }).click();
  await page.locator(".bottom-nav").getByRole("button", { name: "Уведомления" }).click();
  assert.ok(await page.locator(".notice-offer").isVisible());
  assert.ok(await page.locator(".alert-row").count() >= 1);
  await page.screenshot({ path: resolve(screenshots, "notifications-375x812.png") });

  await page.locator(".bottom-nav").getByRole("button", { name: "Избранное" }).click();
  assert.ok(await page.locator(".bottom-nav").getByRole("button", { name: "Избранное" }).evaluate(element => element.classList.contains("active")));
  await page.locator(".bottom-nav").getByRole("button", { name: "Рейсы" }).click();
  assert.ok(await page.locator(".bottom-nav").getByRole("button", { name: "Рейсы" }).evaluate(element => element.classList.contains("active")));

  flightPayload = originalFeed;
  await refreshFeed();
  await page.getByRole("button", { name: "Страна" }).click();
  await page.locator(".picker-list").getByRole("button", { name: "Вьетнам" }).click();
  assert.equal(await page.locator(".deal-card").count(), 2, "Country filter includes both outward and return directions");
  assert.ok(await page.locator(".deal-card").filter({ hasText: "Нячанг → Алматы" }).count());
  await page.locator(".deal-card").first().getByRole("button", { name: "Выбрать" }).click();
  flightPayload = { ...originalFeed, flights: originalFeed.flights.filter(flight => flight.id !== "ala-cxr") };
  await refreshFeed();
  await page.getByText("Предложение уже ушло из ленты", { exact: true }).waitFor();
  assert.equal(await page.locator(".booking-form").count(), 0, "Removed offers cannot remain bookable");

  const valid = originalFeed.flights[0];
  flightPayload = { ...originalFeed, mode: "telegram-public-cached", rates: { USD_KZT: -500, EUR_KZT: 0 }, flights: [
    valid,
    { ...valid, id: "expired", expiresAt: new Date(testNow.getTime() - 1).toISOString() },
    { ...valid, id: "bad-expiry", expiresAt: "invalid" },
    { ...valid, id: "past", departureDate: testDate(-1) },
    { ...valid, id: "today", departureDate: testDate(0) },
    { ...valid, id: "bad-date", departureDate: "2026-02-30" },
    { ...valid, id: "free", price: 0 },
    { ...valid, id: "negative", price: -1000 },
    { ...valid, id: "bad-trip", trip: "INVALID" },
    { ...valid, id: "bad-route", from: { unsafe: true } }
  ] };
  await page.evaluate(() => {
    localStorage.setItem("charter-favorites", "{}");
    localStorage.setItem("charter-route-alerts", '"invalid-list"');
  });
  await page.goto("http://127.0.0.1:4178/");
  await page.getByText("Последние доступные данные по рейсам", { exact: true }).waitFor();
  assert.equal(await page.locator(".deal-card").count(), 1, "Client removes malformed, expired, nonpositive, and departed offers");
  assert.ok(await page.getByRole("button", { name: "USD", exact: true }).isDisabled(), "Invalid negative FX must disable conversion");
  assert.ok(await page.getByRole("button", { name: "EUR", exact: true }).isDisabled());
  assert.deepEqual(pageErrors, [], "Corrupt stored favorites/alerts must not crash the app");

  flightPayload = originalFeed;
  await page.goto("http://127.0.0.1:4178/?preview=1");
  assert.equal(await page.locator(".phone-stage").count(), 1, "Preview keeps the isolated device frame");
  await page.goto("http://127.0.0.1:4178/?admin=1");
  await page.getByText("Панель агентства", { exact: true }).waitFor();

  await page.getByLabel("Код администратора").fill("bad-token");
  assert.equal(pricingReadCount, 0, "Typing credentials does not issue automatic repeated login requests");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByText("Нет доступа к админ-панели", { exact: true }).waitFor();
  assert.equal(pricingReadCount, 1, "Failed login stays available for a manual retry without an auth loop");
  await page.getByLabel("Код администратора").fill("test-admin");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByText("Чартеры Pro", { exact: true }).waitFor();
  await page.locator(".pricing-rule").first().getByLabel("Поставщик").locator("option[value='telegram:custom_charters']").waitFor({ state: "attached" });
  assert.equal(await page.locator(".pricing-rule").first().getByLabel("Поставщик").inputValue(), "legacy-source", "Existing custom/legacy scopes remain editable");
  await page.getByRole("button", { name: "+ Добавить правило", exact: true }).click();
  const newRule = page.locator(".pricing-rule").last();
  await newRule.getByLabel("Уровень").selectOption("source");
  assert.equal(await newRule.getByLabel("Поставщик").inputValue(), "telegram:custom_charters", "New source scopes default to actual configured ingestion IDs");
  await page.getByRole("button", { name: "Сохранить и пересчитать", exact: true }).click();
  await page.getByText("Наценки сохранены. Пересчёт рейсов запущен.", { exact: true }).waitFor();
  assert.equal(pricingSaved.rules.at(-1).scope.sourceId, "telegram:custom_charters");
  assert.deepEqual(pageErrors, []);

  console.log("Deterministic feed, inbound country filter, stale booking updates/removal, expiry/date/numeric guards, cache label, stored lists, auth loop, live source pricing, WhatsApp, alerts, preview, and responsive widths: passed");
} finally {
  await browser.close();
  await server.close();
}
