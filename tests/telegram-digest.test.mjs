import test from "node:test";
import assert from "node:assert/strict";
import {
  FOOTER_TEXT,
  TELEGRAM_TEXT_LIMIT,
  buildCountryDigests,
  carrierCode
} from "../scripts/telegram-digest.mjs";

const NOW = new Date("2026-10-12T06:00:00Z");
const plain = text => text.replace(/<\/?b>/g, "");

/**
 * The reference layout from the agreed specification: one country, internal
 * sections, carrier letters, legend and a single closing line.
 */
const vietnam = [
  { id: "o1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000, airlineCode: "V", airline: "VietJet Air", seats: "3 мест" },
  { id: "o2", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-23", price: 110000, airlineCode: "S", airline: "SCAT", seats: "2 места" },
  { id: "i1", from: "Дананг", to: "Астана", trip: "OW", departureDate: "2026-10-25", price: 78000, airlineCode: "V", seats: "4 мест" },
  { id: "i2", from: "Нячанг", to: "Алматы", trip: "OW", departureDate: "2026-10-26", price: 110000, airlineCode: "A", seats: "1 место" },
  { id: "i3", from: "Нячанг", to: "Алматы", trip: "OW", departureDate: "2026-10-27", price: 122000, airlineCode: "S", seats: "Наличие уточняется" },
  { id: "i4", from: "Нячанг", to: "Алматы", trip: "OW", departureDate: "2026-10-28", price: 135000, airlineCode: "A", seats: "3 мест" },
  { id: "i5", from: "Фукуок", to: "Астана", trip: "OW", departureDate: "2026-10-29", price: 55000, airlineCode: "V" },
  { id: "i6", from: "Фукуок", to: "Астана", trip: "OW", departureDate: "2026-10-30", price: 78000, airlineCode: "S" },
  { id: "r1", from: "Астана", to: "Фукуок", trip: "RT", departureDate: "2026-10-21", returnDate: "2026-10-28", price: 196000 }
];

test("one country produces exactly one message with all sections inside it", () => {
  const { digests, summary } = buildCountryDigests(vietnam, { now: NOW });
  assert.equal(digests.length, 1, "Vietnam must not be split across several posts");
  assert.equal(summary.countries, 1);
  assert.equal(digests[0].country, "VN");
  assert.equal(digests[0].parts, 1);
  assert.equal(digests[0].offers, vietnam.length);

  const text = plain(digests[0].text);
  assert.equal(text.match(/ВЬЕТНАМ/g).length, 1, "the country heading appears once");
  assert.equal(text.match(/БИЛЕТЫ ТУДА/g).length, 1);
  assert.equal(text.match(/ОБРАТНЫЕ БИЛЕТЫ/g).length, 1);
  assert.equal(text.match(/ТУДА И ОБРАТНО/g).length, 1);
});

test("the rendered digest matches the agreed reference layout line for line", () => {
  const { digests } = buildCountryDigests(vietnam, { now: NOW });
  assert.equal(plain(digests[0].text), [
    "🇻🇳 ВЬЕТНАМ",
    "",
    "БИЛЕТЫ ТУДА",
    "",
    "Астана - Фукуок",
    "",
    "V 21.10 - 96 000 ₸ (3)",
    "S 23.10 - 110 000 ₸ (2)",
    "",
    "ОБРАТНЫЕ БИЛЕТЫ",
    "",
    "Дананг - Астана",
    "",
    "V 25.10 - 78 000 ₸ (4)",
    "",
    "Нячанг - Алматы",
    "",
    "A 26.10 - 110 000 ₸ (1)",
    "S 27.10 - 122 000 ₸",
    "A 28.10 - 135 000 ₸ (3)",
    "",
    "Фукуок - Астана",
    "",
    "V 29.10 - 55 000 ₸",
    "S 30.10 - 78 000 ₸",
    "",
    "ТУДА И ОБРАТНО",
    "",
    "Астана - Фукуок - Астана",
    "",
    "21.10–28.10 - 196 000 ₸ (7 ночей)",
    "",
    "A - Air Astana",
    "S - SCAT",
    "V - VietJet Air",
    "",
    FOOTER_TEXT
  ].join("\n"));
});

test("sections are ordered outbound, inbound, round trip and never interleaved", () => {
  const { digests } = buildCountryDigests(vietnam, { now: NOW });
  const text = plain(digests[0].text);
  assert.ok(text.indexOf("БИЛЕТЫ ТУДА") < text.indexOf("ОБРАТНЫЕ БИЛЕТЫ"));
  assert.ok(text.indexOf("ОБРАТНЫЕ БИЛЕТЫ") < text.indexOf("ТУДА И ОБРАТНО"));

  // The inbound section must contain only inbound routes.
  const inbound = text.slice(text.indexOf("ОБРАТНЫЕ БИЛЕТЫ"), text.indexOf("ТУДА И ОБРАТНО"));
  assert.ok(inbound.includes("Фукуок - Астана"));
  assert.ok(!inbound.includes("Астана - Фукуок\n"), "an outbound route must not leak into returns");
});

test("dates inside a route ascend", () => {
  const { digests } = buildCountryDigests(vietnam, { now: NOW });
  const text = plain(digests[0].text);
  const block = text.slice(text.indexOf("Нячанг - Алматы"));
  const days = [...block.matchAll(/^[A-Z]? ?(\d{2})\.10 - /gm)].slice(0, 3).map(m => Number(m[1]));
  assert.deepEqual(days, [26, 27, 28]);
});

test("scenario 5: data from two countries is never mixed into one message", () => {
  const { digests, diagnostics } = buildCountryDigests([
    ...vietnam,
    { id: "th1", from: "Алматы", to: "Пхукет", trip: "OW", departureDate: "2026-11-03", price: 150000, airlineCode: "S" },
    { id: "cn1", from: "Алматы", to: "Санья", trip: "OW", departureDate: "2026-11-04", price: 160000 },
    { id: "in1", from: "Алматы", to: "Гоа", trip: "OW", departureDate: "2026-11-06", price: 170000 },
    // South Korea and Turkiye carry a large share of the live inventory, but
    // the client did not include them: they are refused, not rendered.
    { id: "kr1", from: "Алматы", to: "Seoul", trip: "OW", departureDate: "2026-11-02", price: 190000, airlineCode: "A" },
    { id: "tr1", from: "Астана", to: "Анталия", trip: "OW", departureDate: "2026-11-05", price: 95000, airlineCode: "P" }
  ], { now: NOW });

  assert.equal(digests.length, 4);
  const names = ["ВЬЕТНАМ", "ТАИЛАНД", "КИТАЙ", "ИНДИЯ"];
  for (const digest of digests) {
    const text = plain(digest.text);
    const present = names.filter(name => text.includes(name));
    assert.equal(present.length, 1, "each message names exactly one country: " + present.join(","));
  }
  assert.equal(new Set(digests.map(d => d.country)).size, 4);

  assert.deepEqual(
    diagnostics.map(item => item.id + ":" + item.reason).sort(),
    ["kr1:COUNTRY_NOT_ALLOWED", "tr1:COUNTRY_NOT_ALLOWED"]
  );
  const rendered = plain(digests.map(digest => digest.text).join("\n"));
  assert.ok(!rendered.includes("КОРЕЯ"));
  assert.ok(!rendered.includes("ТУРЦИЯ"));
});

test("scenario 6: the same offer is never repeated inside a digest", () => {
  const duplicated = [
    vietnam[0],
    { ...vietnam[0] },
    { ...vietnam[0], id: "o1-copy" },
    { ...vietnam[0], id: "o1-other-price", price: 99000 }
  ];
  const { digests, duplicates } = buildCountryDigests(duplicated, { now: NOW });
  const lines = plain(digests[0].text).split("\n").filter(line => line.includes("96 000 ₸"));
  assert.equal(lines.length, 1, "an identical offer collapses to one line");
  assert.equal(duplicates, 2, "both the repeated id and the identical copy are counted");
  assert.ok(
    plain(digests[0].text).includes("99 000 ₸"),
    "a genuinely different price on the same date is kept"
  );
});

test("different carriers on the same date are both kept", () => {
  const { digests } = buildCountryDigests([
    { id: "a", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000, airlineCode: "V" },
    { id: "b", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000, airlineCode: "S" }
  ], { now: NOW });
  const lines = plain(digests[0].text).split("\n").filter(line => line.includes("21.10"));
  assert.equal(lines.length, 2);
});

test("scenario 13: a large country list splits into parts without losing an offer", () => {
  const many = Array.from({ length: 260 }, (_, index) => ({
    id: "big-" + index,
    from: index % 2 ? "Алматы" : "Астана",
    to: "Нячанг",
    trip: "OW",
    departureDate: "2026-11-" + String(1 + (index % 28)).padStart(2, "0"),
    price: 100000 + index * 137,
    airlineCode: index % 3 === 0 ? "V" : index % 3 === 1 ? "S" : "A",
    seats: String(1 + (index % 9)) + " мест"
  }));

  const { digests, summary } = buildCountryDigests(many, { now: NOW });
  assert.ok(digests.length > 1, "the digest must split");
  assert.equal(summary.offers, 260, "no offer is dropped by splitting");

  const covered = digests.flatMap(digest => digest.offerIds);
  assert.equal(new Set(covered).size, 260);
  assert.equal(covered.length, 260, "no offer appears in two parts");

  for (const digest of digests) {
    assert.ok(digest.text.length <= TELEGRAM_TEXT_LIMIT, "each part fits a Telegram message");
    assert.ok(plain(digest.text).includes("Часть " + digest.part + "/" + digest.parts));
    assert.ok(plain(digest.text).endsWith(FOOTER_TEXT));
    assert.equal(digest.parts, digests.length);
  }
});

test("a single route longer than one message is chunked and marked as continued", () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    id: "one-route-" + index,
    from: "Алматы",
    to: "Нячанг",
    trip: "OW",
    departureDate: "2026-11-" + String(1 + (index % 28)).padStart(2, "0"),
    price: 100000 + index,
    airlineCode: "V"
  }));
  const { digests, summary } = buildCountryDigests(many, { maxChars: 700, now: NOW });
  assert.ok(digests.length > 2);
  assert.equal(summary.offers, 120);
  assert.ok(digests.some(digest => digest.text.includes("(продолжение)")));
  assert.ok(digests.every(digest => digest.text.length <= 700));
});

