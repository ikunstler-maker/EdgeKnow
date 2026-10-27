import type { Metadata, Viewport } from "next";
import { locale, t } from "@/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: t.app.name,
  description: t.app.description,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
