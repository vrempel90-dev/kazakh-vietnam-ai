/**
 * Single source of truth for charter geography.
 *
 * Every stage of the Telegram pipeline (parser, validator, grouping, renderer,
 * publication state) must resolve cities and ticket categories through this
 * module. Historically each stage kept its own city table and its own notion of
 * "direction", which is why one country could end up spread over several posts
 * and why outbound/inbound/RT offers leaked into each other.
 */

const COUNTRIES = [
  ["KZ", "Казахстан", "Kazakhstan", "🇰🇿"],
  ["VN", "Вьетнам", "Vietnam", "🇻🇳"],
  ["TH", "Таиланд", "Thailand", "🇹🇭"],
  ["MY", "Малайзия", "Malaysia", "🇲🇾"],
  ["KR", "Южная Корея", "South Korea", "🇰🇷"],
  ["CN", "Китай", "China", "🇨🇳"],
  ["JP", "Япония", "Japan", "🇯🇵"],
  ["SG", "Сингапур", "Singapore", "🇸🇬"],
  ["ID", "Индонезия", "Indonesia", "🇮🇩"],
  ["TR", "Турция", "Turkiye", "🇹🇷"],
  ["EG", "Египет", "Egypt", "🇪🇬"],
  ["AE", "ОАЭ", "UAE", "🇦🇪"],
  ["QA", "Катар", "Qatar", "🇶🇦"],
  ["SA", "Саудовская Аравия", "Saudi Arabia", "🇸🇦"],
  ["BH", "Бахрейн", "Bahrain", "🇧🇭"],
  ["OM", "Оман", "Oman", "🇴🇲"],
  ["JO", "Иордания", "Jordan", "🇯🇴"],
  ["MV", "Мальдивы", "Maldives", "🇲🇻"],
  ["LK", "Шри-Ланка", "Sri Lanka", "🇱🇰"],
  ["IN", "Индия", "India", "🇮🇳"],
  ["NP", "Непал", "Nepal", "🇳🇵"],
  ["PH", "Филиппины", "Philippines", "🇵🇭"],
  ["GE", "Грузия", "Georgia", "🇬🇪"],
  ["AZ", "Азербайджан", "Azerbaijan", "🇦🇿"],
  ["AM", "Армения", "Armenia", "🇦🇲"],
  ["KG", "Кыргызстан", "Kyrgyzstan", "🇰🇬"],
  ["UZ", "Узбекистан", "Uzbekistan", "🇺🇿"],
  ["TJ", "Таджикистан", "Tajikistan", "🇹🇯"],
  ["RU", "Россия", "Russia", "🇷🇺"],
  ["BY", "Беларусь", "Belarus", "🇧🇾"],
  ["HU", "Венгрия", "Hungary", "🇭🇺"],
  ["RS", "Сербия", "Serbia", "🇷🇸"],
  ["ME", "Черногория", "Montenegro", "🇲🇪"],
  ["GR", "Греция", "Greece", "🇬🇷"],
  ["BG", "Болгария", "Bulgaria", "🇧🇬"],
  ["IT", "Италия", "Italy", "🇮🇹"],
  ["DE", "Германия", "Germany", "🇩🇪"],
  ["ES", "Испания", "Spain", "🇪🇸"],
  ["FR", "Франция", "France", "🇫🇷"],
  ["CZ", "Чехия", "Czech Republic", "🇨🇿"],
  ["AT", "Австрия", "Austria", "🇦🇹"],
  ["PL", "Польша", "Poland", "🇵🇱"],
  ["NL", "Нидерланды", "Netherlands", "🇳🇱"],
  ["GB", "Великобритания", "United Kingdom", "🇬🇧"],
  ["CY", "Кипр", "Cyprus", "🇨🇾"],
  ["TN", "Тунис", "Tunisia", "🇹🇳"],
  ["MA", "Марокко", "Morocco", "🇲🇦"],
  ["TZ", "Танзания", "Tanzania", "🇹🇿"],
  ["SC", "Сейшелы", "Seychelles", "🇸🇨"],
  ["MU", "Маврикий", "Mauritius", "🇲🇺"]
];

