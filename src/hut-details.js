import { formatNumber, translate } from "./i18n.js?v=vitosha-polish-20261120";

const FACTS = [
  ["capacity_beds", "hutBeds"], ["opening_hours", "hutHours"], ["drinking_water", "hutWater"],
  ["food", "hutFood"], ["toilets", "hutToilets"], ["shower", "hutShower"], ["internet_access", "hutInternet"],
  ["payment", "hutPayment"], ["reservation", "hutReservation"], ["fee", "hutFee"], ["operator", "hutOperator"],
  ["season", "hutSeason"], ["wheelchair", "hutWheelchair"], ["check_date", "hutCheckDate"], ["wikidata", "hutWikidata"],
];
const VALUES = {
  yes: "hutYes", no: "hutNo", limited: "hutLimited", only: "hutOnly", recommended: "hutRecommended",
  required: "hutRequired", optional: "hutOptional", wlan: "hutWifi",
  cash: "hutPaymentCash", credit_cards: "hutPaymentCredit", debit_cards: "hutPaymentDebit",
};

export function formatCheckedDate(value, language) {
  const date = new Date(value);
  // One malformed date must not stop the rest of a card from rendering.
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "bg-BG", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function knownValue(value, language) {
  if (value === true) return translate(language, "hutYes");
  if (value === false) return translate(language, "hutNo");
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return Object.hasOwn(VALUES, key) ? translate(language, VALUES[key]) : value;
}

export function visibleDetailRows(details, language) {
  const rows = [];
  for (const [field, label] of FACTS) {
    const detail = details?.[field], value = detail?.value;
    if (value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length)) continue;
    let display;
    if (field === "opening_hours") display = value;
    else if (field === "check_date" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))) display = formatCheckedDate(value, language);
    else if (Array.isArray(value)) display = value.map(entry => {
      const [method, status] = entry.split("=");
      const name = knownValue(method, language);
      return status && status !== "yes" ? `${name} · ${knownValue(status, language)}` : name;
    }).join(", ");
    else display = typeof value === "number" ? formatNumber(value, language, 0) : knownValue(value, language);
    rows.push({ field, label: translate(language, label), display, source: detail.source, checked: detail.checked });
  }
  return rows;
}

export function formatPhoneHref(value) {
  const phone = typeof value === "string" ? value.split(/[;,]/)[0].trim() : "";
  if (!/^\+?[\d ().-]+$/.test(phone)) return null;
  const dial = phone.replace(/[^+\d]/g, "");
  return /^\+?\d{6,15}$/.test(dial) ? `tel:${dial}` : null;
}

export function formatEmailHref(value) {
  const email = typeof value === "string" ? value.split(";")[0].trim() : "";
  if (!/^[^@\s<>"?#]+@[\w.-]+\.[a-z]{2,}$/i.test(email)) return null;
  const [local, domain] = email.split("@");
  return `mailto:${encodeURIComponent(local)}@${domain}`;
}

export function formatWebsiteHref(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const input = value.trim();
  const href = /^[\w.-]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(input) ? `https://${input}` : input;
  try {
    const url = new URL(href);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function latestCheckedDate(details) {
  return Object.values(details ?? {})
    .filter(detail => detail.source === "manual" && detail.value != null && /^\d{4}-\d{2}-\d{2}$/.test(detail.checked) && Number.isFinite(Date.parse(detail.checked)))
    .map(detail => detail.checked).sort().at(-1) ?? null;
}
