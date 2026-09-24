import { chromium } from "@playwright/test";

const sources = [
  ["fun_sun", "https://b2b.fstravel.asia/tickets"],
  ["kazunion", "https://online.kazunion.com/tickets"],
  ["kompas", "https://online.kz.kompastour.com/tickets"],
  ["anex", "https://agent.anextour.kz/search/avia"],
  ["selfie", "https://b2b.selfietravel.kz/tickets"],
  ["joinup", "https://online.joinup.kz/tickets"],
  ["pegas", "https://kz.pegast.asia/FlightSearch"],
  ["crystal_bay", "https://booking-kz.crystalbay.com/tickets"],
  ["abk", "https://b2b.abktourism.kz/tickets"],
  ["space", "https://online.travelluxe.kz/tickets"],
  ["vietra", "https://b2b.vietratour.com/tickets"],
  ["sanat", "https://online.sanat.kz/TourSearchClient#/Individuals/Avia/"]
];

const browser = await chromium.launch({ headless: true });
for (const [id, url] of sources) {
  const page = await browser.newPage({ locale: "ru-RU" });
  const requests = [];
  page.on("response", response => {
    const type = response.request().resourceType();
    const u = response.url();
    if ((type === "xhr" || type === "fetch") && !/google|yandex|analytics|facebook/i.test(u)) {
      requests.push({ status: response.status(), url: u.slice(0, 500) });
    }
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(5000);
    const result = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1800),
      inputs: [...document.querySelectorAll("input")].map(el => ({ name: el.getAttribute("name"), id: el.id, type: el.getAttribute("type"), placeholder: el.getAttribute("placeholder") })).slice(0, 30),
      selects: [...document.querySelectorAll("select")].map(el => ({ name: el.getAttribute("name"), id: el.id })).slice(0, 30),
      forms: [...document.querySelectorAll("form")].map(el => ({ action: el.getAttribute("action"), method: el.getAttribute("method"), id: el.id })).slice(0, 15)
    }));
    console.log("\n===SOURCE", id, "===\n" + JSON.stringify({ ...result, network: requests.slice(0, 40) }, null, 2));
  } catch (error) {
    console.log("\n===SOURCE", id, "ERROR===\n", error instanceof Error ? error.message : String(error));
  } finally {
    await page.close();
  }
}
await browser.close();

// trigger discovery