/**
 * City table. Each entry: [countryCode, russianName, englishName, iataCodes, extraAliases]
 *
 * Aliases cover Russian declensions, Latin transliterations and the airport
 * names that public charter channels mix freely (Cam Ranh for Nha Trang,
 * Incheon for Seoul, Gazipasa for Alanya).
 */
const CITIES = [
  // Kazakhstan
  ["KZ", "Алматы", "Almaty", ["ALA"], ["алмата", "алма ата", "алматыг", "almaty", "alma ata"]],
  ["KZ", "Астана", "Astana", ["NQZ", "TSE"], ["астаны", "астане", "астану", "нурсултан", "nur sultan", "nursultan", "astana"]],
  ["KZ", "Шымкент", "Shymkent", ["CIT"], ["чимкент", "shymkent", "chimkent"]],
  ["KZ", "Атырау", "Atyrau", ["GUW"], ["atyrau"]],
  ["KZ", "Актобе", "Aktobe", ["AKX"], ["aktobe", "актюбинск"]],
  ["KZ", "Актау", "Aktau", ["SCO"], ["aktau"]],
  ["KZ", "Костанай", "Kostanay", ["KSN"], ["kostanay", "кустанай"]],
  ["KZ", "Кызылорда", "Kyzylorda", ["KZO"], ["kyzylorda"]],
  ["KZ", "Тараз", "Taraz", ["DMB"], ["taraz"]],
  ["KZ", "Уральск", "Uralsk", ["URA"], ["uralsk", "орал"]],
  ["KZ", "Петропавловск", "Petropavlovsk", ["PPK"], ["petropavlovsk"]],
  ["KZ", "Караганда", "Karaganda", ["KGF"], ["karaganda", "караганды"]],
  ["KZ", "Семей", "Semey", ["PLX"], ["semey", "семипалатинск"]],
  ["KZ", "Усть-Каменогорск", "Oskemen", ["UKK"], ["устькаменогорск", "оскемен", "oskemen", "ust kamenogorsk"]],
  ["KZ", "Туркестан", "Turkistan", ["HSA"], ["turkistan", "turkestan"]],
  ["KZ", "Кокшетау", "Kokshetau", ["KOV"], ["kokshetau"]],
  ["KZ", "Павлодар", "Pavlodar", ["PWQ"], ["pavlodar"]],

  // Vietnam
  ["VN", "Нячанг", "Nha Trang", ["CXR"], ["камрань", "кам рань", "камрань нячанг", "nha trang", "nhatrang", "cam ranh", "camranh", "ня чанг"]],
  // "фукуока" is the genitive the channels use in running text.
  ["VN", "Фукуок", "Phu Quoc", ["PQC"], ["phu quoc", "phuquoc", "фу куок", "фукуоке", "фукуока"]],
  ["VN", "Дананг", "Da Nang", ["DAD"], ["da nang", "danang", "да нанг"]],
  ["VN", "Ханой", "Hanoi", ["HAN"], ["hanoi", "ha noi"]],
  ["VN", "Хошимин", "Ho Chi Minh", ["SGN"], ["ho chi minh", "hochiminh", "сайгон", "saigon", "хо ши мин"]],

  // Thailand / South-East Asia
  ["TH", "Пхукет", "Phuket", ["HKT"], ["phuket", "фукет"]],
  ["TH", "Бангкок", "Bangkok", ["BKK", "DMK"], ["bangkok"]],
  ["TH", "Паттайя", "Pattaya", ["UTP"], ["pattaya", "паттая"]],
  ["TH", "Самуи", "Samui", ["USM"], ["samui", "ко самуи"]],
  ["TH", "Краби", "Krabi", ["KBV"], ["krabi"]],
  ["MY", "Куала-Лумпур", "Kuala Lumpur", ["KUL"], ["куала лумпур", "kuala lumpur", "kualalumpur"]],
  ["MY", "Лангкави", "Langkawi", ["LGK"], ["langkawi"]],
  ["SG", "Сингапур", "Singapore", ["SIN"], ["singapore"]],
  ["ID", "Бали", "Bali", ["DPS"], ["bali", "денпасар", "denpasar"]],
  ["ID", "Джакарта", "Jakarta", ["CGK"], ["jakarta"]],
  ["PH", "Манила", "Manila", ["MNL"], ["manila"]],

  // South Korea / China / Japan
  ["KR", "Сеул", "Seoul", ["ICN", "GMP", "SEL"], ["seoul", "seul", "инчхон", "инчон", "incheon", "inchon", "сеуле"]],
  ["KR", "Пусан", "Busan", ["PUS"], ["busan", "пусане"]],
  ["KR", "Чеджу", "Jeju", ["CJU"], ["jeju", "чечжу"]],
  ["CN", "Санья", "Sanya", ["SYX"], ["sanya", "хайнань", "hainan"]],
  ["CN", "Пекин", "Beijing", ["PEK", "PKX"], ["beijing", "пекине"]],
  ["CN", "Шанхай", "Shanghai", ["PVG", "SHA"], ["shanghai"]],
  ["CN", "Урумчи", "Urumqi", ["URC"], ["urumqi", "урумчи"]],
  ["CN", "Гуанчжоу", "Guangzhou", ["CAN"], ["guangzhou"]],
  ["CN", "Сиань", "Xian", ["XIY"], ["xian", "сиане"]],
  ["JP", "Токио", "Tokyo", ["NRT", "HND"], ["tokyo"]],

  // Turkiye
  ["TR", "Анталия", "Antalya", ["AYT"], ["анталья", "анталию", "анталии", "antalya"]],
  ["TR", "Аланья", "Alanya", ["GZP"], ["алания", "газипаша", "газипаша аланья", "gazipasa", "gazipaşa", "alanya"]],
  ["TR", "Стамбул", "Istanbul", ["IST", "SAW"], ["istanbul", "стамбуле"]],
  ["TR", "Бодрум", "Bodrum", ["BJV"], ["bodrum"]],
  ["TR", "Даламан", "Dalaman", ["DLM"], ["dalaman", "мармарис", "marmaris"]],
  ["TR", "Измир", "Izmir", ["ADB"], ["izmir"]],
  ["TR", "Трабзон", "Trabzon", ["TZX"], ["trabzon"]],

  // Egypt
  ["EG", "Шарм-эль-Шейх", "Sharm El Sheikh", ["SSH"], ["шармэшшейх", "шарм эш шейх", "шарм эль шейх", "шарм", "sharm el sheikh", "sharm", "sharmelsheikh"]],
  ["EG", "Хургада", "Hurghada", ["HRG"], ["хургаду", "хургаде", "hurghada"]],
  ["EG", "Каир", "Cairo", ["CAI"], ["cairo"]],
  ["EG", "Марса-Алам", "Marsa Alam", ["RMF"], ["марса алам", "marsa alam"]],

  // Gulf
  ["AE", "Дубай", "Dubai", ["DXB", "DWC"], ["дубаи", "дубая", "dubai"]],
  ["AE", "Шарджа", "Sharjah", ["SHJ"], ["sharjah"]],
  ["AE", "Абу-Даби", "Abu Dhabi", ["AUH"], ["абу даби", "abu dhabi", "abudhabi"]],
  ["AE", "Рас-эль-Хайма", "Ras Al Khaimah", ["RKT"], ["рас эль хайма", "ras al khaimah"]],
  ["QA", "Доха", "Doha", ["DOH"], ["doha"]],
  ["SA", "Джидда", "Jeddah", ["JED"], ["jeddah", "джидде"]],
  ["SA", "Медина", "Medina", ["MED"], ["medina", "медине"]],
  ["SA", "Рияд", "Riyadh", ["RUH"], ["riyadh", "эр рияд"]],
  ["BH", "Манама", "Manama", ["BAH"], ["manama", "бахрейн"]],
  ["OM", "Маскат", "Muscat", ["MCT"], ["muscat"]],
  ["JO", "Амман", "Amman", ["AMM"], ["amman"]],

  // Indian Ocean / South Asia
  ["MV", "Мале", "Male", ["MLE"], ["male", "мальдивы"]],
  ["LK", "Коломбо", "Colombo", ["CMB"], ["colombo"]],
  ["LK", "Маттала", "Mattala", ["HRI"], ["mattala", "хамбантота"]],
  ["IN", "Гоа", "Goa", ["GOI", "GOX"], ["goa"]],
  ["IN", "Дели", "Delhi", ["DEL"], ["delhi", "нью дели", "new delhi"]],
  ["IN", "Мумбаи", "Mumbai", ["BOM"], ["mumbai", "бомбей"]],
  ["NP", "Катманду", "Kathmandu", ["KTM"], ["kathmandu"]],

  // Caucasus / Central Asia / CIS
  ["GE", "Тбилиси", "Tbilisi", ["TBS"], ["tbilisi"]],
  ["GE", "Батуми", "Batumi", ["BUS"], ["batumi"]],
  ["GE", "Кутаиси", "Kutaisi", ["KUT"], ["kutaisi", "кутаиси"]],
  ["AZ", "Баку", "Baku", ["GYD"], ["baku"]],
  ["AM", "Ереван", "Yerevan", ["EVN"], ["yerevan"]],
  ["KG", "Бишкек", "Bishkek", ["FRU"], ["bishkek"]],
  ["KG", "Ош", "Osh", ["OSS"], ["osh"]],
  ["UZ", "Ташкент", "Tashkent", ["TAS"], ["tashkent"]],
  ["UZ", "Самарканд", "Samarkand", ["SKD"], ["samarkand"]],
  ["TJ", "Душанбе", "Dushanbe", ["DYU"], ["dushanbe"]],
  ["RU", "Москва", "Moscow", ["SVO", "DME", "VKO", "ZIA"], ["москву", "москве", "moscow"]],
  ["RU", "Санкт-Петербург", "Saint Petersburg", ["LED"], ["санктпетербург", "спб", "питер", "saint petersburg", "st petersburg"]],
  ["RU", "Сочи", "Sochi", ["AER"], ["sochi", "адлер"]],
  ["RU", "Казань", "Kazan", ["KZN"], ["kazan"]],
  ["RU", "Екатеринбург", "Yekaterinburg", ["SVX"], ["yekaterinburg", "екатеринбурге"]],
  ["RU", "Новосибирск", "Novosibirsk", ["OVB"], ["novosibirsk"]],
  ["BY", "Минск", "Minsk", ["MSQ"], ["minsk"]],

  // Europe
  ["HU", "Будапешт", "Budapest", ["BUD"], ["budapest", "будапеште"]],
  ["RS", "Белград", "Belgrade", ["BEG"], ["belgrade", "beograd"]],
  ["ME", "Тиват", "Tivat", ["TIV"], ["tivat", "черногория"]],
  ["ME", "Подгорица", "Podgorica", ["TGD"], ["podgorica"]],
  ["GR", "Афины", "Athens", ["ATH"], ["athens", "афинах"]],
  ["GR", "Салоники", "Thessaloniki", ["SKG"], ["thessaloniki"]],
  ["GR", "Крит", "Crete", ["HER"], ["crete", "ираклион", "heraklion"]],
  ["GR", "Родос", "Rhodes", ["RHO"], ["rhodes"]],
  ["BG", "Бургас", "Burgas", ["BOJ"], ["burgas"]],
  ["BG", "Варна", "Varna", ["VAR"], ["varna"]],
  ["IT", "Милан", "Milan", ["MXP", "BGY", "LIN"], ["milan", "милане", "милано"]],
  ["IT", "Рим", "Rome", ["FCO", "CIA"], ["rome", "риме"]],
  ["IT", "Венеция", "Venice", ["VCE"], ["venice"]],
  ["IT", "Неаполь", "Naples", ["NAP"], ["naples"]],
  ["IT", "Римини", "Rimini", ["RMI"], ["rimini"]],
  ["DE", "Мюнхен", "Munich", ["MUC"], ["мюнхене", "munich", "münchen", "munchen"]],
  ["DE", "Берлин", "Berlin", ["BER"], ["berlin"]],
  ["DE", "Франкфурт", "Frankfurt", ["FRA"], ["frankfurt"]],
  ["DE", "Дюссельдорф", "Dusseldorf", ["DUS"], ["dusseldorf", "düsseldorf"]],
  ["DE", "Ганновер", "Hannover", ["HAJ"], ["hannover", "hanover"]],
  ["ES", "Барселона", "Barcelona", ["BCN"], ["barcelona"]],
  ["ES", "Мадрид", "Madrid", ["MAD"], ["madrid"]],
  ["ES", "Малага", "Malaga", ["AGP"], ["malaga"]],
  ["ES", "Пальма-де-Майорка", "Palma de Mallorca", ["PMI"], ["пальма де майорка", "майорка", "mallorca", "palma"]],
  ["ES", "Тенерифе", "Tenerife", ["TFS", "TFN"], ["tenerife"]],
  ["FR", "Париж", "Paris", ["CDG", "ORY"], ["paris", "париже"]],
  ["FR", "Ницца", "Nice", ["NCE"], ["nice"]],
  ["CZ", "Прага", "Prague", ["PRG"], ["prague", "praha", "праге"]],
  ["AT", "Вена", "Vienna", ["VIE"], ["vienna", "wien", "вене"]],
  ["PL", "Варшава", "Warsaw", ["WAW"], ["warsaw", "warszawa"]],
  ["NL", "Амстердам", "Amsterdam", ["AMS"], ["amsterdam"]],
  ["GB", "Лондон", "London", ["LHR", "LGW", "STN"], ["london", "лондоне"]],
  ["CY", "Ларнака", "Larnaca", ["LCA"], ["larnaca"]],
  ["CY", "Пафос", "Paphos", ["PFO"], ["paphos"]],

  // Africa / Indian Ocean
  ["TN", "Монастир", "Monastir", ["MIR"], ["monastir", "энфида", "enfidha", "NBE"]],
  ["TN", "Тунис", "Tunis", ["TUN"], ["tunis"]],
  ["MA", "Марракеш", "Marrakesh", ["RAK"], ["marrakesh", "marrakech"]],
  ["MA", "Касабланка", "Casablanca", ["CMN"], ["casablanca"]],
  ["TZ", "Занзибар", "Zanzibar", ["ZNZ"], ["zanzibar"]],
  ["SC", "Сейшелы", "Seychelles", ["SEZ"], ["seychelles", "маэ"]],
  ["MU", "Маврикий", "Mauritius", ["MRU"], ["mauritius"]]
];

