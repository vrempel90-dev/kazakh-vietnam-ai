import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const DEFAULT_PRICING_CONFIG = {
  version: 1,
  updatedAt: null,
  rules: [
    {
      id: "template-ow",
      name: "OW +10 000 ₸",
      enabled: false,
      priority: 0,
      scope: { trip: "OW" },
      calculation: { type: "fixed_kzt", value: 10000 }
    },
    {
      id: "template-rt",
      name: "RT +20 000 ₸",
      enabled: false,
      priority: 0,
      scope: { trip: "RT" },
      calculation: { type: "fixed_kzt", value: 20000 }
    }
  ]
};

const TYPES = new Set(["fixed_kzt", "percent", "sale_price_kzt"]);
const TRIPS = new Set(["OW", "RT"]);

function stringOrUndefined(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizePricingConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const rules = Array.isArray(source.rules) ? source.rules : [];

  return {
    version: 1,
    updatedAt: source.updatedAt ? String(source.updatedAt) : null,
    rules: rules.slice(0, 200).map((raw, index) => {
      const scope = raw?.scope && typeof raw.scope === "object" ? raw.scope : {};
      const calculation = raw?.calculation && typeof raw.calculation === "object" ? raw.calculation : {};
      const type = TYPES.has(calculation.type) ? calculation.type : "fixed_kzt";
      const trip = TRIPS.has(scope.trip) ? scope.trip : undefined;
      return {
        id: stringOrUndefined(raw?.id) || "rule-" + (index + 1),
        name: stringOrUndefined(raw?.name) || "Правило " + (index + 1),
        enabled: Boolean(raw?.enabled),
        priority: Math.round(numberOr(raw?.priority, 0)),
        scope: {
          offerId: stringOrUndefined(scope.offerId),
          sourceId: stringOrUndefined(scope.sourceId),
          from: stringOrUndefined(scope.from),
          to: stringOrUndefined(scope.to),
          trip
        },
        calculation: {
          type,
          value: Math.max(0, numberOr(calculation.value, 0))
        }
      };
    })
  };
}

export async function loadPricingConfig(path = process.env.PRICING_RULES_PATH || resolve("config/pricing-rules.default.json")) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return normalizePricingConfig(parsed);
  } catch {
    return normalizePricingConfig(DEFAULT_PRICING_CONFIG);
  }
}

export async function savePricingConfig(path, config) {
  const normalized = normalizePricingConfig(config);
  normalized.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

function sameText(a, b) {
  return String(a || "").trim().toLocaleLowerCase("ru-RU") === String(b || "").trim().toLocaleLowerCase("ru-RU");
}

function matchesScope(scope, context) {
  if (scope.offerId && scope.offerId !== context.offerId) return false;
  if (scope.sourceId && scope.sourceId !== context.sourceId) return false;
  if (scope.trip && scope.trip !== context.trip) return false;
  if (scope.from && !sameText(scope.from, context.from)) return false;
  if (scope.to && !sameText(scope.to, context.to)) return false;
  return true;
}

function specificity(scope) {
  if (scope.offerId) return 1000;
  if (scope.from && scope.to && scope.trip) return 800;
  if (scope.from && scope.to) return 700;
  if (scope.sourceId && scope.trip) return 600;
  if (scope.sourceId) return 500;
  if (scope.trip) return 400;
  return 100;
}

export function selectPricingRule(config, context) {
  const rules = normalizePricingConfig(config).rules
    .filter(rule => rule.enabled && matchesScope(rule.scope, context))
    .sort((a, b) => {
      const specificityDiff = specificity(b.scope) - specificity(a.scope);
      if (specificityDiff) return specificityDiff;
      return b.priority - a.priority;
    });
  return rules[0] || null;
}

function envRate(currency) {
  if (currency === "KZT") return 1;
  const key = "FX_" + currency + "_KZT";
  const number = Number(process.env[key]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function convertCostToKzt(sourcePrice, currency, rates = {}) {
  const numeric = Number(sourcePrice);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const code = String(currency || "KZT").trim().toUpperCase();
  const rate = code === "KZT"
    ? 1
    : Number(rates[code + "_KZT"]) || envRate(code);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return numeric * rate;
}

export function roundSalePrice(value, step = Number(process.env.SALE_PRICE_ROUNDING) || 1000) {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1000;
  return Math.ceil(value / safeStep) * safeStep;
}

export function calculateSalePrice({ sourcePrice, currency, sourceId, offerId, from, to, trip, rates, config, roundingStep }) {
  const costKzt = convertCostToKzt(sourcePrice, currency, rates);
  if (costKzt == null) return null;

  const rule = selectPricingRule(config, { sourceId, offerId, from, to, trip });
  if (!rule) return null;

  let raw;
  if (rule.calculation.type === "fixed_kzt") {
    raw = costKzt + rule.calculation.value;
  } else if (rule.calculation.type === "percent") {
    raw = costKzt * (1 + rule.calculation.value / 100);
  } else {
    raw = rule.calculation.value;
  }

  if (!Number.isFinite(raw) || raw <= 0) return null;
  return {
    salePrice: roundSalePrice(raw, roundingStep),
    costKzt,
    ruleId: rule.id,
    ruleName: rule.name
  };
}
