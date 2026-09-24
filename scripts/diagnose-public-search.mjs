import { chromium } from "@playwright/test";

const sources = [
  ["kazunion", "https://online.kazunion.com/tickets"],
  ["crystal_bay", "https://booking-kz.crystalbay.com/tickets"],
  ["abk", "https://b2b.abktourism.kz/tickets"]
];

const d1 = new Date(); d1.setDate(d1.getDate()+4);
const d2 = new Date(d1); d2.setDate(d2.getDate()+7);
const fmt = d => [String(d.getDate()).padStart(2,"0"),String(d.getMonth()+1).padStart(2,"0"),d.getFullYear()].join(".");

const browser=await chromium.launch({headless:true});
for(const [id,url] of sources){
  const page=await browser.newPage({locale:"ru-RU"});
  const requests=[];
  page.on("response",async res=>{
    const type=res.request().resourceType();
    if((type==="xhr"||type==="fetch")&&!/google|yandex|analytics|facebook/i.test(res.url())){
      let body="";
      try { body=(await res.text()).slice(0,2500); } catch {}
      requests.push({status:res.status(),method:res.request().method(),url:res.url().slice(0,1200),postData:(res.request().postData()||"").slice(0,1800),body});
    }
  });
  try{
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:25000});
    await page.waitForTimeout(3500);
    const one=page.locator('input[name="ONEWAY"]');
    const back=page.locator('input[name="CHECKOUT"]');
    const hidden=page.locator('input[name="FREIGHTBACK"]');
    const before={oneChecked:await one.isChecked().catch(()=>null),backDisabled:await back.isDisabled().catch(()=>null),hidden:await hidden.inputValue().catch(()=>null)};
    if(await one.count()) await one.click({force:true});
    await page.waitForTimeout(500);
    const afterToggle={oneChecked:await one.isChecked().catch(()=>null),backDisabled:await back.isDisabled().catch(()=>null),hidden:await hidden.inputValue().catch(()=>null)};
    const checkin=page.locator('input[name="CHECKIN"]');
    if(await checkin.count()) await checkin.fill(fmt(d1));
    if(await back.count() && !(await back.isDisabled())) await back.fill(fmt(d2));
    const places=page.locator('input[name="YESPLACES"]');
    if(await places.count() && !(await places.isChecked())) await places.check();
    const submit=page.locator('input[type="submit"]').filter({has:undefined}).last();
    if(await submit.count()) {
      await submit.click();
      await page.waitForTimeout(10000);
    }
    console.log("\n===FLOW "+id+"===\n"+JSON.stringify({
      before,afterToggle,url:page.url(),
      text:(await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,6500),
      requests:requests.slice(-50)
    },null,2));
  }catch(e){console.log("\n===FLOW "+id+" ERROR===\n"+(e instanceof Error?e.stack:String(e)));}
  finally{await page.close();}
}
await browser.close();