const COUNTRY_BY_CODE = new Map(
  COUNTRIES.map(([code, name, nameEn, flag]) => [code, { code, name, nameEn, flag }])
);

/**
 * Decodes the HTML entities t.me puts in post text.
 *
 * A channel writing "Астана -> Фукуок" is served as "Астана -&gt; Фукуок", and
 * an undecoded `&gt;` used to survive all the way into the city name, so the
 * destination arrived here as "&gt; Фукуок" and resolved to nothing. The
 * adapter decodes entities now; this is the safety net that keeps a single
 * missed spot from costing a whole country again.
 */
function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&(?:gt|#62|#x3e);/gi, ">")
    .replace(/&(?:lt|#60|#x3c);/gi, "<")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:amp|#38);/gi, "&");
}

/**
 * Collapses any human spelling into a comparable key: strips flags, emoji,
 * zero-width characters, markdown, bracketed country hints and punctuation.
 */
export function cityKey(value) {
  return decodeEntities(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/\([^)]*(?:\)|$)/g, " ")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[︎️​-‍⁠﻿]/g, "")
    .replace(/^\s*(?:ow|rt)\s+/i, " ")
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]/giu, "");
}

const CITY_BY_KEY = new Map();

for (const [countryCode, ru, en, iata = [], aliases = []] of CITIES) {
  const country = COUNTRY_BY_CODE.get(countryCode);
  if (!country) throw new Error("Unknown country code in city table: " + countryCode);

  const city = {
    id: cityKey(ru),
    name: ru,
    nameEn: en,
    iata: iata.map(code => String(code).toUpperCase()),
    country
  };

  const keys = [ru, en, ...iata, ...aliases].map(cityKey).filter(Boolean);
  for (const key of keys) {
    const existing = CITY_BY_KEY.get(key);
    if (existing && existing.id !== city.id) {
      throw new Error(
        "Ambiguous city alias \"" + key + "\": " + existing.name + " vs " + city.name
      );
    }
    CITY_BY_KEY.set(key, city);
  }
}

