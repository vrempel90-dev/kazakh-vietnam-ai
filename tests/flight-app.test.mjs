import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 4178, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe"
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const url = "http://127.0.0.1:4178/";
try {
  await page.goto(url);
  await page.getByRole("heading", { name: "Найдём подходящий рейс по лучшей доступной цене" }).waitFor();
  assert.equal(await page.locator(".tiles .tile").count(), 8);
  assert.equal(await page.locator(".bottom-nav button").count(), 5);
  const homeText = await page.locator(".community-app").innerText();
  assert.ok(homeText.includes("Чартерные авиабилеты"));
  for (const old of ["Казахи во Вьетнаме", "COMMUNITY MINI APP", "Ваш гид по Вьетнаму", "Жильё и аренда", "Визы и документы", "Деньги и переводы", "Транспорт"]) {
    assert.ok(!homeText.includes(old), "Old home copy remains: " + old);
  }
  await page.locator(".tile").filter({ hasText: "До 250 000 ₸" }).click();
  assert.equal(await page.locator(".flight-card").count(), 2, "Budget card must apply the filter");
  assert.ok(await page.locator(".filter-options button.active").filter({ hasText: "До 250 000 ₸" }).count());
  const departure = new Date(); departure.setDate(departure.getDate() + 8); const exactDate = [departure.getFullYear(), String(departure.getMonth() + 1).padStart(2, "0"), String(departure.getDate()).padStart(2, "0")].join("-");
  await page.locator("#exact-date").fill(exactDate);
  assert.equal(await page.locator(".flight-card").count(), 1, "Exact date must filter");
  await page.getByPlaceholder("Куда хотите полететь?").fill("Фукуок");
  assert.equal(await page.locator(".flight-card").count(), 1, "Destination search must filter");
  await page.getByRole("button", { name: "В избранное" }).click();
  await page.locator(".bottom-nav").getByRole("button", { name: "Избранное" }).click();
  assert.equal(await page.locator(".flight-card").count(), 1, "Saved flight must appear in favorites");
  await page.locator(".bottom-nav").getByRole("button", { name: "Уведомления" }).click();
  await page.getByRole("button", { name: "Сохранить параметры" }).click();
  assert.equal(await page.locator(".saved-alert").count(), 1);
  await page.reload();
  await page.getByRole("heading", { name: "Найдём подходящий рейс по лучшей доступной цене" }).waitFor();
  await page.locator(".bottom-nav").getByRole("button", { name: "Уведомления" }).click();
  assert.equal(await page.locator(".saved-alert").count(), 1, "Alert should persist after reload");
  await page.locator(".bottom-nav").getByRole("button", { name: "Профиль" }).click();
  await page.getByRole("button", { name: "Тёмная тема" }).click();
  assert.ok(await page.locator(".community-app.dark").count(), "Dark theme should activate");
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await page.locator(".bottom-nav").getByRole("button", { name: "Главная" }).click();
  await mkdir(resolve("screenshots"), { recursive: true });
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: resolve("screenshots", "home-" + width + ".png") });
    const dimensions = await page.locator(".community-app").evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1, width + "px content has horizontal overflow: " + JSON.stringify(dimensions));
    assert.ok(await page.getByRole("heading", { name: "Найдём подходящий рейс по лучшей доступной цене" }).isVisible());
    console.log(width + "px: responsive home visible, no horizontal overflow");
  }
  console.log("Flight home, filters, favorites, alerts, theme, and responsive widths: passed");
} finally {
  await browser.close();
  await server.close();
}
