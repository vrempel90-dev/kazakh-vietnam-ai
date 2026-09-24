import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellIcon,
  BookmarkIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
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

type Screen = "flights" | "notifications" | "profile";
type Tab = "all" | "mine";
type Currency = "KZT" | "USD" | "EUR";
type Picker = "city" | "country" | null;
type Trip = "OW" | "RT";

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
  updatedAt?: string;
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

const readList = (key: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as string[];
  } catch {
    return [];
  }
};

export default function Prototype() {
  const [screen, setScreen] = useState<Screen>("flights");
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

  useEffect(() => localStorage.setItem("charter-favorites", JSON.stringify(favorites)), [favorites]);
  useEffect(() => localStorage.setItem("charter-route-alerts", JSON.stringify(alerts)), [alerts]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const departureCities = useMemo(
    () => ["Все", ...Array.from(new Set(flights.map(flight => flight.from))).sort((a, b) => a.localeCompare(b, "ru"))],
    [flights],
  );

  const availableCountries = useMemo(() => {
    const names = new Set(flights.map(flight => countryFor(flight.to).name));
    const dynamic = knownCountries.filter(item => names.has(item.name));
    if (names.has("Другое")) dynamic.push({ name: "Другое", flag: "🌍" });
    return [{ name: "Все", flag: "✓" }, ...dynamic];
  }, [flights]);

  const filtered = useMemo(() => {
    const mine = new Set(favorites);
    return flights
      .filter(flight => tab === "all" || mine.has(flight.id))
      .filter(flight => city === "Все" || flight.from === city)
      .filter(flight => country === "Все" || countryFor(flight.to).name === country)
      .sort((a, b) => a.offset - b.offset || a.price - b.price);
  }, [flights, favorites, tab, city, country]);

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

  const managerMessage = (flight: Flight) =>
    [
      "Здравствуйте! Хочу оформить чартерный билет.",
      "",
      "Маршрут: " + flight.from + " → " + flight.to,
      "Дата: " + flightDate(flight),
      "Тип: " + (flight.trip === "OW" ? "в одну сторону" : "туда и обратно"),
      "Авиакомпания: " + (flight.airline || "уточняется"),
      "Цена: " + new Intl.NumberFormat("ru-RU").format(flight.price) + " ₸",
    ].join("\n");

  const openManager = (flight: Flight) => {
    const phone = String(import.meta.env.VITE_MANAGER_WHATSAPP || "").replace(/\D/g, "");
    if (!phone) {
      setToast("Добавьте VITE_MANAGER_WHATSAPP для перехода к менеджеру");
      return;
    }
    window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(managerMessage(flight)), "_blank", "noopener,noreferrer");
  };

  const shareFlight = async (flight: Flight) => {
    const text = managerMessage(flight).replace("Здравствуйте! Хочу оформить чартерный билет.\n\n", "");
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
      <button className="deal-card" onClick={() => setSelected(flight)}>
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
      </button>
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
              <div><strong>{flights.length}</strong><span>рейсов</span></div>
            </div>
            <button className="profile-action" onClick={() => setScreen("flights")}><HomeIcon /><span>Вернуться к рейсам</span></button>
            <button className="profile-action" onClick={() => { setFavorites([]); setAlerts([]); setToast("Сохранённые данные очищены"); }}><Cross2Icon /><span>Очистить сохранённое</span></button>
          </main>
        )}
      </MobileScroll>

      <nav className="bottom-nav">
        <button className={screen === "flights" ? "active" : ""} onClick={() => setScreen("flights")}><MixerHorizontalIcon /><span>Рейсы</span></button>
        <button onClick={() => { setScreen("flights"); setTab("mine"); }} className={screen === "flights" && tab === "mine" ? "active" : ""}><BookmarkIcon /><span>Избранное</span></button>
        <button className={screen === "notifications" ? "active" : ""} onClick={() => setScreen("notifications")}><BellIcon /><span>Уведомления</span></button>
        <button className={screen === "profile" ? "active" : ""} onClick={() => setScreen("profile")}><PersonIcon /><span>Профиль</span></button>
      </nav>

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
              <div><span>Обновлено</span><strong>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "при последней синхронизации"}</strong></div>
            </div>
            <button className="manager-btn" onClick={() => openManager(selected)}><PaperPlaneIcon /> Написать менеджеру</button>
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