/**
 * Russian case endings, as a last resort when the spelling is not in the table.
 *
 * Channels write routes in running prose - "из Белграда в Астану", "Шанхая ->
 * Алматы", "Алматы -> Шарджу" - and every such form used to be an unresolved
 * city, so the whole route was refused. On one live sync of @charterticketsme
 * that was 142 offers, Serbia, China, Czechia and the UAE among them.
 *
 * Each entry rewrites the END of the key and the result must be an exact hit in
 * the city table, so a transformation can only ever land on a real city, never
 * invent one. `tests/charter-geo.test.mjs` asserts that no transformation maps
 * one catalogued city onto a different one.
 */
const CASE_ENDINGS = [
  [/а$/, ""],   // Белграда -> Белград, Шымкента -> Шымкент, Сеула -> Сеул
  [/я$/, "й"],  // Шанхая -> Шанхай, Дубая -> Дубай
  [/ы$/, "а"],  // Астаны -> Астана, Москвы -> Москва
  [/у$/, "а"],  // Астану -> Астана, Шарджу -> Шарджа, Прагу -> Прага
  [/и$/, "а"],  // Праги -> Прага
  [/е$/, "а"],  // Астане -> Астана, Праге -> Прага, Вене -> Вена
  [/е$/, ""],   // Фукуоке -> Фукуок, Милане -> Милан
  [/ю$/, "я"],  // Анталию -> Анталия
  [/ов$/, ""],  // Афинов -> Афин (rare, but harmless)
  [/ах$/, "ы"]  // Афинах -> Афины
];

