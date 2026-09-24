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

try {
  await page.goto("http://127.0.0.1:4178/");
  await page.getByText("Чартерные авиабилеты", { exact: true }).waitFor();

  assert.equal(await page.locator(".top-tabs button").count(), 2);
  assert.equal(await page.locator(".bottom-nav button").count(), 4);
  assert.ok(await page.getByRole("button", { name: "KZT" }).count());
  assert.ok(await page.getByRole("button", { name: "USD" }).count());
  assert.ok(await page.getByRole("button", { name: "EUR" }).count());

  const cards = page.locator(".deal-card");
  assert.ok(await cards.count() > 0, "Flight list should contain offers");

  await page.getByRole("button", { name: /Город вылета/ }).click();
  await page.locator(".picker-sheet").waitFor();
  assert.ok((await page.locator(".picker-list button").count()) > 0);
  await page.getByRole("button", { name: "Закрыть" }).click();

  await page.getByRole("button", { name: /Страна/ }).click();
  await page.locator(".picker-sheet").waitFor();
  await page.getByRole("button", { name: "Закрыть" }).click();

  await cards.first().click();
  await page.locator(".detail-sheet").waitFor();
  assert.ok(await page.getByRole("button", { name: /Написать в агентство/ }).count());
  assert.ok(await page.getByText("Опубликовано", { exact: true }).count());
  assert.ok(await page.getByText("Уйдёт из ленты", { exact: true }).count());
  assert.ok(await page.getByRole("button", { name: /Следить за направлением/ }).count());
  await page.getByRole("button", { name: /Следить за направлением/ }).click();

  await page.locator(".detail-backdrop").click({ position: { x: 4, y: 4 } });
  await page.locator(".bottom-nav").getByRole("button", { name: "Уведомления" }).click();
  assert.ok(await page.locator(".alert-row").count() >= 1);

  await page.locator(".bottom-nav").getByRole("button", { name: "Профиль" }).click();
  await page.getByText("Путешественник").waitFor();

  await mkdir(resolve("screenshots"), { recursive: true });
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".bottom-nav").getByRole("button", { name: "Рейсы" }).click();
    await page.screenshot({ path: resolve("screenshots", "charter-list-" + width + ".png") });
    const dimensions = await page.locator(".community-app").evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1, width + "px content has horizontal overflow: " + JSON.stringify(dimensions));
    assert.ok(await page.locator(".deal-card").first().isVisible());
  }

  console.log("Charter list, filters, offer lifetime, manager handoff, alerts, profile, currencies, and responsive widths: passed");
} finally {
  await browser.close();
  await server.close();
}
