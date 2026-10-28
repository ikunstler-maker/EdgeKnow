import type { Metadata, Viewport } from "next";
import "@/i18n/server-locale";
import { t } from "@/i18n";
import { getPreferences } from "@/lib/preferences-server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: t.app.name,
    description: t.app.description,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Language and theme come from the person's preferences, so the very first
// render is already right (no flash of the other theme or language).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { theme, locale } = await getPreferences();
  return (
    <html lang={locale} data-theme={theme === "system" ? undefined : theme} className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
