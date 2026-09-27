import test from "node:test";
import assert from "node:assert/strict";
import { fetchSamoTicketOffers, samoSearchConfig, __test } from "../scripts/samo-ticket-adapter.mjs";

test("normalizes a SAMO ticket price row", () => {
  const offer = __test.normalizeOffer({ id: "kazunion" }, {
    DateBeg: "20261002",
    DateBegBack: "20261010",
    FreightName: "DV 5334",
    PartnerInName: "SCAT",
    SrcTownName: "Almaty",
    SrcPortAlias: "ALA",
    TrgTownName: "Cam Ranh",
    TrgPortAlias: "CXR",
    TotalCost: "450",
    CurrencyAlias: "USD",
    BlockStatusIn: 1,
    BlockCountIn: 4,
    oneWay: "0",
    id: "offer-1"
  });
  assert.equal(offer.trip, "RT");
  assert.equal(offer.departureDate, "2026-10-02");
  assert.equal(offer.returnDate, "2026-10-10");
  assert.equal(offer.sourcePrice, 450);
  assert.equal(offer.currency, "USD");
  assert.equal(offer.seats, "4 мест");
});

test("search config is bounded and route-scoped", () => {
  const cfg = samoSearchConfig({
    SAMO_ORIGIN_IATA: "ALA,NQZ",
    SAMO_TARGET_IATA: "CXR,PQC",
    SAMO_SEARCH_HORIZON_DAYS: "500",
    SAMO_RT_NIGHTS: "7,10,14,999"
  });
  assert.deepEqual(cfg.origins, ["ALA", "NQZ"]);
  assert.deepEqual(cfg.targets, ["CXR", "PQC"]);
  assert.equal(cfg.horizonDays, 180);
  assert.deepEqual(cfg.roundTripNights, [7, 10, 14]);
});

test("missing API token is reported without making network calls", async () => {
  let called = false;
  const result = await fetchSamoTicketOffers({
    source: {
      id: "crystal_bay",
      kind: "b2b_web",
      apiBaseUrl: "https://example.test/export/default.php",
      apiTokenEnv: "CRYSTAL_BAY_SAMO_API_TOKEN"
    },
    token: "",
    fetchImpl: async () => {
      called = true;
      throw new Error("must not call");
    }
  });
  assert.equal(called, false);
  assert.equal(result.status.status, "configuration_required");
  assert.equal(result.offers.length, 0);
});

test("discovers configured route and returns one-way and round-trip offers", async () => {
  const calls = [];
  const fakeFetch = async url => {
    const parsed = new URL(url);
    const action = parsed.searchParams.get("action");
    calls.push({
      action,
      source: parsed.searchParams.get("SOURCE"),
      target: parsed.searchParams.get("TARGET"),
      hasToken: Boolean(parsed.searchParams.get("oauth_token"))
    });

    let body;
    if (action === "Tickets_SOURCES") {
      body = { Tickets_SOURCES: [
        { id: "10.1", portAlias: "ALA", town: "Almaty" },
        { id: "20.2", portAlias: "TSE", town: "Old Astana" }
      ] };
    } else if (action === "Tickets_CURRENCIES") {
      body = { Tickets_CURRENCIES: [
        { id: 1, currencyISO: "USD", name: "USD" },
        { id: 2, currencyISO: "EUR", name: "EUR" }
      ] };
    } else if (action === "Tickets_CLASSES") {
      body = { Tickets_CLASSES: [{ id: 0, name: "Econom" }] };
    } else if (action === "Tickets_TARGETS") {
      body = { Tickets_TARGETS: [
        { id: "30.3", portAlias: "CXR", town: "Cam Ranh" },
        { id: "40.4", portAlias: "DXB", town: "Dubai" }
      ] };
    } else if (action === "Tickets_PRICES") {
      const isRound = parsed.searchParams.has("CHECKOUT");
      body = { Tickets_PRICES: [isRound ? {
        DateBeg: "20261002",
        DateBegBack: "20261012",
        FreightName: "DV 5334",
        PartnerInName: "SCAT",
        SrcTownName: "Almaty",
        SrcPortAlias: "ALA",
        TrgTownName: "Cam Ranh",
        TrgPortAlias: "CXR",
        TotalCost: "500",
        CurrencyAlias: "USD",
        BlockStatusIn: 1,
        oneWay: "0",
        id: "rt-1"
      } : {
        DateBeg: "20261002",
        FreightName: "DV 5334",
        PartnerInName: "SCAT",
        SrcTownName: "Almaty",
        SrcPortAlias: "ALA",
        TrgTownName: "Cam Ranh",
        TrgPortAlias: "CXR",
        TotalCost: "300",
        CurrencyAlias: "USD",
        BlockStatusIn: 1,
        oneWay: "1",
        id: "ow-1"
      }] };
    } else {
      throw new Error("Unexpected action " + action);
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await fetchSamoTicketOffers({
    source: {
      id: "kazunion",
      kind: "b2b_web",
      apiBaseUrl: "https://example.test/export/default.php",
      apiTokenEnv: "KAZUNION_SAMO_API_TOKEN"
    },
    token: "secret-token",
    now: new Date("2026-09-27T00:00:00Z"),
    env: {
      SAMO_ORIGIN_IATA: "ALA",
      SAMO_TARGET_IATA: "CXR",
      SAMO_RT_NIGHTS: "10",
      SAMO_SEARCH_HORIZON_DAYS: "30",
      SAMO_REQUEST_DELAY_MS: "0"
    },
    fetchImpl: fakeFetch
  });

  assert.equal(result.status.status, "ok");
  assert.equal(result.status.routes, 1);
  assert.equal(result.offers.length, 2);
  assert.ok(result.offers.some(offer => offer.trip === "OW"));
  assert.ok(result.offers.some(offer => offer.trip === "RT"));
  assert.ok(calls.every(call => call.hasToken));
  assert.ok(calls.some(call => call.action === "Tickets_TARGETS" && call.source === "10.1"));
  assert.ok(calls.some(call => call.action === "Tickets_PRICES" && call.target === "30.3"));
});
