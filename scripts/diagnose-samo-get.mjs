const sources = [
  ["kazunion","https://online.kazunion.com/tickets?CHILD=0&ADULT=2&CURRENCYINC=4&CHECKIN=20260930&CHECKOUT=20261007&FREIGHTBACK=1&YESPLACES=1"],
  ["crystal_bay","https://booking-kz.crystalbay.com/tickets?CHILD=0&ADULT=2&CHECKIN=20260927&CHECKOUT=20261004&FREIGHTBACK=1&YESPLACES=1"],
  ["abk","https://b2b.abktourism.kz/tickets?CHILD=0&ADULT=2&CHECKIN=20260927&CHECKOUT=20261004&FREIGHTBACK=1&YESPLACES=1"]
];
function strip(html){return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();}
for (const [id,url] of sources){
  try{
    const r=await fetch(url,{redirect:"follow",headers:{"user-agent":"Mozilla/5.0 CharterSyncDiag/1.0","accept-language":"ru-RU,ru;q=0.9"},signal:AbortSignal.timeout(20000)});
    const html=await r.text();
    console.log("\n===GET "+id+"===\n"+JSON.stringify({status:r.status,url:r.url,length:html.length,text:strip(html).slice(0,9000),forms:[...html.matchAll(/<form[^>]*>/gi)].slice(0,10).map(m=>m[0]),prices:[...html.matchAll(/.{0,100}(?:USD|EUR|KZT|₸|\$|€|тенге|price|стоим).{0,220}/giu)].slice(0,25).map(m=>strip(m[0]))},null,2));
  }catch(e){console.log("\n===GET "+id+" ERROR===\n"+(e instanceof Error?e.stack:String(e)));}
}
