import { chromium } from "@playwright/test";

const sources = [
  ["kazunion", "https://online.kazunion.com/tickets"],
  ["crystal_bay", "https://booking-kz.crystalbay.com/tickets"],
  ["abk", "https://b2b.abktourism.kz/tickets"],
  ["sanat", "https://online.sanat.kz/TourSearchClient#/Individuals/Avia/"]
];

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 2);
const back = new Date(tomorrow);
back.setDate(back.getDate() + 7);
const fmt = d => [String(d.getDate()).padStart(2,"0"),String(d.getMonth()+1).padStart(2,"0"),d.getFullYear()].join(".");

const browser = await chromium.launch({ headless: true });
for (const [id,url] of sources) {
  const page = await browser.newPage({ locale:"ru-RU" });
  const network=[];
  page.on("response", res => {
    const type=res.request().resourceType();
    if ((type==="xhr"||type==="fetch"||type==="document") && !/google|yandex|analytics|facebook/i.test(res.url())) {
      network.push({status:res.status(),method:res.request().method(),url:res.url().slice(0,800)});
    }
  });
  try {
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:25000});
    await page.waitForTimeout(4000);
    const before=await page.evaluate(()=>({
      url:location.href,
      forms:[...document.forms].map(f=>({
        id:f.id,name:f.getAttribute("name"),action:f.getAttribute("action"),method:f.getAttribute("method"),
        controls:[...f.elements].filter(e=>e instanceof HTMLInputElement || e instanceof HTMLSelectElement).map(e=>({
          tag:e.tagName,name:e.getAttribute("name"),id:e.id,type:e.getAttribute("type"),value:e.value,
          options:e instanceof HTMLSelectElement ? [...e.options].slice(0,30).map(o=>({text:o.textContent?.trim(),value:o.value,selected:o.selected})) : undefined
        })).filter(x=>x.name)
      }))
    }));
    console.log("\n===PUBLIC BEFORE",id,"===\n"+JSON.stringify(before,null,2));

    if (id !== "sanat") {
      const searchForm = page.locator("form").filter({has:page.locator('input[name="CHECKIN"]')}).first();
      if (await searchForm.count()) {
        await searchForm.locator('input[name="CHECKIN"]').fill(fmt(tomorrow));
        const checkout=searchForm.locator('input[name="CHECKOUT"]');
        if(await checkout.count()) await checkout.fill(fmt(back));
        const yes=searchForm.locator('input[name="YESPLACES"]');
        if(await yes.count() && !(await yes.isChecked())) await yes.check();
        const submit=searchForm.locator('input[type="submit"],button[type="submit"],button').last();
        await Promise.all([
          page.waitForLoadState("domcontentloaded",{timeout:15000}).catch(()=>{}),
          submit.click()
        ]);
        await page.waitForTimeout(7000);
        console.log("\n===PUBLIC AFTER",id,"===\n"+JSON.stringify({
          url:page.url(),
          text:(await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,5000),
          network:network.slice(-60)
        },null,2));
      }
    } else {
      await page.waitForTimeout(2000);
      const apiUrl=await page.locator("#apiUrl").getAttribute("value").catch(()=>null);
      console.log("\n===SANAT APIURL===\n"+JSON.stringify({apiUrl,network:network.slice(-60)},null,2));
      const interesting=[...new Set(network.map(x=>x.url).filter(u=>/TourSearchOwin/i.test(u)))].slice(0,30);
      for(const endpoint of interesting){
        try{
          const response=await page.request.get(endpoint,{timeout:15000});
          const text=(await response.text()).slice(0,2500);
          console.log("\n===SANAT ENDPOINT===\n"+JSON.stringify({status:response.status(),url:endpoint,body:text},null,2));
        }catch(e){
          console.log("SANAT endpoint error",endpoint,e instanceof Error?e.message:String(e));
        }
      }
    }
  } catch(e) {
    console.log("\n===PUBLIC ERROR",id,"===\n",e instanceof Error?e.message:String(e));
  } finally { await page.close(); }
}
await browser.close();
