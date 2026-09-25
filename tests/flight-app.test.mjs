import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 4178, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const screenshots = resolve(process.env.SCREENSHOT_DIR || "screenshots");
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });

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

  await page.getByRole("button", { name: "Следить за направлением" }).click();
  await page.locator(".bottom-nav").getByRole("button", { name: "Уведомления" }).click();
  assert.ok(await page.locator(".notice-offer").isVisible());
  assert.ok(await page.locator(".alert-row").count() >= 1);
  await page.screenshot({ path: resolve(screenshots, "notifications-375x812.png") });

  await page.locator(".bottom-nav").getByRole("button", { name: "Избранное" }).click();
  assert.ok(await page.locator(".bottom-nav").getByRole("button", { name: "Избранное" }).evaluate(element => element.classList.contains("active")));
  await page.locator(".bottom-nav").getByRole("button", { name: "Рейсы" }).click();
  assert.ok(await page.locator(".bottom-nav").getByRole("button", { name: "Рейсы" }).evaluate(element => element.classList.contains("active")));

  await page.goto("http://127.0.0.1:4178/?preview=1");
  assert.equal(await page.locator(".phone-stage").count(), 1, "Preview keeps the isolated device frame");
  await page.goto("http://127.0.0.1:4178/?admin=1");
  await page.getByText("Панель агентства", { exact: true }).waitFor();

  console.log("Live feed, filters, currencies, booking, WhatsApp fields, alerts, preview separation, admin, and responsive widths: passed");
} finally {
  await browser.close();
  await server.close();
}
