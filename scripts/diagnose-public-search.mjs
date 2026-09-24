import { chromium } from "@playwright/test";

const sources = [
  ["kazunion", "https://online.kazunion.com/tickets"],
  ["crystal_bay", "https://booking-kz.crystalbay.com/tickets"],
  ["abk", "https://b2b.abktourism.kz/tickets"]
];

const d1 = new Date(); d1.setDate(d1.getDate()+3);
const d2 = new Date(d1); d2.setDate(d2.getDate()+7);
const fmt = d => [String(d.getDate()).padStart(2,"0"),String(d.getMonth()+1).padStart(2,"0"),d.getFullYear()].join(".");

const browser=await chromium.launch({headless:true});
for(const [id,url] of sources){
  const page=await browser.newPage({locale:"ru-RU"});
  const network=[];
  page.on("response",res=>{
    const type=res.request().resourceType();
    if((type==="xhr"||type==="fetch"||type==="document")&&!/google|yandex|analytics|facebook/i.test(res.url())){
      network.push({status:res.status(),method:res.request().method(),url:res.url().slice(0,1200),postData:(res.request().postData()||"").slice(0,1800)});
    }
  });
  try{
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:25000});
    await page.waitForTimeout(4000);
    const controls=await page.evaluate(()=>({
      selects:[...document.querySelectorAll("select")].map(s=>({name:s.name,value:s.value,options:[...s.options].slice(0,40).map(o=>({text:(o.textContent||"").trim(),value:o.value,selected:o.selected}))})),
      inputs:[...document.querySelectorAll("input")].map(i=>({name:i.name,type:i.type,value:i.value,id:i.id})).filter(x=>x.name||x.type==="submit").slice(0,80),
      buttons:[...document.querySelectorAll("button,input[type=submit]")].map(b=>({tag:b.tagName,type:b.getAttribute("type"),value:b.getAttribute("value"),text:(b.textContent||"").trim(),id:b.id,className:b.className})).slice(0,30)
    }));
    console.log("\n===SEARCH CONTROLS "+id+"===\n"+JSON.stringify(controls,null,2));

    const checkin=page.locator('input[name="CHECKIN"]');
    if(await checkin.count()) await checkin.fill(fmt(d1));
    const checkout=page.locator('input[name="CHECKOUT"]');
    if(await checkout.count()) await checkout.fill(fmt(d2));
    const places=page.locator('input[name="YESPLACES"]');
    if(await places.count() && !(await places.isChecked())) await places.check();

    const submit=page.locator('input[type="submit"],button[type="submit"]').last();
    console.log("submit count",id,await submit.count());
    if(await submit.count()){
      await submit.click();
      await page.waitForTimeout(9000);
    }
    console.log("\n===SEARCH RESULT "+id+"===\n"+JSON.stringify({
      url:page.url(),
      text:(await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,7000),
      network:network.slice(-80)
    },null,2));
  }catch(e){console.log("ERROR",id,e instanceof Error?e.message:String(e));}
  finally{await page.close();}
}
await browser.close();
