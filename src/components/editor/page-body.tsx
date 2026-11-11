"use client";

import dynamic from "next/dynamic";
import { createContext, useContext } from "react";
import { t } from "@/i18n";
import type { PageEditorProps } from "./page-editor";
import { PagePreview } from "./page-preview";

// What the page holds, for the stand-in shown until the editor is ready.
const PreviewContent = createContext<unknown>(null);

function EditorLoading() {
  const content = useContext(PreviewContent);
  // The text is readable at once (the server sends it drawn); a new or empty page just says "loading".
  return Array.isArray(content) && content.length > 0 ? (
    <PagePreview content={content} />
  ) : (
    <p className="mt-8 text-sm text-muted">{t.editor.loading}</p>
  );
}

// The editor needs the browser (selection, clipboard), so it loads on the client only.
const PageEditor = dynamic(() => import("./page-editor"), {
  ssr: false,
  loading: () => <EditorLoading />,
});

export function PageBody(props: PageEditorProps) {
  return (
    <PreviewContent.Provider value={props.initialContent}>
      <PageEditor {...props} />
    </PreviewContent.Provider>
  );
}