/** The table entry for a declined spelling, or null. */
function resolveDeclinedKey(key) {
  for (const [pattern, replacement] of CASE_ENDINGS) {
    if (!pattern.test(key)) continue;
    const candidate = key.replace(pattern, replacement);
    if (candidate === key || candidate.length < 3) continue;
    const city = CITY_BY_KEY.get(candidate);
    if (city) return city;
  }
  return null;
}

/** Resolves a city spelling to its canonical record, or null when unknown. */
export function resolveCity(value) {
  const key = cityKey(value);
  if (!key) return null;
  // The exact spelling always wins; declension stripping only runs on a miss,
  // so a catalogued name can never be rewritten into something else.
  return CITY_BY_KEY.get(key) || resolveDeclinedKey(key) || null;
}

/** Canonical Russian city name used in published route titles. */
export function displayCity(value) {
  return resolveCity(value)?.name || cleanCityText(value);
}

/** Last-resort cleanup for a city we cannot resolve (diagnostics only). */
export function cleanCityText(value) {
  return decodeEntities(value)
    .replace(/^\s*(?:OW|RT)\s+/i, "")
    .replace(/\([^)]*(?:\)|$)/g, " ")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[︎️​-‍⁠﻿]/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:|/\\-]+|[\s,.;:|/\\-]+$/g, "")
    .trim();
}

