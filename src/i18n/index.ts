import type { Locale } from "@/lib/preferences";
import { en } from "./en";
import { uk, type Dictionary } from "./uk";

// Strings are looked up at the moment they're read, in the language of the
// current request: in the browser from <html lang>, on the server from the
// request's cookie (see ./server-locale.ts). `t.section` gives a lazy view of a
// section, so `const s = t.settings` at the top of a module still follows the
// language; plain strings, arrays and functions come straight from the dictionary.

const dictionaries: Record<Locale, Dictionary> = { uk, en };

type Resolver = () => Locale | null;
const globalForLocale = globalThis as typeof globalThis & { __edgeknowLocale?: Resolver };

export function currentLocale(): Locale {
  if (typeof document !== "undefined") return document.documentElement.lang === "en" ? "en" : "uk";
  return globalForLocale.__edgeknowLocale?.() ?? "uk";
}

const isSection = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function lookup(path: readonly string[]): unknown {
  let value: unknown = dictionaries[currentLocale()];
  for (const key of path) value = isSection(value) ? value[key] : undefined;
  return value;
}

function view(path: readonly string[]): unknown {
  return new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== "string") return undefined;
        const value = lookup([...path, key]);
        return isSection(value) ? view([...path, key]) : value;
      },
      has: (_, key) => typeof key === "string" && isSection(lookup(path)) && key in (lookup(path) as object),
      ownKeys: () => (isSection(lookup(path)) ? Reflect.ownKeys(lookup(path) as object) : []),
      getOwnPropertyDescriptor: (_, key) => {
        const section = lookup(path);
        if (!isSection(section) || typeof key !== "string" || !(key in section)) return undefined;
        const value = section[key];
        return { value: isSection(value) ? view([...path, key]) : value, enumerable: true, configurable: true, writable: false };
      },
    },
  );
}

export const t = view([]) as Dictionary;

// Formats for dates and times in the current language.
export const dateLocale = () => (currentLocale() === "en" ? "en-GB" : "uk-UA");
export type { Dictionary };
