import "server-only";
// Next's per-request store, which holds the request's cookies for both the
// server components and the server rendering of client components. Reading it
// keeps `t` synchronous everywhere; if Next ever changes it, the language just
// falls back to Ukrainian (the e2e test checks the English path).
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { LOCALE_COOKIE, asLocale, type Locale } from "@/lib/preferences";

type CookieReader = { get: (name: string) => { value: string } | undefined };

(globalThis as typeof globalThis & { __edgeknowLocale?: () => Locale | null }).__edgeknowLocale = () => {
  try {
    const store = workUnitAsyncStorage.getStore() as { cookies?: unknown } | undefined;
    const jar = store?.cookies as CookieReader | undefined;
    return typeof jar?.get === "function" ? asLocale(jar.get(LOCALE_COOKIE)?.value) : null;
  } catch {
    return null;
  }
};
