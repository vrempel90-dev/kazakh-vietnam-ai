function listFromEnv(value, fallback = []) {
  const items = String(value || "")
    .split(",")
    .map(item => item.trim().toUpperCase())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function numberFromEnv(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function compactDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join("");
}

function isoFromCompact(value) {
  const text = String(value || "").replace(/[^0-9]/g, "");
  if (text.length !== 8) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) return null;
  return [text.slice(0, 4), text.slice(4, 6), text.slice(6, 8)].join("-");
}

function addDays(date, days) {
  const copy = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function iataOf(item) {
  return String(item?.portAlias || item?.townIATA || item?.iata || "")
    .trim()
    .toUpperCase();
}

function findArray(payload, key) {
  const value = payload?.[key];
  return Array.isArray(value) ? value : [];
}

function currencyChoice(currencies, preference) {
  const byCode = new Map(
    currencies.map(item => [
      String(item?.currencyISO || item?.name || "").trim().toUpperCase(),
      item
    ])
  );
  for (const code of preference) {
    const item = byCode.get(code);
    if (item) return { id: item.id, code };
  }
  return null;
}

function classChoice(classes) {
  return classes.find(item => /econom/i.test(String(item?.name || item?.nameAlt || "")))
    || classes.find(item => Number(item?.id) === 0)
    || classes[0]
    || null;
}

function parseSeats(row) {
  const raw = row?.BlockCountIn;
  if (Number.isFinite(Number(raw)) && Number(raw) > 0) return Number(raw) + " мест";
  if (Number(row?.BlockStatusIn) === 1) return "Есть места";
  const text = String(raw || "").trim();
  if (text) return text.slice(0, 80);
  return "Наличие уточняется";
}

function parsePrice(row) {
  const values = [row?.TotalCost, row?.price, row?.CostTO];
  for (const value of values) {
    const n = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function normalizeOffer(source, row) {
  const departureDate = isoFromCompact(row?.DateBeg || row?.checkIn);
  if (!departureDate) return null;

  const oneWay = String(row?.oneWay ?? row?.oneway ?? "") === "1"
    || (!row?.DateBegBack && !row?.checkOut);

  const returnDate = oneWay
    ? null
    : isoFromCompact(row?.DateBegBack || row?.checkOut || row?.DateEnd);

  const sourcePrice = parsePrice(row);
  const currency = String(row?.CurrencyAlias || row?.currency || "").trim().toUpperCase();
  if (!sourcePrice || !currency) return null;

  const fromIata = String(row?.SrcPortAlias || "").trim().toUpperCase();
  const toIata = String(row?.TrgPortAlias || "").trim().toUpperCase();
  const from = String(row?.SrcTownName || fromIata || "").trim();
  const to = String(row?.TrgTownName || toIata || "").trim();
  if (!from || !to) return null;

  return {
    sourceId: source.id,
    externalId: String(row?.id || row?.offer_id || [
      source.id,
      fromIata || from,
      toIata || to,
      departureDate,
      returnDate || "",
      row?.FreightName || ""
    ].join("|")),
    from,
    to,
    fromIata,
    toIata,
    departureDate,
    returnDate,
    trip: returnDate ? "RT" : "OW",
    airline: String(row?.PartnerInName || row?.PartnerInAlias || "").trim() || undefined,
    flightNumber: String(row?.FreightName || "").trim() || undefined,
    sourcePrice,
    currency,
    seats: parseSeats(row),
    baggage: String(row?.bagageInfoTo || "").trim() || undefined
  };
}

async function apiCall({ baseUrl, token, action, params = {}, fetchImpl, timeoutMs }) {
  const url = new URL(baseUrl);
  const search = new URLSearchParams({
    samo_action: "api",
    version: "1.0",
    type: "json",
    oauth_token: token,
    action
  });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  url.search = search.toString();

  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "CharterFlightSync/3.0"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(action + " HTTP " + response.status);
  }

  const payload = await response.json();
  if (payload?.error || payload?.Error) {
    throw new Error(action + " API error");
  }
  return payload;
}

export function samoSearchConfig(env = process.env) {
  const horizonDays = numberFromEnv(env.SAMO_SEARCH_HORIZON_DAYS, 60, 7, 180);
  return {
    origins: listFromEnv(env.SAMO_ORIGIN_IATA, ["ALA", "NQZ"]),
    targets: listFromEnv(env.SAMO_TARGET_IATA, ["CXR", "PQC", "DAD", "BKK", "HKT", "SYX"]),
    currencyPreference: listFromEnv(env.SAMO_CURRENCY_PREFERENCE, ["KZT", "USD", "EUR"]),
    horizonDays,
    roundTripNights: String(env.SAMO_RT_NIGHTS || "7,10,14")
      .split(",")
      .map(value => Number(value.trim()))
      .filter(value => Number.isInteger(value) && value >= 2 && value <= 30)
      .slice(0, 6),
    includeRegular: String(env.SAMO_INCLUDE_REGULAR || "false").toLowerCase() === "true",
    maxRoutes: numberFromEnv(env.SAMO_MAX_ROUTES_PER_SOURCE, 12, 1, 50),
    requestDelayMs: numberFromEnv(env.SAMO_REQUEST_DELAY_MS, 200, 0, 5000),
    timeoutMs: numberFromEnv(env.SAMO_REQUEST_TIMEOUT_MS, 15000, 3000, 60000)
  };
}

export async function fetchSamoTicketOffers({
  source,
  token,
  now = new Date(),
  env = process.env,
  fetchImpl = fetch
}) {
  if (!source?.apiBaseUrl) {
    return {
      offers: [],
      status: {
        id: source?.id || "unknown",
        kind: source?.kind || "b2b_web",
        status: "configuration_required",
        reason: "SAMO API base URL is not configured"
      }
    };
  }
  if (!String(token || "").trim()) {
    return {
      offers: [],
      status: {
        id: source.id,
        kind: source.kind,
        status: "configuration_required",
        reason: source.apiTokenEnv + " is not configured"
      }
    };
  }

  const config = samoSearchConfig(env);
  const common = {
    baseUrl: source.apiBaseUrl,
    token: String(token).trim(),
    fetchImpl,
    timeoutMs: config.timeoutMs
  };

  const [sourcesPayload, currenciesPayload, classesPayload] = await Promise.all([
    apiCall({
      ...common,
      action: "Tickets_SOURCES",
      params: { WITH_CHARTER: 1, WITH_REGULAR: config.includeRegular ? 1 : 0 }
    }),
    apiCall({
      ...common,
      action: "Tickets_CURRENCIES",
      params: { WITH_CHARTER: 1, WITH_REGULAR: config.includeRegular ? 1 : 0 }
    }),
    apiCall({
      ...common,
      action: "Tickets_CLASSES",
      params: { WITH_CHARTER: 1, WITH_REGULAR: config.includeRegular ? 1 : 0 }
    })
  ]);

  const sources = findArray(sourcesPayload, "Tickets_SOURCES")
    .filter(item => config.origins.includes(iataOf(item)));
  const currencies = findArray(currenciesPayload, "Tickets_CURRENCIES");
  const classes = findArray(classesPayload, "Tickets_CLASSES");
  const currency = currencyChoice(currencies, config.currencyPreference);
  const seatClass = classChoice(classes);

  if (!sources.length) {
    return {
      offers: [],
      status: {
        id: source.id,
        kind: source.kind,
        status: "ok",
        routes: 0,
        requests: 3,
        offers: 0,
        reason: "No configured Kazakhstan departure airports are available in this supplier feed"
      }
    };
  }
  if (!currency || !seatClass) {
    return {
      offers: [],
      status: {
        id: source.id,
        kind: source.kind,
        status: "configuration_required",
        routes: 0,
        requests: 3,
        offers: 0,
        reason: "No supported pricing currency or economy class is available in this supplier feed"
      }
    };
  }

  const routePairs = [];
  let requests = 3;
  for (const sourceAirport of sources) {
    const targetsPayload = await apiCall({
      ...common,
      action: "Tickets_TARGETS",
      params: {
        SOURCE: sourceAirport.id,
        WITH_CHARTER: 1,
        WITH_REGULAR: config.includeRegular ? 1 : 0
      }
    });
    requests += 1;
    const targets = findArray(targetsPayload, "Tickets_TARGETS")
      .filter(item => config.targets.includes(iataOf(item)));
    for (const targetAirport of targets) {
      routePairs.push({ sourceAirport, targetAirport });
      if (routePairs.length >= config.maxRoutes) break;
    }
    if (routePairs.length >= config.maxRoutes) break;
  }

  const center = addDays(now, Math.ceil(config.horizonDays / 2));
  const delta = Math.ceil(config.horizonDays / 2);
  const offers = [];
  const sleep = ms => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

  for (const route of routePairs) {
    const baseParams = {
      SOURCE: route.sourceAirport.id,
      TARGET: route.targetAirport.id,
      CLASS: seatClass.id,
      CURRENCYINC: currency.id,
      ADULT: 1,
      CHILD: 0,
      INFANT: 0,
      CHECKIN: compactDate(center),
      CHECKIN_DELTA: delta,
      YESPLACES: 1,
      WITH_CHARTER: 1,
      WITH_REGULAR: config.includeRegular ? 1 : 0
    };

    const oneWayPayload = await apiCall({
      ...common,
      action: "Tickets_PRICES",
      params: baseParams
    });
    requests += 1;
    offers.push(...findArray(oneWayPayload, "Tickets_PRICES")
      .map(row => normalizeOffer(source, row))
      .filter(Boolean));
    await sleep(config.requestDelayMs);

    for (const nights of config.roundTripNights) {
      const roundTripPayload = await apiCall({
        ...common,
        action: "Tickets_PRICES",
        params: {
          ...baseParams,
          CHECKOUT: compactDate(addDays(center, nights)),
          CHECKOUT_DELTA: delta
        }
      });
      requests += 1;
      offers.push(...findArray(roundTripPayload, "Tickets_PRICES")
        .map(row => normalizeOffer(source, row))
        .filter(Boolean)
        .filter(offer => offer.trip === "RT"));
      await sleep(config.requestDelayMs);
    }
  }

  const unique = new Map();
  for (const offer of offers) {
    const key = offer.externalId || [
      offer.fromIata,
      offer.toIata,
      offer.departureDate,
      offer.returnDate || "",
      offer.airline || "",
      offer.sourcePrice,
      offer.currency
    ].join("|");
    const current = unique.get(key);
    if (!current || offer.sourcePrice < current.sourcePrice) unique.set(key, offer);
  }

  return {
    offers: [...unique.values()],
    status: {
      id: source.id,
      kind: source.kind,
      status: "ok",
      routes: routePairs.length,
      requests,
      offers: unique.size
    }
  };
}

export const __test = {
  compactDate,
  isoFromCompact,
  normalizeOffer,
  currencyChoice,
  classChoice,
  iataOf
};
