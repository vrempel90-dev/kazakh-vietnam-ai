import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellIcon,
  BookmarkIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Cross2Icon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
  PaperPlaneIcon,
  PersonIcon,
  SewingPinIcon,
  Share1Icon,
} from "@radix-ui/react-icons";
import { MobileScroll } from "./mobile";
import "./prototype.css";

type Screen = "flights" | "notifications" | "profile" | "admin";
type Tab = "all" | "mine";
type Currency = "KZT" | "USD" | "EUR";
type Picker = "city" | "country" | null;
type Trip = "OW" | "RT";

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  initDataUnsafe?: {
    user?: {
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type Flight = {
  id: string;
  from: string;
  to: string;
  offset: number;
  price: number;
  trip: Trip;
  hot: boolean;
  seats: string;
  airline?: string;
  departureDate?: string;
  returnDate?: string;
  publishedAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

type FlightFeed = {
  generatedAt?: string;
  mode?: string;
  rates?: {
    USD_KZT?: number;
    EUR_KZT?: number;
    updatedAt?: string;
  };
  flights?: Flight[];
};

type Country = {
  name: string;
  flag: string;
};

type PricingCalculationType = "fixed_kzt" | "percent" | "sale_price_kzt";
type PricingScope = {
  offerId?: string;
  sourceId?: string;
  from?: string;
  to?: string;
  trip?: Trip;
};
type PricingRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  scope: PricingScope;
  calculation: { type: PricingCalculationType; value: number };
};
type PricingConfig = {
  version: number;
  updatedAt: string | null;
  rules: PricingRule[];
};
type ScopeMode = "global" | "trip" | "route" | "route_trip" | "source" | "source_trip" | "offer";

const fallbackFlights: Flight[] = [
  { id: "nqz-dad", from: "Астана", to: "Дананг", offset: 3, price: 77000, trip: "OW", hot: true, seats: "Наличие уточняется", airline: "VietJet" },
  { id: "nqz-cxr", from: "Астана", to: "Нячанг", offset: 8, price: 77000, trip: "OW", hot: false, seats: "Наличие уточняется", airline: "VietJet" },
  { id: "ala-cxr", from: "Алматы", to: "Камрань", offset: 13, price: 100000, trip: "OW", hot: false, seats: "Наличие уточняется", airline: "SCAT" },
  { id: "nqz-ssh", from: "Астана", to: "Шарм-эш-Шейх", offset: 18, price: 218000, trip: "RT", hot: false, seats: "Наличие уточняется", airline: "Air Cairo" },
];

const cityCountries: Array<[RegExp, Country]> = [
  [/дананг|да нанг|нячанг|камран|фукуок|хо ши мин|хошимин|ханой/i, { name: "Вьетнам", flag: "🇻🇳" }],
  [/шарм|хургада|каир/i, { name: "Египет", flag: "🇪🇬" }],
  [/антал|стамбул|бодрум/i, { name: "Турция", flag: "🇹🇷" }],
  [/дубай|абу-даби|шардж/i, { name: "ОАЭ", flag: "🇦🇪" }],
  [/бангкок|пхукет|паттай/i, { name: "Таиланд", flag: "🇹🇭" }],
  [/мале|мальдив/i, { name: "Мальдивы", flag: "🇲🇻" }],
  [/санья|пекин|шанхай|гуанчжоу/i, { name: "Китай", flag: "🇨🇳" }],
  [/гоа|дели|мумбаи/i, { name: "Индия", flag: "🇮🇳" }],
  [/рим|милан/i, { name: "Италия", flag: "🇮🇹" }],
  [/ташкент|самарканд/i, { name: "Узбекистан", flag: "🇺🇿" }],
];

const knownCountries: Country[] = [
  { name: "Вьетнам", flag: "🇻🇳" },
  { name: "Египет", flag: "🇪🇬" },
  { name: "Индия", flag: "🇮🇳" },
  { name: "Италия", flag: "🇮🇹" },
  { name: "Китай", flag: "🇨🇳" },
  { name: "ОАЭ", flag: "🇦🇪" },
  { name: "Таиланд", flag: "🇹🇭" },
  { name: "Турция", flag: "🇹🇷" },
  { name: "Узбекистан", flag: "🇺🇿" },
  { name: "Мальдивы", flag: "🇲🇻" },
];

const countryFor = (destination: string): Country =>
  cityCountries.find(([pattern]) => pattern.test(destination))?.[1] || { name: "Другое", flag: "🌍" };

const DEFAULT_MANAGER_WHATSAPP = "77007772414";
const MANAGER_PHONE_DISPLAY = "+7 700 777 24 14";

const PRICING_SOURCES = [
  ["neos", "NEOS"],
  ["fun_sun", "FUN&SUN"],
  ["kazunion", "KAZUNION"],
  ["kompas", "KOMPAS"],
  ["anex", "ANEX"],
  ["selfie", "SELFIE"],
  ["joinup", "JOINUP"],
  ["pegas", "PEGAS"],
  ["crystal_bay", "Crystal Bay"],
  ["abk", "ABK Tourism"],
  ["space", "SPACE / Travel Luxe"],
  ["vietra", "VIETRA"],
  ["sanat", "SANAT"],
] as const;

const scopeMode = (scope: PricingScope): ScopeMode => {
  if (scope.offerId) return "offer";
  if (scope.from && scope.to && scope.trip) return "route_trip";
  if (scope.from && scope.to) return "route";
  if (scope.sourceId && scope.trip) return "source_trip";
  if (scope.sourceId) return "source";
  if (scope.trip) return "trip";
  return "global";
};

const scopeLabel = (scope: PricingScope) => {
  const mode = scopeMode(scope);
  if (mode === "offer") return "Конкретный рейс";
  if (mode === "route_trip") return `${scope.from} → ${scope.to} · ${scope.trip}`;
  if (mode === "route") return `${scope.from} → ${scope.to}`;
  if (mode === "source_trip") return `${scope.sourceId} · ${scope.trip}`;
  if (mode === "source") return scope.sourceId || "Поставщик";
  if (mode === "trip") return scope.trip === "RT" ? "Все RT" : "Все OW";
  return "Общее правило";
};

const calculationLabel = (rule: PricingRule) => {
  if (rule.calculation.type === "percent") return "+" + rule.calculation.value + "%";
  if (rule.calculation.type === "sale_price_kzt") return "Продажа " + new Intl.NumberFormat("ru-RU").format(rule.calculation.value) + " ₸";
  return "+" + new Intl.NumberFormat("ru-RU").format(rule.calculation.value) + " ₸";
};

const isoAt = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};

const flightIso = (flight: Flight) => flight.departureDate || isoAt(flight.offset);

const flightDate = (flight: Flight) => {
  const date = new Date(flightIso(flight) + "T12:00:00");
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
};

const daysUntil = (flight: Flight) => {
  const target = new Date(flightIso(flight) + "T12:00:00");
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000));
};

