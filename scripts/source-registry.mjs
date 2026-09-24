export const sourceRegistry = [
  {
    id: "charter_forever_travel",
    label: "Forever Travel Telegram",
    kind: "telegram_public",
    priceKind: "sale",
    url: "https://t.me/s/charter_forever_travel",
    enabled: true
  },
  {
    id: "charterkaz",
    label: "Чартерные авиабилеты Telegram",
    kind: "telegram_public",
    priceKind: "sale",
    url: "https://t.me/s/charterkaz",
    enabled: true
  },
  {
    id: "neos",
    label: "NEOS / Google Sheets",
    kind: "google_sheet_csv",
    priceKind: "cost",
    url: "https://docs.google.com/spreadsheets/d/1On4MmRaa6JOK8KPud8oLN_Rsd7cm5r3p-_ft3JDDCuw/gviz/tq?tqx=out:csv&gid=0",
    spreadsheetId: "1On4MmRaa6JOK8KPud8oLN_Rsd7cm5r3p-_ft3JDDCuw",
    enabled: true,
    currencyEnv: "NEOS_SOURCE_CURRENCY"
  },
  {
    id: "fun_sun",
    label: "FUN&SUN",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://b2b.fstravel.asia/tickets",
    enabled: true,
    auth: "optional_or_required_by_results",
    usernameEnv: "FUN_SUN_USERNAME",
    passwordEnv: "FUN_SUN_PASSWORD"
  },
  {
    id: "kazunion",
    label: "KAZUNION",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://online.kazunion.com/tickets",
    enabled: true,
    auth: "public_search",
    usernameEnv: "KAZUNION_USERNAME",
    passwordEnv: "KAZUNION_PASSWORD"
  },
  {
    id: "kompas",
    label: "KOMPAS",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://online.kz.kompastour.com/tickets",
    enabled: true,
    auth: "required",
    usernameEnv: "KOMPAS_USERNAME",
    passwordEnv: "KOMPAS_PASSWORD"
  },
  {
    id: "anex",
    label: "ANEX",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://agent.anextour.kz/search/avia",
    enabled: true,
    auth: "required",
    usernameEnv: "ANEX_USERNAME",
    passwordEnv: "ANEX_PASSWORD"
  },
  {
    id: "selfie",
    label: "SELFIE",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://b2b.selfietravel.kz/tickets",
    enabled: true,
    auth: "required",
    usernameEnv: "SELFIE_USERNAME",
    passwordEnv: "SELFIE_PASSWORD"
  },
  {
    id: "joinup",
    label: "JOINUP",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://online.joinup.kz/tickets",
    enabled: true,
    auth: "optional_or_required_by_results",
    usernameEnv: "JOINUP_USERNAME",
    passwordEnv: "JOINUP_PASSWORD"
  },
  {
    id: "pegas",
    label: "PEGAS Touristik",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://kz.pegast.asia/FlightSearch",
    enabled: true,
    auth: "required",
    usernameEnv: "PEGAS_USERNAME",
    passwordEnv: "PEGAS_PASSWORD"
  },
  {
    id: "crystal_bay",
    label: "Crystal Bay",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://booking-kz.crystalbay.com/tickets",
    enabled: true,
    auth: "public_search",
    usernameEnv: "CRYSTAL_BAY_USERNAME",
    passwordEnv: "CRYSTAL_BAY_PASSWORD"
  },
  {
    id: "abk",
    label: "ABK Tourism",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://b2b.abktourism.kz/tickets",
    enabled: true,
    auth: "public_search",
    usernameEnv: "ABK_USERNAME",
    passwordEnv: "ABK_PASSWORD"
  },
  {
    id: "space",
    label: "SPACE / Travel Luxe",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://online.travelluxe.kz/tickets",
    enabled: true,
    auth: "required",
    usernameEnv: "SPACE_USERNAME",
    passwordEnv: "SPACE_PASSWORD"
  },
  {
    id: "vietra",
    label: "VIETRA",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://b2b.vietratour.com/tickets",
    enabled: true,
    auth: "required",
    usernameEnv: "VIETRA_USERNAME",
    passwordEnv: "VIETRA_PASSWORD"
  },
  {
    id: "sanat",
    label: "SANAT",
    kind: "b2b_web",
    priceKind: "cost",
    url: "https://online.sanat.kz/TourSearchClient#/Individuals/Avia/",
    enabled: true,
    auth: "unknown",
    usernameEnv: "SANAT_USERNAME",
    passwordEnv: "SANAT_PASSWORD"
  }
];

export function enabledSources() {
  return sourceRegistry.filter(source => source.enabled);
}
