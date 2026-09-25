import assert from "node:assert/strict";
import { DEFAULT_PRICING_CONFIG, calculateSalePrice, normalizePricingConfig, selectPricingRule } from "../scripts/pricing-engine.mjs";

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

console.log("Pricing engine priority, fixed markup, percent markup, FX, and safe no-rule behavior: passed");
