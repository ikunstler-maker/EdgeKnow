// The lists behind three kinds of a project's own fields: geos (country codes), languages
// and currencies. One list for every project, kept here (the owner's list of 2026-11-12);
// a person may also write a value of their own in a field ("other:<text>").
import { dateLocale } from "@/i18n";
import type { FieldKind } from "@/lib/tasks";

export type ListItem = { code: string; uk: string; en: string };

export const GEOS: ListItem[] = [
  { code: "AU", uk: "Австралія", en: "Australia" },
  { code: "DZ", uk: "Алжир", en: "Algeria" },
  { code: "AR", uk: "Аргентина", en: "Argentina" },
  { code: "BD", uk: "Бангладеш", en: "Bangladesh" },
  { code: "BR", uk: "Бразилія", en: "Brazil" },
  { code: "GB", uk: "Велика Британія", en: "United Kingdom" },
  { code: "VN", uk: "В'єтнам", en: "Vietnam" },
  { code: "EC", uk: "Еквадор", en: "Ecuador" },
  { code: "EG", uk: "Єгипет", en: "Egypt" },
  { code: "ZW", uk: "Зімбабве", en: "Zimbabwe" },
  { code: "IN", uk: "Індія", en: "India" },
  { code: "ID", uk: "Індонезія", en: "Indonesia" },
  { code: "ES", uk: "Іспанія", en: "Spain" },
  { code: "IT", uk: "Італія", en: "Italy" },
  { code: "KZ", uk: "Казахстан", en: "Kazakhstan" },
  { code: "KH", uk: "Камбоджа", en: "Cambodia" },
  { code: "CA", uk: "Канада", en: "Canada" },
  { code: "KE", uk: "Кенія", en: "Kenya" },
  { code: "CO", uk: "Колумбія", en: "Colombia" },
  { code: "MY", uk: "Малайзія", en: "Malaysia" },
  { code: "MA", uk: "Марокко", en: "Morocco" },
  { code: "MX", uk: "Мексика", en: "Mexico" },
  { code: "NG", uk: "Нігерія", en: "Nigeria" },
  { code: "DE", uk: "Німеччина", en: "Germany" },
  { code: "NZ", uk: "Нова Зеландія", en: "New Zealand" },
  { code: "AE", uk: "Об'єднані Арабські Емірати (ОАЕ)", en: "United Arab Emirates (UAE)" },
  { code: "PK", uk: "Пакистан", en: "Pakistan" },
  { code: "PA", uk: "Панама", en: "Panama" },
  { code: "ZA", uk: "Південна Африка (ПАР)", en: "South Africa" },
  { code: "KR", uk: "Південна Корея", en: "South Korea" },
  { code: "PE", uk: "Перу", en: "Peru" },
  { code: "PL", uk: "Польща", en: "Poland" },
  { code: "RO", uk: "Румунія", en: "Romania" },
  { code: "SV", uk: "Сальвадор", en: "El Salvador" },
  { code: "SA", uk: "Саудівська Аравія", en: "Saudi Arabia" },
  { code: "SG", uk: "Сінгапур", en: "Singapore" },
  { code: "US", uk: "Сполучені Штати Америки (США)", en: "United States of America (USA)" },
  { code: "TW", uk: "Тайвань", en: "Taiwan" },
  { code: "TH", uk: "Таїланд", en: "Thailand" },
  { code: "TR", uk: "Туреччина", en: "Turkey" },
  { code: "HU", uk: "Угорщина", en: "Hungary" },
  { code: "UZ", uk: "Узбекистан", en: "Uzbekistan" },
  { code: "UA", uk: "Україна", en: "Ukraine" },
  { code: "PH", uk: "Філіппіни", en: "Philippines" },
  { code: "FR", uk: "Франція", en: "France" },
  { code: "CZ", uk: "Чехія", en: "Czechia" },
  { code: "CL", uk: "Чилі", en: "Chile" },
  { code: "CH", uk: "Швейцарія", en: "Switzerland" },
  { code: "SE", uk: "Швеція", en: "Sweden" },
  { code: "JP", uk: "Японія", en: "Japan" },
];

export const LANGUAGES: ListItem[] = [
  { code: "en", uk: "англійська", en: "English" },
  { code: "ar", uk: "арабська", en: "Arabic" },
  { code: "fr", uk: "французька", en: "French" },
  { code: "es", uk: "іспанська", en: "Spanish" },
  { code: "bn", uk: "бенгальська", en: "Bengali" },
  { code: "pt", uk: "португальська", en: "Portuguese" },
  { code: "vi", uk: "в'єтнамська", en: "Vietnamese" },
  { code: "sn", uk: "шона", en: "Shona" },
  { code: "nd", uk: "північна ндебеле", en: "Northern Ndebele" },
  { code: "hi", uk: "гінді", en: "Hindi" },
  { code: "id", uk: "індонезійська", en: "Indonesian" },
  { code: "it", uk: "італійська", en: "Italian" },
  { code: "kk", uk: "казахська", en: "Kazakh" },
  { code: "ru", uk: "російська", en: "Russian" },
  { code: "km", uk: "кхмерська", en: "Khmer" },
  { code: "sw", uk: "суахілі", en: "Swahili" },
  { code: "ms", uk: "малайська", en: "Malay" },
  { code: "de", uk: "німецька", en: "German" },
  { code: "mi", uk: "маорі", en: "Maori" },
  { code: "ur", uk: "урду", en: "Urdu" },
  { code: "af", uk: "африкаанс", en: "Afrikaans" },
  { code: "zu", uk: "зулу", en: "Zulu" },
  { code: "ko", uk: "корейська", en: "Korean" },
  { code: "pl", uk: "польська", en: "Polish" },
  { code: "ro", uk: "румунська", en: "Romanian" },
  { code: "zh", uk: "китайська", en: "Chinese" },
  { code: "ta", uk: "тамільська", en: "Tamil" },
  { code: "th", uk: "тайська", en: "Thai" },
  { code: "tr", uk: "турецька", en: "Turkish" },
  { code: "hu", uk: "угорська", en: "Hungarian" },
  { code: "uz", uk: "узбецька", en: "Uzbek" },
  { code: "uk", uk: "українська", en: "Ukrainian" },
  { code: "tl", uk: "тагальська", en: "Tagalog" },
  { code: "cs", uk: "чеська", en: "Czech" },
  { code: "sv", uk: "шведська", en: "Swedish" },
  { code: "ja", uk: "японська", en: "Japanese" },
];

