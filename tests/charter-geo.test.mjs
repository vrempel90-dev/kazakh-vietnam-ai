import test from "node:test";
import assert from "node:assert/strict";
import {
  TICKET_CATEGORIES,
  classifyFlight,
  cityKey,
  displayCity,
  isKazakhstanCity,
  isPublishableCategory,
  resolveCity
} from "../scripts/charter-geo.mjs";

const ow = (from, to, extra = {}) => ({
  from, to, trip: "OW", departureDate: "2026-10-21", price: 100000, ...extra
});

test("scenario 1: Astana -> Phu Quoc is an outbound ticket from Kazakhstan", () => {
  const result = classifyFlight(ow("Астана", "Фукуок"));
  assert.equal(result.category, TICKET_CATEGORIES.OUTBOUND);
  assert.equal(result.country.code, "VN");
  assert.equal(result.country.name, "Вьетнам");
});

test("scenario 2: Phu Quoc -> Astana is an inbound (return) ticket", () => {
  const result = classifyFlight(ow("Фукуок", "Астана"));
  assert.equal(result.category, TICKET_CATEGORIES.INBOUND);
  assert.equal(result.country.code, "VN", "a return leg still belongs to the Vietnam digest");
});

test("scenario 3: Astana -> Phu Quoc -> Astana is a round trip, not a return leg", () => {
  const result = classifyFlight({
    from: "Астана",
    to: "Фукуок",
    trip: "RT",
    departureDate: "2026-10-21",
    returnDate: "2026-10-28"
  });
  assert.equal(result.category, TICKET_CATEGORIES.ROUND_TRIP);
  assert.equal(result.nights, 7);
  assert.equal(result.roundTrip, true);
});

test("a single return leg is never classified as a round trip", () => {
  const inbound = classifyFlight(ow("Нячанг", "Алматы"));
  assert.equal(inbound.category, TICKET_CATEGORIES.INBOUND);
  assert.notEqual(inbound.category, TICKET_CATEGORIES.ROUND_TRIP);
  assert.equal(inbound.nights, null);
});

test("scenario 4: Almaty -> Seoul belongs to South Korea in every spelling", () => {
  for (const destination of ["Seoul", "Сеул", "Incheon", "Инчхон", "ICN", "GMP", "seul"]) {
    const result = classifyFlight(ow("Алматы", destination));
    assert.equal(result.category, TICKET_CATEGORIES.OUTBOUND, destination);
    assert.equal(result.country.code, "KR", destination);
  }
});

test("Vietnamese city aliases and IATA codes normalise to one city", () => {
  assert.equal(resolveCity("Nha Trang").name, "Нячанг");
  assert.equal(resolveCity("Cam Ranh").name, "Нячанг");
  assert.equal(resolveCity("Камрань").name, "Нячанг");
  assert.equal(resolveCity("CXR").name, "Нячанг");
  assert.equal(resolveCity("Phu Quoc").name, "Фукуок");
  assert.equal(resolveCity("PQC").name, "Фукуок");
  assert.equal(resolveCity("Da Nang").name, "Дананг");
  assert.equal(resolveCity("DAD").name, "Дананг");
});

test("Kazakh cities resolve across casing, latin spelling and stray invisible characters", () => {
  assert.equal(resolveCity("АЛМАТЫ").name, "Алматы");
  assert.equal(resolveCity("almaty").name, "Алматы");
  assert.equal(resolveCity("​​ АЛМАТЫ ").name, "Алматы");
  assert.equal(resolveCity("ALA").name, "Алматы");
  assert.equal(resolveCity("Шымкент").name, "Шымкент");
  assert.equal(resolveCity("CIT").name, "Шымкент");
  assert.ok(isKazakhstanCity("Астана"));
  assert.ok(isKazakhstanCity("NQZ"));
  assert.ok(!isKazakhstanCity("Фукуок"));
});

test("cities that used to fall into \"other destinations\" now resolve to a country", () => {
  assert.equal(resolveCity("Будапешт").country.name, "Венгрия");
  assert.equal(resolveCity("Кутаиси").country.name, "Грузия");
  assert.equal(resolveCity("Мюнхен").country.name, "Германия");
  assert.equal(resolveCity("Маттала").country.name, "Шри-Ланка");
  assert.equal(resolveCity("Гоа (Индия)").country.name, "Индия");
  assert.equal(resolveCity("Газипаша").country.name, "Турция");
  assert.equal(resolveCity("Куала-Лумпур").country.name, "Малайзия");
});

test("third-country routes get their own category instead of becoming return tickets", () => {
  const result = classifyFlight(ow("Дубай", "Бангкок"));
  assert.equal(result.category, TICKET_CATEGORIES.FOREIGN);
  assert.notEqual(result.category, TICKET_CATEGORIES.INBOUND);
  assert.equal(result.country.code, "TH");
});

test("domestic Kazakh routes are not published as a country digest", () => {
  const result = classifyFlight(ow("Алматы", "Астана"));
  assert.equal(result.category, TICKET_CATEGORIES.DOMESTIC);
  assert.equal(isPublishableCategory(result.category), false);
});

test("an unresolvable city is reported, never published under an invented country", () => {
  const result = classifyFlight(ow("Алматы", "Неизвестныйгород"));
  assert.equal(result.category, TICKET_CATEGORIES.UNKNOWN);
  assert.equal(result.reason, "UNRESOLVED_DESTINATION");
  assert.equal(result.country, null);
  assert.equal(isPublishableCategory(result.category), false);
});

test("a stated RT without a return date is held for review", () => {
  const result = classifyFlight({
    from: "Алматы", to: "Анталия", trip: "RT", departureDate: "2026-10-13", price: 263000
  });
  assert.equal(result.category, TICKET_CATEGORIES.UNKNOWN);
  assert.equal(result.reason, "MISSING_RETURN_DATE");
  assert.equal(result.nights, null, "no stay length may be invented");
});

test("a return date that is not after departure is corrupt data and is held back", () => {
  const result = classifyFlight({
    from: "Алматы", to: "Анталия", trip: "RT",
    departureDate: "2026-10-13", returnDate: "2026-10-13"
  });
  assert.equal(result.category, TICKET_CATEGORIES.UNKNOWN);
  assert.equal(result.reason, "INVALID_RETURN_DATE");
});

test("a route to and from the same city is rejected", () => {
  const result = classifyFlight(ow("Алматы", "ALA"));
  assert.equal(result.reason, "SAME_ORIGIN_AND_DESTINATION");
});

test("city keys ignore flags, emoji, markdown and bracketed country hints", () => {
  assert.equal(cityKey("🇻🇳 *Фукуок* (Вьетнам)"), cityKey("фукуок"));
  assert.equal(displayCity("PQC"), "Фукуок");
});
