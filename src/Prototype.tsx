import { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, BellIcon, BookmarkIcon, CalendarIcon, CheckIcon, ChevronRightIcon, GlobeIcon, HomeIcon, InfoCircledIcon, MagnifyingGlassIcon, MoonIcon, PaperPlaneIcon, PersonIcon, SewingPinIcon, SunIcon } from "@radix-ui/react-icons";
import { KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import "./prototype.css";

type Screen = "home" | "search" | "favorites" | "notifications" | "profile" | "detail";
type Trip = "all" | "RT" | "OW";
type Origin = "all" | "Алматы" | "Астана";
type Flight = { id: string; from: "Алматы" | "Астана"; to: string; offset: number; price: number; trip: Exclude<Trip,"all">; hot: boolean; seats: string };
type Section = { id: string; icon: string; title: string; subtitle: string; tone: string };
const sections: Section[] = [
  { id: "all", icon: "✈️", title: "Все рейсы", subtitle: "Посмотреть актуальные предложения", tone: "blue" },
  { id: "hot", icon: "🔥", title: "Горящие билеты", subtitle: "Лучшие предложения на ближайшие даты", tone: "orange" },
  { id: "rt", icon: "↔️", title: "Туда и обратно", subtitle: "RT — билеты в обе стороны", tone: "purple" },
  { id: "ow", icon: "➡️", title: "В одну сторону", subtitle: "OW — билеты в одну сторону", tone: "cyan" },
  { id: "almaty", icon: "📍", title: "Из Алматы", subtitle: "Актуальные рейсы из Алматы", tone: "green" },
  { id: "astana", icon: "📍", title: "Из Астаны", subtitle: "Актуальные рейсы из Астаны", tone: "teal" },
  { id: "budget", icon: "💰", title: "До 250 000 ₸", subtitle: "Подборка по бюджету", tone: "indigo" },
  { id: "alerts", icon: "🔔", title: "Уведомления", subtitle: "Сообщить, когда появится подходящий билет", tone: "rose" }
];
const flights: Flight[] = [
  { id: "ala-pqc", from: "Алматы", to: "Фукуок", offset: 8, price: 238000, trip: "OW", hot: true, seats: "Прямой рейс" },
  { id: "nqz-bkk", from: "Астана", to: "Бангкок", offset: 12, price: 249000, trip: "OW", hot: true, seats: "Чартер" },
  { id: "ala-nha", from: "Алматы", to: "Нячанг", offset: 17, price: 295000, trip: "RT", hot: false, seats: "Туда и обратно" },
  { id: "nqz-pqc", from: "Астана", to: "Фукуок", offset: 24, price: 319000, trip: "RT", hot: false, seats: "Туда и обратно" },
  { id: "ala-dad", from: "Алматы", to: "Дананг", offset: 29, price: 274000, trip: "OW", hot: false, seats: "Чартер" }
];
const money = (value: number) => new Intl.NumberFormat("ru-RU").format(value) + " ₸";
function dateAt(offset: number) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }
function isoAt(offset: number) { const d = new Date(); d.setDate(d.getDate() + offset); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); }
function readSaved(key: string): string[] { try { return JSON.parse(localStorage.getItem(key) || "[]") as string[]; } catch { return []; } }

