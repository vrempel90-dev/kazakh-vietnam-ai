import test from "node:test";
import assert from "node:assert/strict";
import { detectExplicitCurrency, resolveSourceCurrency } from "../scripts/source-currency.mjs";

test("detects only explicit source currency markers", () => {
  assert.equal(detectExplicitCurrency("Цена KZT"), "KZT");
  assert.equal(detectExplicitCurrency("Стоимость, ₸"), "KZT");
  assert.equal(detectExplicitCurrency("fare USD"), "USD");
  assert.equal(detectExplicitCurrency("price EUR"), "EUR");
  assert.equal(detectExplicitCurrency("Цена 325000"), null);
});

test("does not guess when multiple currencies appear", () => {
  assert.equal(detectExplicitCurrency("USD / EUR"), null);
  assert.equal(detectExplicitCurrency("KZT, курс USD"), null);
});

test("environment configuration has precedence over source markers", () => {
  assert.deepEqual(
    resolveSourceCurrency({ configured: "usd", sourceText: "Цена EUR" }),
    { currency: "USD", source: "environment" }
  );
});

test("returns unconfirmed instead of inferring from numeric magnitude", () => {
  assert.deepEqual(
    resolveSourceCurrency({ configured: "", sourceText: "25.09, ALACXR, 1500" }),
    { currency: null, source: "unconfirmed" }
  );
});
