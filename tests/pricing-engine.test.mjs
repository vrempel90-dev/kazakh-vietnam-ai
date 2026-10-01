import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_PRICING_CONFIG, calculateSalePrice, convertCostToKzt, loadPricingConfig, normalizePricingConfig, roundSalePrice, savePricingConfig, selectPricingRule } from "../scripts/pricing-engine.mjs";

assert.equal(DEFAULT_PRICING_CONFIG.rules.find(rule => rule.scope.trip === "OW")?.enabled, true);
assert.equal(DEFAULT_PRICING_CONFIG.rules.find(rule => rule.scope.trip === "RT")?.enabled, true);
assert.equal(
  calculateSalePrice({
    sourcePrice: 100000,
    currency: "KZT",
    sourceId: "supplier",
    from: "Алматы",
    to: "Нячанг",
    trip: "OW",
    config: DEFAULT_PRICING_CONFIG,
    rates: {},
    roundingStep: 1000
  })?.salePrice,
  110000
);
assert.equal(
  calculateSalePrice({
    sourcePrice: 100000,
    currency: "KZT",
    sourceId: "supplier",
    from: "Алматы",
    to: "Нячанг",
    trip: "RT",
    config: DEFAULT_PRICING_CONFIG,
    rates: {},
    roundingStep: 1000
  })?.salePrice,
  120000
);

const config = normalizePricingConfig({
  rules: [
    { id: "global", name: "Global 5%", enabled: true, scope: {}, calculation: { type: "percent", value: 5 } },
    { id: "ow", name: "OW +10k", enabled: true, scope: { trip: "OW" }, calculation: { type: "fixed_kzt", value: 10000 } },
    { id: "source", name: "NEOS +12k", enabled: true, scope: { sourceId: "neos" }, calculation: { type: "fixed_kzt", value: 12000 } },
    { id: "route", name: "ALA-CXR +15k", enabled: true, scope: { from: "Алматы", to: "Нячанг" }, calculation: { type: "fixed_kzt", value: 15000 } },
    { id: "route-ow", name: "ALA-CXR OW +18k", enabled: true, scope: { from: "Алматы", to: "Нячанг", trip: "OW" }, calculation: { type: "fixed_kzt", value: 18000 } },
    { id: "offer", name: "Exact sale", enabled: true, scope: { offerId: "abc" }, calculation: { type: "sale_price_kzt", value: 199000 } }
  ]
});

assert.equal(selectPricingRule(config, { sourceId: "neos", from: "Алматы", to: "Нячанг", trip: "OW" })?.id, "route-ow");
assert.equal(selectPricingRule(config, { sourceId: "neos", from: "Алматы", to: "Дананг", trip: "OW" })?.id, "source");
assert.equal(selectPricingRule(config, { sourceId: "other", from: "Астана", to: "Дананг", trip: "OW" })?.id, "ow");
assert.equal(selectPricingRule(config, { sourceId: "other", from: "Астана", to: "Дананг", trip: "RT" })?.id, "global");
assert.equal(selectPricingRule(config, { offerId: "abc", sourceId: "neos", from: "Алматы", to: "Нячанг", trip: "OW" })?.id, "offer");

const fixed = calculateSalePrice({
  sourcePrice: 100000,
  currency: "KZT",
  sourceId: "other",
  from: "Астана",
  to: "Дананг",
  trip: "OW",
  config,
  rates: {},
  roundingStep: 1000
});
assert.equal(fixed?.salePrice, 110000);

const percent = calculateSalePrice({
  sourcePrice: 100000,
  currency: "KZT",
  sourceId: "other",
  from: "Астана",
  to: "Дананг",
  trip: "RT",
  config,
  rates: {},
  roundingStep: 1000
});
assert.equal(percent?.salePrice, 105000);

const usd = calculateSalePrice({
  sourcePrice: 300,
  currency: "USD",
  sourceId: "other",
  from: "Астана",
  to: "Дананг",
  trip: "OW",
  config,
  rates: { USD_KZT: 500 },
  roundingStep: 1000
});
assert.equal(usd?.salePrice, 160000);

const noRule = calculateSalePrice({
  sourcePrice: 100000,
  currency: "KZT",
  sourceId: "x",
  from: "A",
  to: "B",
  trip: "OW",
  config: { rules: [] },
  rates: {}
});
assert.equal(noRule, null);

