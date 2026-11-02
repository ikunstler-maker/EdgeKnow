import { dateLocale, t } from "@/i18n";

// 1536 → "1,5 КБ"
export function formatBytes(bytes: number) {
  const units = t.storage.units;
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 }).format(value)} ${units[unit]}`;
}