export default function Prototype() {
  const keyboard = useKeyboard();
  const [screen, setScreen] = useState<Screen>("home");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<Origin>("all");
  const [trip, setTrip] = useState<Trip>("all");
  const [budget, setBudget] = useState<number | null>(null);
  const [date, setDate] = useState<number | null>(null);
  const [dateExact, setDateExact] = useState("");
  const [hotOnly, setHotOnly] = useState(false);
  const [selected, setSelected] = useState<Flight>(flights[0]);
  const [favorites, setFavorites] = useState<string[]>(() => readSaved("charter-favorites"));
  const [alerts, setAlerts] = useState<string[]>(() => readSaved("charter-alerts"));
  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => { localStorage.setItem("charter-favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("charter-alerts", JSON.stringify(alerts)); }, [alerts]);
  useEffect(() => { const shell = document.querySelector(".device-screen"); if (!shell) return; const reset = () => { if (shell.scrollTop !== 0) shell.scrollTop = 0; }; shell.addEventListener("scroll", reset); reset(); return () => shell.removeEventListener("scroll", reset); }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    let script = document.getElementById("telegram-web-app-sdk") as HTMLScriptElement | null;
    if (!script) { script = document.createElement("script"); script.id = "telegram-web-app-sdk"; script.src = "https://telegram.org/js/telegram-web-app.js"; document.head.appendChild(script); }
    const ready = () => { const app = (window as Window & { Telegram?: { WebApp?: { colorScheme?: string; ready?: () => void; expand?: () => void; onEvent?: (event: string, cb: () => void) => void } } }).Telegram?.WebApp; if (!app) return; app.ready?.(); app.expand?.(); setDark(app.colorScheme === "dark"); app.onEvent?.("themeChanged", () => setDark(app.colorScheme === "dark")); };
    script.addEventListener("load", ready, { once: true }); ready();
  }, []);
  const go = (next: Screen) => { keyboard.hide(); setScreen(next); };
  const resetFilters = () => { setQuery(""); setOrigin("all"); setTrip("all"); setBudget(null); setDate(null); setDateExact(""); setHotOnly(false); };
  const openSection = (id: string) => {
    resetFilters();
    if (id === "alerts") { go("notifications"); return; }
    if (id === "hot") { setHotOnly(true); setDate(14); }
    if (id === "rt") setTrip("RT");
    if (id === "ow") setTrip("OW");
    if (id === "almaty") setOrigin("Алматы");
    if (id === "astana") setOrigin("Астана");
    if (id === "budget") setBudget(250000);
    go("search");
  };
  const results = useMemo(() => flights.filter(f => {
    const matchesQuery = !query.trim() || (f.to + " " + f.from).toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"));
    return matchesQuery && (origin === "all" || f.from === origin) && (trip === "all" || f.trip === trip) && (budget === null || f.price <= budget) && (date === null || f.offset <= date) && (!dateExact || isoAt(f.offset) === dateExact) && (!hotOnly || f.hot);
  }), [query, origin, trip, budget, date, dateExact, hotOnly]);
  const criteria = JSON.stringify({ query: query.trim(), origin, trip, budget, date, dateExact, hotOnly });
  const favoriteFlights = flights.filter(f => favorites.includes(f.id));
  const toggleFavorite = (id: string) => { keyboard.hide(); setFavorites(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]); };
  const toggleAlert = () => { if (alerts.includes(criteria)) { setAlerts(a => a.filter(x => x !== criteria)); setToast("Уведомление отключено"); } else { setAlerts(a => [...a, criteria]); setToast("Уведомление сохранено в деморежиме"); } };
  const openFlight = (flight: Flight) => { setSelected(flight); go("detail"); };
  const flightCard = (f: Flight) => <article className="flight-card" key={f.id}>
    <div className="flight-card-top"><span className="flight-route"><SewingPinIcon /> {f.from} <span>→</span> {f.to}</span>{f.hot && <span className="hot-badge">🔥 Горящий</span>}</div>
    <div className="flight-facts"><span><CalendarIcon /> {dateAt(f.offset)}</span><span>{f.trip === "RT" ? "↔️ RT" : "➡️ OW"}</span><span>{f.seats}</span></div>
    <div className="flight-card-bottom"><div><small>ДЕМО-ЦЕНА ОТ</small><strong>{money(f.price)}</strong></div><button className="save-flight" aria-label={favorites.includes(f.id) ? "Убрать из избранного" : "В избранное"} onClick={() => toggleFavorite(f.id)}><BookmarkIcon fill={favorites.includes(f.id) ? "currentColor" : "none"} /></button><button className="flight-open" onClick={() => openFlight(f)}>Подробнее <ChevronRightIcon /></button></div>
  </article>;
   return <div className={"community-app charter-app" + (dark ? " dark" : "")}>
    <header className="topbar"><div className="top-row">{screen === "detail" ? <button className="top-action" aria-label="Назад" onClick={() => go("search")}><ArrowLeftIcon /></button> : <span className="brand"><PaperPlaneIcon width={22} height={22} /></span>}<div className="brand-text"><small>ПОИСК ЧАРТЕРНЫХ РЕЙСОВ</small><strong>Чартерные авиабилеты</strong></div><button className="top-action" aria-label={screen === "home" ? "Профиль" : "Главная"} onClick={() => go(screen === "home" ? "profile" : "home")}>{screen === "home" ? <PersonIcon /> : <HomeIcon />}</button></div></header>
    <MobileScroll key={screen} className="app-scroll"><main className="page">
      {screen === "home" && <>
        <section className="hero"><span className="kicker">✈️ Поиск чартерных авиабилетов</span><h1>Найдём подходящий рейс по лучшей доступной цене</h1><p>Выберите направление, дату и бюджет — сервис покажет подходящие чартерные предложения.</p><button className="hero-search" onClick={() => go("search")}><MagnifyingGlassIcon /><span>Куда хотите полететь?</span><ChevronRightIcon /></button></section>
        <div className="section-head"><h2>Популярные разделы</h2><button onClick={() => openSection("all")}>Все рейсы <ChevronRightIcon /></button></div>
        <div className="tiles">{sections.map(section => <button className="tile" key={section.id} onClick={() => openSection(section.id)}><span className={"tile-icon " + section.tone} aria-hidden="true">{section.icon}</span><strong>{section.title}</strong><small>{section.subtitle}</small></button>)}</div>
        <section className="announcement"><span className="notice-symbol"><BellIcon /></span><div><small>ПОДБОР РЕЙСОВ</small><strong>Следите за подходящими билетами</strong><p>Сохраните параметры поиска и вернитесь к ним, когда появятся новые предложения.</p></div></section>
        <div className="section-head"><h2>Примеры предложений</h2><button onClick={() => openSection("all")}>Все <ChevronRightIcon /></button></div>
        <div className="flight-list">{flights.slice(0,2).map(flightCard)}</div>
        <p className="demo"><InfoCircledIcon /> Цены и рейсы демонстрационные. Актуальные данные появятся после подключения поставщика.</p>
      </>}
      {screen === "search" && <>
        <div className="intro"><small>ПОДБОР БИЛЕТОВ</small><h1>Найдите свой рейс</h1><p>Выберите направление, дату и бюджет.</p></div>
        <label className="field-label" htmlFor="destination">Куда летим</label><div className="search-field"><MagnifyingGlassIcon /><KeyboardInput id="destination" aria-label="Куда летим" placeholder="Куда хотите полететь?" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="filter-group"><span className="field-label">Вылет из</span><div className="filter-options">{(["all","Алматы","Астана"] as Origin[]).map(value => <button key={value} className={origin === value ? "active" : ""} onClick={() => setOrigin(value)}>{value === "all" ? "Любой город" : value}</button>)}</div></div>
        <div className="filter-group"><span className="field-label">Дата вылета</span><div className="filter-options">{[[null,"Любая"],[7,"7 дней"],[14,"14 дней"],[30,"30 дней"]].map(([value,label]) => <button key={label} className={date === value ? "active" : ""} onClick={() => { setDate(value as number | null); setDateExact(""); keyboard.hide(); }}>{label}</button>)}</div></div>
        <label className="field-label" htmlFor="exact-date">Точная дата вылета</label><div className="date-field"><CalendarIcon /><KeyboardInput id="exact-date" type="date" min={isoAt(0)} value={dateExact} onChange={event => { setDateExact(event.target.value); setDate(null); keyboard.hide(); }} /></div>
        <div className="filter-group"><span className="field-label">Маршрут</span><div className="filter-options">{(["all","RT","OW"] as Trip[]).map(value => <button key={value} className={trip === value ? "active" : ""} onClick={() => setTrip(value)}>{value === "all" ? "Любой" : value === "RT" ? "Туда и обратно" : "В одну сторону"}</button>)}</div></div>
        <div className="filter-group"><span className="field-label">Бюджет</span><div className="filter-options">{[[null,"Любой"],[250000,"До 250 000 ₸"],[300000,"До 300 000 ₸"]].map(([value,label]) => <button key={label} className={budget === value ? "active" : ""} onClick={() => setBudget(value as number | null)}>{label}</button>)}</div></div>
        <button className={"hot-filter" + (hotOnly ? " active" : "")} onClick={() => setHotOnly(value => !value)}>🔥 Только горящие билеты <span className={"switch" + (hotOnly ? " on" : "")} /></button>
        <div className="section-head"><h2>Подходящие рейсы</h2><span className="counter">{results.length}</span></div>
        {results.length ? <div className="flight-list">{results.map(flightCard)}</div> : <div className="empty"><MagnifyingGlassIcon /><strong>Рейсов по фильтрам нет</strong><p>Попробуйте изменить направление, дату или бюджет.</p><button className="primary" onClick={resetFilters}>Сбросить фильтры</button></div>}
        <button className="alert-cta" onClick={() => go("notifications")}><BellIcon /> Настроить уведомления <ChevronRightIcon /></button>
        <p className="demo"><InfoCircledIcon /> Предложения демонстрационные. Цена и наличие требуют проверки у поставщика.</p>
      </>}
      {screen === "favorites" && <><div className="intro"><small>СОХРАНЁННЫЕ РЕЙСЫ</small><h1>Избранное</h1><p>Возвращайтесь к понравившимся предложениям.</p></div>{favoriteFlights.length ? <div className="flight-list">{favoriteFlights.map(flightCard)}</div> : <div className="empty"><BookmarkIcon /><strong>Пока пусто</strong><p>Сохраните рейс в поиске, чтобы он появился здесь.</p><button className="primary" onClick={() => go("search")}>Найти рейсы</button></div>}</>}
      {screen === "notifications" && <><div className="intro"><small>НОВЫЕ ПРЕДЛОЖЕНИЯ</small><h1>Уведомления</h1><p>Сохраните параметры поиска. Подключение реальной рассылки появится вместе с поставщиком билетов.</p></div><section className="alert-panel"><span className="notice-symbol"><BellIcon /></span><div><strong>Следить за билетами</strong><p>{query || "Любое направление"} · {origin === "all" ? "любой город" : origin} · {budget ? money(budget) : "любой бюджет"}</p></div><button className="primary full" onClick={toggleAlert}>{alerts.includes(criteria) ? "Отключить демо-уведомление" : "Сохранить параметры"}</button></section><div className="section-head"><h2>Сохранённые параметры</h2><span className="counter">{alerts.length}</span></div>{alerts.length ? alerts.map((alert, index) => { const value = JSON.parse(alert) as {query:string;origin:Origin;budget:number|null;trip:Trip}; return <div className="saved-alert" key={alert}><BellIcon /><span><strong>Подборка #{index + 1}</strong><small>{value.query || "Все направления"} · {value.origin === "all" ? "все города" : value.origin} · {value.budget ? money(value.budget) : "любой бюджет"} · {value.trip === "all" ? "любой маршрут" : value.trip}</small></span><button aria-label="Удалить уведомление" onClick={() => setAlerts(a => a.filter(x => x !== alert))}>×</button></div>; }) : <div className="empty"><BellIcon /><strong>Нет сохранённых параметров</strong><p>Настройте поиск и сохраните его здесь.</p><button className="primary" onClick={() => go("search")}>Настроить поиск</button></div>}<p className="demo"><InfoCircledIcon /> Уведомления хранятся только в этом браузере; отправка сообщений пока не подключена.</p></>}
      {screen === "profile" && <><div className="profile"><span className="profile-icon"><PersonIcon /></span><div><small>ВАШИ ПОЕЗДКИ</small><h1>Профиль</h1><p>Персональные настройки поиска</p></div></div><section className="settings"><h2>Настройки</h2><button className="setting" onClick={() => setDark(value => !value)}><span>{dark ? <SunIcon /> : <MoonIcon />} {dark ? "Светлая тема" : "Тёмная тема"}</span><ChevronRightIcon /></button><button className="setting" onClick={() => go("favorites")}><span><BookmarkIcon /> Избранное</span><ChevronRightIcon /></button><button className="setting" onClick={() => go("notifications")}><span><BellIcon /> Уведомления</span><ChevronRightIcon /></button><button className="setting" onClick={() => go("search")}><span><GlobeIcon /> Поиск рейсов</span><ChevronRightIcon /></button></section><p className="demo"><InfoCircledIcon /> Прототип поиска чартерных билетов. Бронирование и оплата пока не подключены.</p></>}
      {screen === "detail" && <><div className="detail-hero"><span className="tile-icon big blue"><PaperPlaneIcon width={27} height={27} /></span><small>{selected.trip === "RT" ? "ТУДА И ОБРАТНО" : "В ОДНУ СТОРОНУ"}</small><h1>{selected.from} → {selected.to}</h1><p>Вылет {dateAt(selected.offset)} · {selected.seats}</p></div><article className="article"><div className="article-meta"><span><InfoCircledIcon /> Демонстрационное предложение</span><button onClick={() => toggleFavorite(selected.id)}><BookmarkIcon /> {favorites.includes(selected.id) ? "Сохранено" : "Сохранить"}</button></div><p>Ориентировочная стоимость от <strong>{money(selected.price)}</strong>. Точная цена, места и условия тарифа станут доступны после подключения поставщика.</p><div className="detail-spec"><span>Маршрут</span><strong>{selected.from} → {selected.to}</strong></div><div className="detail-spec"><span>Дата</span><strong>{dateAt(selected.offset)}</strong></div><div className="detail-spec"><span>Билет</span><strong>{selected.trip === "RT" ? "Туда и обратно" : "В одну сторону"}</strong></div></article><button className="primary full" onClick={() => { setQuery(selected.to); go("search"); }}>Похожие рейсы <ChevronRightIcon /></button><p className="warning"><InfoCircledIcon /> Это демо. Бронирование и оплата пока недоступны.</p></>}
    </main></MobileScroll>
    {!keyboard.visible && <nav className="bottom-nav" aria-label="Основная навигация">{([{id:"home",label:"Главная",icon:HomeIcon},{id:"search",label:"Поиск",icon:MagnifyingGlassIcon},{id:"favorites",label:"Избранное",icon:BookmarkIcon},{id:"notifications",label:"Уведомления",icon:BellIcon},{id:"profile",label:"Профиль",icon:PersonIcon}] as const).map(item => <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => go(item.id)}><item.icon width={20} height={20}/><span>{item.label}</span></button>)}</nav>}
    {toast && <div className="toast" role="status"><CheckIcon /> {toast}</div>}
  </div>;
}