test("unclassifiable offers go to diagnostics instead of an \"other destinations\" post", () => {
  const { digests, diagnostics } = buildCountryDigests([
    vietnam[0],
    { id: "x1", from: "Алматы", to: "Нигдеград", trip: "OW", departureDate: "2026-11-01", price: 120000 },
    { id: "x2", from: "Алматы", to: "Астана", trip: "OW", departureDate: "2026-11-02", price: 30000 }
  ], { now: NOW });

  assert.equal(digests.length, 1);
  assert.ok(!digests.some(digest => digest.text.includes("Другие направления")));
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map(item => item.reason).sort(),
    ["DOMESTIC_ROUTE", "UNRESOLVED_DESTINATION"]
  );
});

test("the legend only lists carriers present in that part and uses canonical names", () => {
  const { digests } = buildCountryDigests([
    { id: "l1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000, airlineCode: "S", airline: "Scat" },
    { id: "l2", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-22", price: 97000, airlineCode: "V", airline: "VietJet" }
  ], { now: NOW });
  const text = plain(digests[0].text);
  assert.ok(text.includes("S - SCAT"), "messy source spelling is normalised");
  assert.ok(text.includes("V - VietJet Air"));
  assert.ok(!text.includes("A - Air Astana"), "an absent carrier is not advertised");
  assert.ok(!text.includes("Scat\n"));
});

test("an unknown carrier shows no invented letter and no legend entry", () => {
  const { digests } = buildCountryDigests([
    { id: "u1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000 }
  ], { now: NOW });
  const text = plain(digests[0].text);
  assert.ok(text.includes("21.10 - 96 000 ₸"));
  assert.ok(!/^[A-Z] 21\.10/m.test(text));
  assert.ok(!text.includes(" - SCAT"));
});

test("seats, stay length and baggage are never invented", () => {
  const { digests } = buildCountryDigests([
    { id: "n1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000, seats: "Наличие уточняется" },
    { id: "n2", from: "Астана", to: "Фукуок", trip: "RT", departureDate: "2026-10-22", price: 196000 }
  ], { now: NOW });
  const text = plain(digests[0].text);
  assert.ok(text.includes("21.10 - 96 000 ₸\n"), "unknown availability prints no seat count");
  assert.ok(text.includes("22.10 - 196 000 ₸"), "a round trip with no return date shows one date");
  assert.ok(!text.includes("22.10–"), "no dangling return-date separator");
  assert.ok(!/ноч/.test(text), "no stay length without a return date");
  assert.ok(!/кг/.test(text), "no baggage claims in the digest");
});

test("a departure in another year carries its year so it cannot read as a past date", () => {
  const { digests } = buildCountryDigests([
    { id: "y1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2027-09-14", price: 200000 }
  ], { now: NOW });
  assert.ok(plain(digests[0].text).includes("14.09.27 - 200 000 ₸"));
});

test("carrier letters are taken from the source code first, then from the name", () => {
  assert.equal(carrierCode({ airlineCode: "V", airline: "Air Astana" }), "V");
  assert.equal(carrierCode({ airline: "Air Astana" }), "A");
  assert.equal(carrierCode({ airline: "SCAT" }), "S");
  assert.equal(carrierCode({ airline: "VietJet Air" }), "V");
  assert.equal(carrierCode({ airline: "flydubai" }), "D");
  assert.equal(carrierCode({ airline: "Нечто неизвестное" }), null);
  assert.equal(carrierCode({}), null);
});

test("HTML in city or carrier names cannot break the message markup", () => {
  const { digests } = buildCountryDigests([
    { id: "h1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000, airline: "<b>Fake</b> & Co" }
  ], { now: NOW });
  assert.ok(digests[0].text.includes("&lt;b&gt;Fake&lt;/b&gt; &amp; Co"));
});

test("the content hash changes only when the rendered text changes", () => {
  const first = buildCountryDigests(vietnam, { now: NOW }).digests[0];
  const same = buildCountryDigests([...vietnam].reverse(), { now: NOW }).digests[0];
  assert.equal(first.contentHash, same.contentHash, "input order must not change the hash");

  const changed = buildCountryDigests(
    vietnam.map(f => (f.id === "o1" ? { ...f, price: 97000 } : f)),
    { now: NOW }
  ).digests[0];
  assert.notEqual(first.contentHash, changed.contentHash);
});