export const CURRENCIES: ListItem[] = [
  { code: "AUD", uk: "австралійський долар", en: "Australian dollar" },
  { code: "DZD", uk: "алжирський динар", en: "Algerian dinar" },
  { code: "ARS", uk: "аргентинське песо", en: "Argentine peso" },
  { code: "BDT", uk: "бангладеська така", en: "Bangladeshi taka" },
  { code: "BRL", uk: "бразильський реал", en: "Brazilian real" },
  { code: "GBP", uk: "фунт стерлінгів", en: "Pound sterling" },
  { code: "VND", uk: "в'єтнамський донг", en: "Vietnamese dong" },
  { code: "USD", uk: "долар США", en: "US dollar" },
  { code: "EGP", uk: "єгипетський фунт", en: "Egyptian pound" },
  { code: "ZWL", uk: "зімбабвійський долар", en: "Zimbabwean dollar" },
  { code: "INR", uk: "індійська рупія", en: "Indian rupee" },
  { code: "IDR", uk: "індонезійська рупія", en: "Indonesian rupiah" },
  { code: "EUR", uk: "євро", en: "Euro" },
  { code: "KZT", uk: "казахстанський теньге", en: "Kazakhstani tenge" },
  { code: "KHR", uk: "камбоджійський рієль", en: "Cambodian riel" },
  { code: "CAD", uk: "канадський долар", en: "Canadian dollar" },
  { code: "KES", uk: "кенійський шилінг", en: "Kenyan shilling" },
  { code: "COP", uk: "колумбійське песо", en: "Colombian peso" },
  { code: "MYR", uk: "малайзійський рингіт", en: "Malaysian ringgit" },
  { code: "MAD", uk: "марокканський дирхам", en: "Moroccan dirham" },
  { code: "MXN", uk: "мексиканське песо", en: "Mexican peso" },
  { code: "NGN", uk: "нігерійська найра", en: "Nigerian naira" },
  { code: "NZD", uk: "новозеландський долар", en: "New Zealand dollar" },
  { code: "AED", uk: "дирхам ОАЕ", en: "UAE dirham" },
  { code: "PKR", uk: "пакистанська рупія", en: "Pakistani rupee" },
  { code: "PAB", uk: "панамське бальбоа", en: "Panamanian balboa" },
  { code: "ZAR", uk: "південноафриканський ранд", en: "South African rand" },
  { code: "KRW", uk: "південнокорейська вона", en: "South Korean won" },
  { code: "PEN", uk: "перуанський соль", en: "Peruvian sol" },
  { code: "PLN", uk: "польський злотий", en: "Polish zloty" },
  { code: "RON", uk: "румунський лей", en: "Romanian leu" },
  { code: "SVC", uk: "сальвадорський колон", en: "Salvadoran colon" },
  { code: "SAR", uk: "саудівський ріял", en: "Saudi riyal" },
  { code: "SGD", uk: "сінгапурський долар", en: "Singapore dollar" },
  { code: "TWD", uk: "новий тайванський долар", en: "New Taiwan dollar" },
  { code: "THB", uk: "тайський бат", en: "Thai baht" },
  { code: "TRY", uk: "турецька ліра", en: "Turkish lira" },
  { code: "HUF", uk: "угорський форинт", en: "Hungarian forint" },
  { code: "UZS", uk: "узбецький сум", en: "Uzbekistani sum" },
  { code: "UAH", uk: "українська гривня", en: "Ukrainian hryvnia" },
  { code: "PHP", uk: "філіппінське песо", en: "Philippine peso" },
  { code: "CZK", uk: "чеська крона", en: "Czech koruna" },
  { code: "CLP", uk: "чилійське песо", en: "Chilean peso" },
  { code: "CHF", uk: "швейцарський франк", en: "Swiss franc" },
  { code: "SEK", uk: "шведська крона", en: "Swedish krona" },
  { code: "JPY", uk: "японська єна", en: "Japanese yen" },
];

export const CODE_KINDS: FieldKind[] = ["language", "geo", "currency"];
export const listOf = (kind: FieldKind): ListItem[] => (kind === "geo" ? GEOS : kind === "language" ? LANGUAGES : kind === "currency" ? CURRENCIES : []);
// The full name behind a code, in the reader's language.
export const itemName = (item: ListItem) => (dateLocale().startsWith("uk") ? item.uk : item.en);

// A value a person wrote themselves.
export const OTHER = "other:";
export const isOther = (value: string) => value.startsWith(OTHER);
export const otherText = (value: string) => value.slice(OTHER.length);

// Seconds as hours, minutes and seconds.
export const splitDuration = (seconds: number) => ({ h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60), s: seconds % 60 });
export const durationText = (seconds: number) => {
  const { h, m, s } = splitDuration(Math.max(0, Math.round(seconds)));
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
