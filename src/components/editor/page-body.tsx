"use client";

import dynamic from "next/dynamic";
import { t } from "@/i18n";
import type { PageEditorProps } from "./page-editor";

// The editor needs the browser (selection, clipboard), so it loads on the client only.
const PageEditor = dynamic(() => import("./page-editor"), {
  ssr: false,
  loading: () => <p className="mt-8 text-sm text-muted">{t.editor.loading}</p>,
});

export function PageBody(props: PageEditorProps) {
  return <PageEditor {...props} />;
}