export function countryByCode(code) {
  return COUNTRY_BY_CODE.get(String(code || "").toUpperCase()) || null;
}

export function isKazakhstanCity(value) {
  return resolveCity(value)?.country.code === "KZ";
}

export const TICKET_CATEGORIES = {
  OUTBOUND: "outbound",
  INBOUND: "inbound",
  ROUND_TRIP: "roundtrip",
  FOREIGN: "foreign",
  DOMESTIC: "domestic",
  UNKNOWN: "unknown"
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function nightsBetween(departureDate, returnDate) {
  if (!ISO_DATE.test(String(departureDate)) || !ISO_DATE.test(String(returnDate))) return null;
  const from = Date.parse(departureDate + "T12:00:00Z");
  const to = Date.parse(returnDate + "T12:00:00Z");
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const diff = Math.round((to - from) / 86400000);
  return diff > 0 ? diff : null;
}

/**
 * Classifies one offer into exactly one publishable category and country.
 *
 * Never guesses: an unresolved city, a same-city route or an "RT" without a
 * real return date is reported as `unknown` with a reason so the offer goes to
 * diagnostics instead of a fabricated country or the wrong section.
 */
export function classifyFlight(flight) {
  const fromCity = resolveCity(flight?.from);
  const toCity = resolveCity(flight?.to);

  if (!fromCity && !toCity) {
    return unknown("UNRESOLVED_ROUTE", { from: flight?.from, to: flight?.to });
  }
  if (!fromCity) return unknown("UNRESOLVED_ORIGIN", { from: flight?.from });
  if (!toCity) return unknown("UNRESOLVED_DESTINATION", { to: flight?.to });
  if (fromCity.id === toCity.id) {
    return unknown("SAME_ORIGIN_AND_DESTINATION", { from: fromCity.name });
  }

  const declaredRoundTrip = String(flight?.trip || "OW").toUpperCase() === "RT";
  const hasReturnDate = Boolean(flight?.returnDate);
  const nights = nightsBetween(flight?.departureDate, flight?.returnDate);

  // A stated return date that does not sit after departure is corrupt data,
  // not a round trip. A round trip whose return date the source never gave is
  // still a round-trip fare: it keeps its category and simply shows no stay
  // length, because inventing a return date is worse than omitting it.
  if (hasReturnDate && !nights) {
    return unknown("INVALID_RETURN_DATE", {
      departureDate: flight?.departureDate || null,
      returnDate: flight?.returnDate || null
    });
  }

  const fromKz = fromCity.country.code === "KZ";
  const toKz = toCity.country.code === "KZ";

  if (fromKz && toKz) {
    return {
      category: TICKET_CATEGORIES.DOMESTIC,
      country: fromCity.country,
      fromCity,
      toCity,
      nights,
      roundTrip: declaredRoundTrip,
      reason: null
    };
  }

  if (declaredRoundTrip) {
    return {
      category: TICKET_CATEGORIES.ROUND_TRIP,
      // A round trip belongs to the foreign country being visited.
      country: fromKz ? toCity.country : fromCity.country,
      fromCity,
      toCity,
      nights,
      roundTrip: true,
      reason: null
    };
  }

  if (fromKz) {
    return {
      category: TICKET_CATEGORIES.OUTBOUND,
      country: toCity.country,
      fromCity,
      toCity,
      nights: null,
      roundTrip: false,
      reason: null
    };
  }

  if (toKz) {
    return {
      category: TICKET_CATEGORIES.INBOUND,
      country: fromCity.country,
      fromCity,
      toCity,
      nights: null,
      roundTrip: false,
      reason: null
    };
  }

  // Third country to third country. Classified, but never publishable: we
  // sell flights between Kazakhstan and the agreed countries only, so a
  // Sharjah -> Tashkent fare carries its refusal reason from here on.
  return {
    category: TICKET_CATEGORIES.FOREIGN,
    country: toCity.country,
    fromCity,
    toCity,
    nights: null,
    roundTrip: false,
    reason: "FOREIGN_TO_FOREIGN_ROUTE"
  };
}

function unknown(reason, details = {}) {
  return {
    category: TICKET_CATEGORIES.UNKNOWN,
    country: null,
    fromCity: null,
    toCity: null,
    nights: null,
    roundTrip: false,
    reason,
    details
  };
}

/**
 * True when the offer can be placed in a country digest.
 *
 * `FOREIGN` is deliberately absent: a flight between two foreign countries
 * (Sharjah -> Tashkent) used to be publishable and rendered under a "МЕЖДУ
 * СТРАНАМИ" section, which is how foreign-to-foreign routes reached the
 * channel. Whether the *country* is allowed is a separate question, answered
 * once in `charter-publication-policy.mjs`.
 */
export function isPublishableCategory(category) {
  return category === TICKET_CATEGORIES.OUTBOUND
    || category === TICKET_CATEGORIES.INBOUND
    || category === TICKET_CATEGORIES.ROUND_TRIP;
}

export { COUNTRIES, CITIES };