const offerPublishedAt = (flight: Flight) => flight.publishedAt || flight.updatedAt;

const offerExpiresAt = (flight: Flight) => {
  if (flight.expiresAt) return flight.expiresAt;
  const base = offerPublishedAt(flight);
  if (!base) return undefined;
  const date = new Date(base);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setHours(date.getHours() + 24);
  return date.toISOString();
};

const isOfferActive = (flight: Flight, nowMs: number) => {
  const expiresAt = offerExpiresAt(flight);
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  return Number.isNaN(expiry) || expiry > nowMs;
};

const publishedLabel = (flight: Flight) => {
  const value = offerPublishedAt(flight);
  if (!value) return "при синхронизации";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "при синхронизации";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const expiryLabel = (flight: Flight, nowMs: number) => {
  const value = offerExpiresAt(flight);
  if (!value) return "по актуальности источника";
  const diff = new Date(value).getTime() - nowMs;
  if (!Number.isFinite(diff)) return "по актуальности источника";
  if (diff <= 0) return "истекло";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return "через " + minutes + " мин";
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return "через " + hours + " ч";
  const days = Math.ceil(hours / 24);
  return "через " + days + (days === 1 ? " день" : days < 5 ? " дня" : " дней");
};

const readList = (key: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as string[];
  } catch {
    return [];
  }
};

