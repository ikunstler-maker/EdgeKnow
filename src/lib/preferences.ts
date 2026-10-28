// Interface preferences shared by server and browser code.
export const THEME_COOKIE = "ek-theme";
export const LOCALE_COOKIE = "ek-locale";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const LOCALES = ["uk", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const asTheme = (value: unknown): Theme | null => (THEMES.includes(value as Theme) ? (value as Theme) : null);
export const asLocale = (value: unknown): Locale | null => (LOCALES.includes(value as Locale) ? (value as Locale) : null);
