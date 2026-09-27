const CURRENCY_PATTERNS = {
  KZT: [/\bKZT\b/iu, /₸/u, /\bтенге\b/iu],
  USD: [/\bUSD\b/iu, /\bдоллар(?:а|ов)?\s+США\b/iu],
  EUR: [/\bEUR\b/iu, /€/u, /\bевро\b/iu]
};

export function normalizeCurrencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return ["KZT", "USD", "EUR"].includes(code) ? code : null;
}

export function detectExplicitCurrency(text) {
  const source = String(text || "");
  const matches = Object.entries(CURRENCY_PATTERNS)
    .filter(([, patterns]) => patterns.some(pattern => pattern.test(source)))
    .map(([code]) => code);
  return matches.length === 1 ? matches[0] : null;
}

export function resolveSourceCurrency({ configured, sourceText }) {
  const fromConfig = normalizeCurrencyCode(configured);
  if (fromConfig) return { currency: fromConfig, source: "environment" };

  const fromSource = detectExplicitCurrency(sourceText);
  if (fromSource) return { currency: fromSource, source: "source-explicit-marker" };

  return { currency: null, source: "unconfirmed" };
}