export default function Prototype() {
  const [screen, setScreen] = useState<Screen>(() => new URLSearchParams(window.location.search).get("admin") === "1" ? "admin" : "flights");
  const [tab, setTab] = useState<Tab>("all");
  const [currency, setCurrency] = useState<Currency>("KZT");
  const [picker, setPicker] = useState<Picker>(null);
  const [city, setCity] = useState("Все");
  const [country, setCountry] = useState("Все");
  const [pickerQuery, setPickerQuery] = useState("");
  const [selected, setSelected] = useState<Flight | null>(null);
  const [flights, setFlights] = useState<Flight[]>(fallbackFlights);
  const [favorites, setFavorites] = useState<string[]>(() => readList("charter-favorites"));
  const [alerts, setAlerts] = useState<string[]>(() => readList("charter-route-alerts"));
  const [feedMode, setFeedMode] = useState<"loading" | "live" | "demo" | "error">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [rates, setRates] = useState<{ USD_KZT?: number; EUR_KZT?: number; updatedAt?: string }>({});
  const [toast, setToast] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [adminCode, setAdminCode] = useState(() => sessionStorage.getItem("charter-admin-code") || "");
  const [adminAuthorized, setAdminAuthorized] = useState(false);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [adminSyncRunning, setAdminSyncRunning] = useState(false);

  const refreshFlights = useCallback(async () => {
    try {
      const response = await fetch("/flights.json?ts=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("Flight feed HTTP " + response.status);
      const payload = await response.json() as FlightFeed;
      const next = Array.isArray(payload.flights)
        ? payload.flights.filter((item): item is Flight => Boolean(item && item.id && item.from && item.to && Number.isFinite(item.price)))
        : [];
      if (!next.length) throw new Error("Flight feed is empty");
      setFlights(next);
      setRates(payload.rates || {});
      setFeedMode(payload.mode === "demo" ? "demo" : "live");
      const generated = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
      setLastUpdated(Number.isNaN(generated.getTime()) ? new Date() : generated);
    } catch {
      setFeedMode(current => current === "live" ? "error" : "demo");
    }
  }, []);

  useEffect(() => {
    void refreshFlights();
    const timer = window.setInterval(() => void refreshFlights(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshFlights]);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    webApp.ready?.();
    webApp.expand?.();
    webApp.setHeaderColor?.("#1372d4");
    webApp.setBackgroundColor?.("#eef5fb");
    webApp.disableVerticalSwipes?.();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selected && !isOfferActive(selected, nowTick)) {
      setSelected(null);
      setToast("Предложение уже ушло из ленты");
    }
  }, [selected, nowTick]);

  useEffect(() => localStorage.setItem("charter-favorites", JSON.stringify(favorites)), [favorites]);
  useEffect(() => localStorage.setItem("charter-route-alerts", JSON.stringify(alerts)), [alerts]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const adminRequest = useCallback(async (path: string, options: RequestInit = {}, code = adminCode) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + code,
        ...(options.headers || {})
      }
    });
    if (response.status === 401) throw new Error("Неверный код администратора");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || "Ошибка сервера");
    }
    return response.json();
  }, [adminCode]);

  const loadPricing = useCallback(async (code = adminCode) => {
    if (!code) return;
    setPricingLoading(true);
    try {
      const payload = await adminRequest("/api/admin/pricing", {}, code) as { config: PricingConfig; sync?: { running?: boolean } };
      setPricingConfig(payload.config);
      setAdminAuthorized(true);
      setAdminSyncRunning(Boolean(payload.sync?.running));
      sessionStorage.setItem("charter-admin-code", code);
    } catch (error) {
      setAdminAuthorized(false);
      setPricingConfig(null);
      sessionStorage.removeItem("charter-admin-code");
      setToast(error instanceof Error ? error.message : "Не удалось открыть панель");
    } finally {
      setPricingLoading(false);
    }
  }, [adminCode, adminRequest]);

  useEffect(() => {
    if (screen === "admin" && adminCode && !adminAuthorized && !pricingLoading) void loadPricing(adminCode);
  }, [screen, adminCode, adminAuthorized, pricingLoading, loadPricing]);

  const savePricing = async () => {
    if (!pricingConfig) return;
    setPricingSaving(true);
    try {
      const payload = await adminRequest("/api/admin/pricing", {
        method: "PUT",
        body: JSON.stringify({ config: pricingConfig })
      }) as { config: PricingConfig; syncStarted?: boolean };
      setPricingConfig(payload.config);
      setAdminSyncRunning(Boolean(payload.syncStarted));
      setToast("Наценки сохранены. Пересчёт рейсов запущен.");
      window.setTimeout(() => { void refreshFlights(); setAdminSyncRunning(false); }, 8000);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось сохранить наценки");
    } finally {
      setPricingSaving(false);
    }
  };

  const runAdminSync = async () => {
    try {
      const payload = await adminRequest("/api/admin/sync", { method: "POST", body: "{}" }) as { syncStarted?: boolean };
      setAdminSyncRunning(Boolean(payload.syncStarted));
      setToast(payload.syncStarted ? "Пересчёт рейсов запущен" : "Синхронизация уже выполняется");
      window.setTimeout(() => { void refreshFlights(); setAdminSyncRunning(false); }, 8000);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось запустить синхронизацию");
    }
  };

  const updateRule = (id: string, patch: (rule: PricingRule) => PricingRule) => {
    setPricingConfig(current => current ? { ...current, rules: current.rules.map(rule => rule.id === id ? patch(rule) : rule) } : current);
  };

  const addPricingRule = () => {
    const id = "rule-" + Date.now();
    setPricingConfig(current => current ? {
      ...current,
      rules: [...current.rules, {
        id,
        name: "Новое правило",
        enabled: true,
        priority: 0,
        scope: { trip: "OW" },
        calculation: { type: "fixed_kzt", value: 10000 }
      }]
    } : current);
  };

  const setRuleScopeMode = (rule: PricingRule, mode: ScopeMode): PricingRule => {
    const current = rule.scope;
    const defaultSource = current.sourceId || "neos";
    if (mode === "global") return { ...rule, scope: {} };
    if (mode === "trip") return { ...rule, scope: { trip: current.trip || "OW" } };
    if (mode === "route") return { ...rule, scope: { from: current.from || "Алматы", to: current.to || "Нячанг" } };
    if (mode === "route_trip") return { ...rule, scope: { from: current.from || "Алматы", to: current.to || "Нячанг", trip: current.trip || "OW" } };
    if (mode === "source") return { ...rule, scope: { sourceId: defaultSource } };
    if (mode === "source_trip") return { ...rule, scope: { sourceId: defaultSource, trip: current.trip || "OW" } };
    return { ...rule, scope: { offerId: current.offerId || "" } };
  };

  const activeFlights = useMemo(
    () => flights.filter(flight => isOfferActive(flight, nowTick)),
    [flights, nowTick],
  );

  const departureCities = useMemo(
    () => ["Все", ...Array.from(new Set(activeFlights.map(flight => flight.from))).sort((a, b) => a.localeCompare(b, "ru"))],
    [activeFlights],
  );

  const availableCountries = useMemo(() => {
    const names = new Set(activeFlights.map(flight => countryFor(flight.to).name));
    const dynamic = knownCountries.filter(item => names.has(item.name));
    if (names.has("Другое")) dynamic.push({ name: "Другое", flag: "🌍" });
    return [{ name: "Все", flag: "✓" }, ...dynamic];
  }, [activeFlights]);

  const filtered = useMemo(() => {
    const mine = new Set(favorites);
    return activeFlights
      .filter(flight => tab === "all" || mine.has(flight.id))
      .filter(flight => city === "Все" || flight.from === city)
      .filter(flight => country === "Все" || countryFor(flight.to).name === country)
      .sort((a, b) => a.offset - b.offset || a.price - b.price);
  }, [activeFlights, favorites, tab, city, country]);

  const currencyAvailable = (value: Currency) =>
    value === "KZT" || (value === "USD" && Boolean(rates.USD_KZT)) || (value === "EUR" && Boolean(rates.EUR_KZT));

  const displayPrice = (priceKzt: number) => {
    if (currency === "USD" && rates.USD_KZT) return "$" + Math.round(priceKzt / rates.USD_KZT).toLocaleString("en-US");
    if (currency === "EUR" && rates.EUR_KZT) return "€" + Math.round(priceKzt / rates.EUR_KZT).toLocaleString("en-US");
    return new Intl.NumberFormat("ru-RU").format(priceKzt) + " ₸";
  };

  const toggleFavorite = (id: string) =>
    setFavorites(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);

  const routeKey = (flight: Flight) => flight.from + "→" + flight.to;

  const toggleAlert = (flight: Flight) => {
    const key = routeKey(flight);
    if (alerts.includes(key)) {
      setAlerts(current => current.filter(item => item !== key));
      setToast("Уведомление отключено");
    } else {
      setAlerts(current => [...current, key]);
      setToast("Будем следить за направлением");
    }
  };

  const managerMessage = (flight: Flight) => {
    const airline = flight.airline ? ", " + flight.airline : "";
    const returnDate = flight.trip === "RT" && flight.returnDate
      ? " — " + new Date(flight.returnDate + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
      : "";
    return "Здравствуйте! Интересует рейс " + flight.from + " → " + flight.to
      + ", вылет " + new Date(flightIso(flight) + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
      + returnDate + airline + ". Места ещё есть?";
  };

  const openManager = (flight: Flight) => {
    const phone = String(import.meta.env.VITE_MANAGER_WHATSAPP || DEFAULT_MANAGER_WHATSAPP).replace(/\D/g, "");
    window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(managerMessage(flight)), "_blank", "noopener,noreferrer");
  };

  const shareFlight = async (flight: Flight) => {
    const text = managerMessage(flight);
    try {
      if (navigator.share) await navigator.share({ title: "Чартерные авиабилеты", text });
      else {
        await navigator.clipboard.writeText(text);
        setToast("Предложение скопировано");
      }
    } catch {
      // User cancelled share.
    }
  };

  const urgency = (flight: Flight) => {
    const days = daysUntil(flight);
    if (days === 0) return "сегодня";
    if (days === 1) return "завтра";
    if (days <= 5) return "через " + days + " дня";
    return "через " + days + " дней";
  };

  const pickerItems = picker === "city"
    ? departureCities.filter(item => item.toLocaleLowerCase("ru").includes(pickerQuery.toLocaleLowerCase("ru")))
    : availableCountries.filter(item => item.name.toLocaleLowerCase("ru").includes(pickerQuery.toLocaleLowerCase("ru")));

  const selectPickerItem = (value: string) => {
    if (picker === "city") setCity(value);
    if (picker === "country") setCountry(value);
    setPicker(null);
    setPickerQuery("");
  };

  const FlightCard = ({ flight }: { flight: Flight }) => {
    const destination = countryFor(flight.to);
    return (
      <article
        className="deal-card"
        role="button"
        tabIndex={0}
        onClick={() => setSelected(flight)}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setSelected(flight); }}
      >
        <div className="deal-main">
          <span className="country-flag" aria-hidden="true">{destination.flag}</span>
          <div className="deal-copy">
            <strong>{flight.from} → {flight.to}</strong>
            <small>{destination.name}</small>
            <span><CalendarIcon /> {flightDate(flight)}</span>
            <span><PaperPlaneIcon /> {flight.trip === "OW" ? "В одну сторону" : "Туда и обратно"}</span>
          </div>
          <button
            type="button"
            className={"favorite" + (favorites.includes(flight.id) ? " active" : "")}
            aria-label={favorites.includes(flight.id) ? "Убрать из избранного" : "В избранное"}
            onClick={event => {
              event.stopPropagation();
              toggleFavorite(flight.id);
            }}
          >
            <HeartIcon />
          </button>
        </div>
        <div className="deal-bottom">
          <span className={"urgency" + (flight.hot ? " hot" : "")}>{urgency(flight)}</span>
          <span className="price"><strong>{displayPrice(flight.price)}</strong><small>на человека</small></span>
        </div>
      </article>
    );
  };

  return (
    <div className="community-app charter-app">
      <header className="charter-header">
        <div className="brand-logo"><PaperPlaneIcon /></div>
        <div className="brand-title">
          <strong>Чартерные авиабилеты</strong>
          <small>{feedMode === "live" ? "актуальные предложения" : "поиск лучших рейсов"}</small>
        </div>
        <button className="header-profile" aria-label="Профиль" onClick={() => setScreen("profile")}><PersonIcon /></button>
      </header>

      <MobileScroll key={screen} className="charter-scroll">
        {screen === "flights" && (
          <main className="charter-page">
            <div className="top-tabs" role="tablist">
              <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>Все вылеты</button>
              <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}><HeartIcon /> Мои направления</button>
            </div>

            <div className="toolbar">
              <button className={city !== "Все" ? "filter active" : "filter"} onClick={() => setPicker("city")}>
                <PaperPlaneIcon /><span>{city === "Все" ? "Город вылета" : city}</span><ChevronDownIcon />
              </button>
              <button className={country !== "Все" ? "filter active" : "filter"} onClick={() => setPicker("country")}>
                <GlobeIcon /><span>{country === "Все" ? "Страна" : country}</span><ChevronDownIcon />
              </button>
              <div className="currency-switch" aria-label="Валюта">
                {(["KZT", "USD", "EUR"] as Currency[]).map(value => (
                  <button
                    key={value}
                    disabled={!currencyAvailable(value)}
                    className={currency === value ? "active" : ""}
                    onClick={() => setCurrency(value)}
                    aria-label={value}
                  >
                    {value === "KZT" ? "₸" : value === "USD" ? "$" : "€"}
                  </button>
                ))}
              </div>
            </div>

            <div className="sync-line">
              <span className={"live-dot " + feedMode} />
              <span>{feedMode === "live" ? "Рейсы обновляются автоматически" : "Резервные данные"}</span>
              {lastUpdated && <small>{lastUpdated.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small>}
            </div>

            {filtered.length ? (
              <div className="deal-list">{filtered.map(flight => <FlightCard key={flight.id} flight={flight} />)}</div>
            ) : (
              <section className="empty-state">
                <MagnifyingGlassIcon />
                <strong>{tab === "mine" ? "Нет сохранённых направлений" : "Рейсы не найдены"}</strong>
                <p>{tab === "mine" ? "Добавьте понравившийся рейс в избранное." : "Измените город вылета или страну."}</p>
                <button onClick={() => { setCity("Все"); setCountry("Все"); setTab("all"); }}>Показать все рейсы</button>
              </section>
            )}

            {currency !== "KZT" && (
              <p className="rate-note">
                <GlobeIcon /> Цена пересчитана из тенге по курсу источника синхронизации
                {rates.updatedAt ? " от " + new Date(rates.updatedAt).toLocaleDateString("ru-RU") : ""}.
              </p>
            )}
          </main>
        )}

        {screen === "notifications" && (
          <main className="charter-page">
            <section className="screen-heading">
              <span className="heading-icon"><BellIcon /></span>
              <div><strong>Уведомления</strong><p>Следим за выбранными направлениями и новыми рейсами.</p></div>
            </section>
            {alerts.length ? alerts.map(item => {
              const [from, to] = item.split("→");
              return <div className="alert-row" key={item}><BellIcon /><div><strong>{from} → {to}</strong><small>Новые предложения по направлению</small></div><button onClick={() => setAlerts(current => current.filter(value => value !== item))}>×</button></div>;
            }) : <section className="empty-state"><BellIcon /><strong>Уведомлений пока нет</strong><p>Откройте рейс и включите слежение за направлением.</p><button onClick={() => setScreen("flights")}>Выбрать рейс</button></section>}
          </main>
        )}

        {screen === "profile" && (
          <main className="charter-page">
            <section className="profile-card">
              <div className="profile-avatar"><PersonIcon /></div>
              <div><small>ПРОФИЛЬ</small><strong>Путешественник</strong><p>Избранное и настройки поиска</p></div>
            </section>
            <div className="profile-stats">
              <div><strong>{favorites.length}</strong><span>избранных</span></div>
              <div><strong>{alerts.length}</strong><span>уведомлений</span></div>
              <div><strong>{activeFlights.length}</strong><span>рейсов</span></div>
            </div>
            <button className="profile-action" onClick={() => setScreen("flights")}><HomeIcon /><span>Вернуться к рейсам</span></button>
            <button className="profile-action" onClick={() => { setFavorites([]); setAlerts([]); setToast("Сохранённые данные очищены"); }}><Cross2Icon /><span>Очистить сохранённое</span></button>
            <a className="agency-link" href="?admin=1">Для агентства · управление наценками</a>
          </main>
        )}

        {screen === "admin" && (
          <main className="charter-page admin-page">
            {!adminAuthorized ? (
              <section className="admin-login">
                <span className="heading-icon"><MixerHorizontalIcon /></span>
                <h2>Панель агентства</h2>
                <p>Управление автоматическими наценками. Доступ защищён кодом администратора.</p>
                <label>Код администратора<input type="password" value={adminCode} onChange={event => setAdminCode(event.target.value)} placeholder="Введите код" /></label>
                <button disabled={!adminCode || pricingLoading} onClick={() => void loadPricing(adminCode)}>{pricingLoading ? "Проверяю…" : "Войти"}</button>
                <a href="./">Вернуться к рейсам</a>
              </section>
            ) : (
              <>
                <section className="admin-heading">
                  <div><small>ПАНЕЛЬ АГЕНТСТВА</small><h2>Наценки</h2><p>Правила применяются к себестоимости автоматически при каждой синхронизации.</p></div>
                  <button onClick={() => { setAdminAuthorized(false); setAdminCode(""); setPricingConfig(null); sessionStorage.removeItem("charter-admin-code"); }}>Выйти</button>
                </section>

                <section className="pricing-priority">
                  <strong>Приоритет правил</strong>
                  <p>Конкретный рейс → направление + OW/RT → направление → поставщик + OW/RT → поставщик → OW/RT → общее правило.</p>
                </section>

                <div className="admin-toolbar">
                  <button className="secondary" onClick={addPricingRule}>+ Добавить правило</button>
                  <button className="secondary" disabled={adminSyncRunning} onClick={() => void runAdminSync()}>{adminSyncRunning ? "Пересчитываю…" : "Пересчитать сейчас"}</button>
                </div>

                <div className="pricing-rules">
                  {pricingConfig?.rules.map(rule => {
                    const mode = scopeMode(rule.scope);
                    return (
                      <article className={"pricing-rule" + (rule.enabled ? " enabled" : "")} key={rule.id}>
                        <div className="rule-top">
                          <label className="rule-toggle"><input type="checkbox" checked={rule.enabled} onChange={event => updateRule(rule.id, current => ({ ...current, enabled: event.target.checked }))} /><span /></label>
                          <div><input className="rule-name" value={rule.name} onChange={event => updateRule(rule.id, current => ({ ...current, name: event.target.value }))} /><small>{scopeLabel(rule.scope)} · {calculationLabel(rule)}</small></div>
                          <button className="rule-delete" onClick={() => setPricingConfig(current => current ? { ...current, rules: current.rules.filter(item => item.id !== rule.id) } : current)}>×</button>
                        </div>

                        <div className="rule-fields">
                          <label>Уровень
                            <select value={mode} onChange={event => updateRule(rule.id, current => setRuleScopeMode(current, event.target.value as ScopeMode))}>
                              <option value="global">Общее правило</option>
                              <option value="trip">OW / RT</option>
                              <option value="route">Направление</option>
                              <option value="route_trip">Направление + OW / RT</option>
                              <option value="source">Поставщик</option>
                              <option value="source_trip">Поставщик + OW / RT</option>
                              <option value="offer">Конкретный рейс</option>
                            </select>
                          </label>

                          {(mode === "trip" || mode === "route_trip" || mode === "source_trip") && (
                            <label>Тип
                              <select value={rule.scope.trip || "OW"} onChange={event => updateRule(rule.id, current => ({ ...current, scope: { ...current.scope, trip: event.target.value as Trip } }))}>
                                <option value="OW">OW · в одну сторону</option>
                                <option value="RT">RT · туда-обратно</option>
                              </select>
                            </label>
                          )}

                          {(mode === "route" || mode === "route_trip") && (
                            <>
                              <label>Откуда<input value={rule.scope.from || ""} onChange={event => updateRule(rule.id, current => ({ ...current, scope: { ...current.scope, from: event.target.value } }))} placeholder="Алматы" /></label>
                              <label>Куда<input value={rule.scope.to || ""} onChange={event => updateRule(rule.id, current => ({ ...current, scope: { ...current.scope, to: event.target.value } }))} placeholder="Нячанг" /></label>
                            </>
                          )}

                          {(mode === "source" || mode === "source_trip") && (
                            <label>Поставщик
                              <select value={rule.scope.sourceId || "neos"} onChange={event => updateRule(rule.id, current => ({ ...current, scope: { ...current.scope, sourceId: event.target.value } }))}>
                                {PRICING_SOURCES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                              </select>
                            </label>
                          )}

                          {mode === "offer" && (
                            <label>ID рейса<input value={rule.scope.offerId || ""} onChange={event => updateRule(rule.id, current => ({ ...current, scope: { offerId: event.target.value } }))} placeholder="offer id" /></label>
                          )}

                          <label>Формула
                            <select value={rule.calculation.type} onChange={event => updateRule(rule.id, current => ({ ...current, calculation: { ...current.calculation, type: event.target.value as PricingCalculationType } }))}>
                              <option value="fixed_kzt">Добавить сумму ₸</option>
                              <option value="percent">Добавить %</option>
                              <option value="sale_price_kzt">Фиксированная цена продажи</option>
                            </select>
                          </label>

                          <label>{rule.calculation.type === "percent" ? "Процент" : "Сумма, ₸"}
                            <input type="number" min="0" step={rule.calculation.type === "percent" ? "0.1" : "1000"} value={rule.calculation.value} onChange={event => updateRule(rule.id, current => ({ ...current, calculation: { ...current.calculation, value: Number(event.target.value) || 0 } }))} />
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="admin-savebar">
                  <div><strong>{pricingConfig?.rules.filter(rule => rule.enabled).length || 0}</strong><span>активных правил</span></div>
                  <button disabled={pricingSaving} onClick={() => void savePricing()}>{pricingSaving ? "Сохраняю…" : "Сохранить и пересчитать"}</button>
                </div>
              </>
            )}
          </main>
        )}
      </MobileScroll>

      {screen !== "admin" && <nav className="bottom-nav">
        <button className={screen === "flights" ? "active" : ""} onClick={() => setScreen("flights")}><MixerHorizontalIcon /><span>Рейсы</span></button>
        <button onClick={() => { setScreen("flights"); setTab("mine"); }} className={screen === "flights" && tab === "mine" ? "active" : ""}><BookmarkIcon /><span>Избранное</span></button>
        <button className={screen === "notifications" ? "active" : ""} onClick={() => setScreen("notifications")}><BellIcon /><span>Уведомления</span></button>
        <button className={screen === "profile" ? "active" : ""} onClick={() => setScreen("profile")}><PersonIcon /><span>Профиль</span></button>
      </nav>}

      {picker && (
        <div className="picker-backdrop" onClick={() => setPicker(null)}>
          <section className="picker-sheet" onClick={event => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="picker-title"><strong>{picker === "city" ? "Город вылета" : "Страна назначения"}</strong><button aria-label="Закрыть" onClick={() => setPicker(null)}><Cross2Icon /></button></div>
            <div className="picker-search"><MagnifyingGlassIcon /><input value={pickerQuery} onChange={event => setPickerQuery(event.target.value)} placeholder={picker === "city" ? "Поиск города..." : "Поиск страны..."} /></div>
            <div className="picker-list">
              {pickerItems.map(item => {
                const value = typeof item === "string" ? item : item.name;
                const flag = typeof item === "string" ? (value === "Все" ? "✓" : "✈️") : item.flag;
                const current = picker === "city" ? city === value : country === value;
                return <button key={value} onClick={() => selectPickerItem(value)}><span>{flag}</span><strong>{value}</strong>{current && <CheckIcon />}</button>;
              })}
            </div>
          </section>
        </div>
      )}

      {selected && (
        <div className="detail-backdrop" onClick={() => setSelected(null)}>
          <section className="detail-sheet" onClick={event => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="detail-head">
              <div><small>{countryFor(selected.to).flag} {countryFor(selected.to).name}</small><h2>{selected.from} → {selected.to}</h2></div>
              <button className="favorite large" aria-label="В избранное" onClick={() => toggleFavorite(selected.id)}><HeartIcon /></button>
            </div>
            <div className="detail-grid">
              <div><span>Дата вылета</span><strong>{flightDate(selected)}, {urgency(selected)}</strong></div>
              <div><span>Тип рейса</span><strong>{selected.trip === "OW" ? "В одну сторону" : "Туда и обратно"}</strong></div>
              <div><span>Авиакомпания</span><strong>{selected.airline || "Уточняется"}</strong></div>
              <div><span>Багаж / места</span><strong>{selected.seats || "Уточняется"}</strong></div>
              <div className="price-row"><span>Цена</span><strong>{displayPrice(selected.price)}<small> на человека</small></strong></div>
              <div><span>Опубликовано</span><strong>{publishedLabel(selected)}</strong></div>
              <div className="expiry-row"><span>Уйдёт из ленты</span><strong>{expiryLabel(selected, nowTick)}</strong></div>
            </div>
            <button className="manager-btn" onClick={() => openManager(selected)}>
              <span className="manager-brand"><PaperPlaneIcon /></span>
              <span className="manager-copy"><strong>Написать в WhatsApp</strong><small>{MANAGER_PHONE_DISPLAY} · менеджер компании</small></span>
              <ChevronRightIcon />
            </button>
            <div className="detail-actions">
              <button onClick={() => toggleAlert(selected)}><BellIcon />{alerts.includes(routeKey(selected)) ? "Убрать уведомление" : "Следить за направлением"}</button>
              <button onClick={() => void shareFlight(selected)}><Share1Icon /> Поделиться</button>
            </div>
            <p className="revalidate-note">Перед оформлением менеджер повторно подтвердит цену и наличие.</p>
          </section>
        </div>
      )}

      {toast && <div className="toast"><CheckIcon /> {toast}</div>}
    </div>
  );
}
