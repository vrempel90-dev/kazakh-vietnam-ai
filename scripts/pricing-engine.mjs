import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWriteJson } from "./atomic-json.mjs";

export const DEFAULT_PRICING_CONFIG = {
  version: 1,
  updatedAt: null,
  rules: [
    {
      id: "template-ow",
      name: "OW +10 000 ₸",
      enabled: true,
      priority: 0,
      scope: { trip: "OW" },
      calculation: { type: "fixed_kzt", value: 10000 }
    },
    {
      id: "template-rt",
      name: "RT +20 000 ₸",
      enabled: true,
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
  const number = typeof value === "number" || (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
    ? Number(value)
    : NaN;
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
      const value = numberOr(calculation.value, NaN);
      const validCalculation = TYPES.has(calculation.type)
        && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
        && (calculation.type !== "sale_price_kzt" || value > 0);
      const validTripScope = scope.trip == null || scope.trip === "" || TRIPS.has(scope.trip);
      return {
        id: stringOrUndefined(raw?.id) || "rule-" + (index + 1),
        name: stringOrUndefined(raw?.name) || "Правило " + (index + 1),
        enabled: raw?.enabled === true && validCalculation && validTripScope,
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
          value: validCalculation ? value : 0
        }
      };
    })
  };
}

export async function loadPricingConfig(path = process.env.PRICING_RULES_PATH || resolve("config/pricing-rules.default.json")) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return validatedPricingConfig(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return normalizePricingConfig(DEFAULT_PRICING_CONFIG);
    throw new Error("Could not load pricing configuration", { cause: error });
  }
}

export async function savePricingConfig(path, config) {
  const normalized = validatedPricingConfig(config);
  normalized.updatedAt = new Date().toISOString();
  await atomicWriteJson(path, normalized);
  return normalized;
}

function validatedPricingConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) || !Array.isArray(config.rules)) {
    throw new TypeError("Pricing configuration must contain a rules array");
  }
  const normalized = normalizePricingConfig(config);
  for (const [index, rule] of normalized.rules.entries()) {
    if (config.rules[index]?.enabled === true && !rule.enabled) {
      throw new TypeError("Enabled pricing rule has an invalid calculation or trip scope");
    }
  }
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
  const number = numberOr(process.env[key], NaN);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function convertCostToKzt(sourcePrice, currency, rates = {}) {
  const numeric = numberOr(sourcePrice, NaN);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > Number.MAX_SAFE_INTEGER) return null;
  const code = String(currency || "KZT").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const rateKey = code + "_KZT";
  const rate = code === "KZT"
    ? 1
    : Object.hasOwn(rates || {}, rateKey)
      ? numberOr(rates[rateKey], NaN)
      : envRate(code);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const costKzt = numeric * rate;
  return Number.isFinite(costKzt) && costKzt > 0 && costKzt <= Number.MAX_SAFE_INTEGER ? costKzt : null;
}

export function roundSalePrice(value, step = Number(process.env.SALE_PRICE_ROUNDING) || 1000) {
  const amount = numberOr(value, NaN);
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) return null;
  const configuredStep = numberOr(step, NaN);
  const safeStep = configuredStep > 0 && configuredStep <= Number.MAX_SAFE_INTEGER ? configuredStep : 1000;
  const increments = Math.ceil(amount / safeStep);
  if (!Number.isSafeInteger(increments)) return null;
  const rounded = Math.max(amount, increments * safeStep);
  return Number.isFinite(rounded) && rounded > 0 && rounded <= Number.MAX_SAFE_INTEGER ? rounded : null;
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
  const salePrice = roundSalePrice(raw, roundingStep);
  if (salePrice == null) return null;
  return {
    salePrice,
    costKzt,
    ruleId: rule.id,
    ruleName: rule.name
  };
}