for (const value of [NaN, Infinity, -Infinity, 0, -1, "", " ", "NaN", "Infinity", "0x100", null, true, false, [], [100000], {}]) {
  assert.equal(convertCostToKzt(value, "KZT"), null, `Reject nonpositive/nondecimal source price ${String(value)}`);
}
assert.equal(convertCostToKzt("100000", " kzt "), 100000);
assert.equal(convertCostToKzt("300.5", " usd ", { USD_KZT: "500" }), 150250);
assert.equal(convertCostToKzt(300, "EUR", {}), null, "Missing FX must never be treated as KZT");
assert.equal(convertCostToKzt(300, "USD", { USD_KZT: true }), null);
assert.equal(convertCostToKzt(300, "USD", { USD_KZT: Infinity }), null);
assert.equal(convertCostToKzt(300, "USD", { USD_KZT: Number.MAX_VALUE }), null, "FX overflow must fail closed");
assert.equal(convertCostToKzt(300, "USD_KZT", { USD_KZT_KZT: 500 }), null);
const previousRate = process.env.FX_USD_KZT;
process.env.FX_USD_KZT = "500";
try {
  assert.equal(convertCostToKzt(300, "USD", { USD_KZT: 0 }), null, "Explicit invalid rate must not silently fall back to a different rate");
  assert.equal(convertCostToKzt(300, "USD", {}), 150000);
} finally {
  if (previousRate == null) delete process.env.FX_USD_KZT;
  else process.env.FX_USD_KZT = previousRate;
}
for (const value of [NaN, Infinity, 0, -1, true, Number.MAX_VALUE]) assert.equal(roundSalePrice(value), null);
assert.equal(roundSalePrice(100001, "500"), 100500, "Decimal string rounding steps are honored");
assert.equal(roundSalePrice(100001, Infinity), 101000, "Invalid rounding uses the existing safe default");
assert.equal(roundSalePrice(100001, 1e-300), null, "Rounding overflow must not produce infinity");
assert.equal(calculateSalePrice({ sourcePrice: Number.MAX_SAFE_INTEGER, currency: "KZT", trip: "OW", config: DEFAULT_PRICING_CONFIG }), null);

for (const calculation of [
  { type: "fixed_kzt", value: -1 }, { type: "fixed_kzt", value: NaN },
  { type: "fixed_kzt", value: Infinity }, { type: "fixed_kzt", value: true },
  { type: "sale_price_kzt", value: 0 }, { type: "unknown", value: 10000 }
]) {
  const invalid = { rules: [{ enabled: true, scope: {}, calculation }] };
  assert.equal(selectPricingRule(invalid, { trip: "OW" }), null, "Invalid rule must not become an enabled zero-markup rule");
  assert.equal(calculateSalePrice({ sourcePrice: 100000, currency: "KZT", trip: "OW", config: invalid }), null);
}
assert.equal(selectPricingRule({ rules: [{ enabled: "false", calculation: { type: "fixed_kzt", value: 10000 } }] }, {}), null);
assert.equal(selectPricingRule({ rules: [{ enabled: true, scope: { trip: "INVALID" }, calculation: { type: "fixed_kzt", value: 10000 } }] }, {}), null, "Invalid trip scope must not broaden to all flights");
assert.equal(roundSalePrice(100000, 1000), 100000);
assert.equal(calculateSalePrice({ sourcePrice: 100000, currency: "KZT", trip: "OW", config: DEFAULT_PRICING_CONFIG })?.salePrice, 110000);
assert.equal(calculateSalePrice({ sourcePrice: 100000, currency: "KZT", trip: "OW", config: DEFAULT_PRICING_CONFIG })?.salePrice, 110000, "Repeated sync pricing from raw cost applies markup once");

const temporary = await mkdtemp(join(tmpdir(), "charter-pricing-test-"));
try {
  const path = join(temporary, "pricing.json");
  assert.deepEqual((await loadPricingConfig(path)).rules, normalizePricingConfig(DEFAULT_PRICING_CONFIG).rules);
  await writeFile(path, "{broken", "utf8");
  await assert.rejects(loadPricingConfig(path), /Could not load pricing configuration/);
  assert.equal(await readFile(path, "utf8"), "{broken", "Corrupt pricing state must remain available for recovery");
  await writeFile(path, JSON.stringify({ missing: "rules" }), "utf8");
  await assert.rejects(loadPricingConfig(path), /Could not load pricing configuration/);
  await assert.rejects(savePricingConfig(path, {}), /rules array/);
  await assert.rejects(savePricingConfig(path, { rules: [{ enabled: true, calculation: { type: "percent", value: -5 } }] }), /invalid calculation/);
  const saved = await savePricingConfig(join(temporary, "nested", "pricing.json"), config);
  assert.deepEqual(await loadPricingConfig(join(temporary, "nested", "pricing.json")), saved);
  const saves = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => savePricingConfig(path, { rules: [{ id: `writer-${index}`, enabled: true, scope: {}, calculation: { type: "fixed_kzt", value: index } }] })));
  for (const savedResult of saves) assert.equal(savedResult.status, "fulfilled", `Concurrent atomic save must complete: ${savedResult.reason?.message || ""}`);
  const concurrentSaved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(concurrentSaved.rules.length, 1, "Concurrent saves leave one complete JSON document");
  assert.match(concurrentSaved.rules[0].id, /^writer-\d$/);
} finally {
  assert.ok(temporary.startsWith(join(tmpdir(), "charter-pricing-test-")), "Cleanup stays inside the allocated test directory");
  await rm(temporary, { recursive: true, force: true });
}

console.log("Pricing priority, raw-cost repeat pricing, strict numeric/FX/rounding guards, malformed rules/state, and atomic save: passed");
