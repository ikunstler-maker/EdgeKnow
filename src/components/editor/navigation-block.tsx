"use client";

import { createContext, use, useState } from "react";
import Link from "next/link";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { canEdit, childrenOf, rootsOf, type PageNode } from "@/lib/pages";
import { pagePath } from "@/lib/paths";
import { useOptionalPages } from "@/components/pages/pages-provider";

const n = t.editor.navigation;

// The page the editor shows, for blocks that depend on where they are.
export const EditorPageContext = createContext<{ pageId: string }>({ pageId: "" });

// "Навігація": the page tree inside the text — this page's subpages or the whole
// workspace, with only the pages the reader can see.
export const navigationBlock = createReactBlockSpec(
  {
    type: "navigation",
    propSchema: {
      scope: { default: "children", values: ["children", "workspace"] as const },
    },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => (
      <NavigationView
        scope={block.props.scope}
        editable={editor.isEditable}
        onScope={(scope) => editor.updateBlock(block, { props: { scope } })}
      />
    ),
    toExternalHTML: () => <p>[{n.title}]</p>,
  },
);

function NavigationView({
  scope,
  editable,
  onScope,
}: {
  scope: "children" | "workspace";
  editable: boolean;
  onScope: (scope: "children" | "workspace") => void;
}) {
  const pagesContext = useOptionalPages();
  const { pageId } = use(EditorPageContext);
  const pages = pagesContext?.pages ?? [];
  const current = pages.find((p) => p.id === pageId);
  const roots = scope === "workspace" ? rootsOf(pages) : childrenOf(pages, pageId);
  // New pages: under this page, or at the top level for the whole-workspace view.
  const canCreate = editable && pagesContext && (scope === "workspace" || canEdit(current?.role));

  return (
    <nav contentEditable={false} className="ek-navigation" aria-label={n.title}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 text-sm font-medium">🧭 {scope === "workspace" ? n.workspace : n.children}</span>
        {editable && (
          <div role="group" aria-label={n.scope} className="flex rounded-md border border-border p-0.5 text-xs">
            {(["children", "workspace"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => onScope(value)}
                className={`min-h-9 rounded px-2 md:min-h-7 ${scope === value ? "bg-surface font-medium" : "text-muted hover:text-foreground"}`}
              >
                {value === "workspace" ? n.workspaceShort : n.childrenShort}
              </button>
            ))}
          </div>
        )}
      </div>
      {roots.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">{scope === "workspace" ? n.emptyWorkspace : n.emptyChildren}</p>
      ) : (
        <ul className="py-1" role="tree" aria-label={n.title}>
          {roots.map((page) => (
            <NavItem key={page.id} page={page} pages={pages} depth={0} currentId={pageId} />
          ))}
        </ul>
      )}
      {canCreate && (
        <button
          type="button"
          onClick={() => pagesContext.create(scope === "workspace" ? null : pageId)}
          className="flex min-h-11 w-full items-center gap-2 border-t border-border px-3 text-left text-sm text-muted hover:bg-surface hover:text-foreground md:min-h-9"
        >
          ＋ {scope === "workspace" ? n.newPage : n.newSubpage}
        </button>
      )}
    </nav>
  );
}

function NavItem({ page, pages, depth, currentId }: { page: PageNode; pages: PageNode[]; depth: number; currentId: string }) {
  const pagesContext = useOptionalPages();
  const children = childrenOf(pages, page.id);
  const [open, setOpen] = useState(false);
  return (
    <li role="treeitem" aria-selected={page.id === currentId} aria-expanded={children.length ? open : undefined} aria-level={depth + 1}>
      <div className="flex min-h-11 items-center gap-1 pr-2 hover:bg-surface md:min-h-8" style={{ paddingLeft: 8 + depth * 18 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? t.sidebar.collapse : t.sidebar.expand}
          className={`flex h-8 w-6 shrink-0 items-center justify-center rounded text-xs text-muted hover:bg-border ${children.length ? "" : "invisible"}`}
        >
          <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        </button>
        <Link prefetch={false}
          href={pagesContext ? pagePath(pagesContext.workspace.shortId, page.id) : "#"}
          className={`flex min-w-0 flex-1 items-center gap-2 text-sm ${page.id === currentId ? "font-semibold" : ""}`}
        >
          <span className="shrink-0">{page.icon ?? "📄"}</span>
          <span className="truncate">{page.title || t.pages.untitled}</span>
        </Link>
        {children.length > 0 && <span className="text-xs text-muted">{children.length}</span>}
      </div>
      {open && children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <NavItem key={child.id} page={child} pages={pages} depth={depth + 1} currentId={currentId} />
          ))}
        </ul>
      )}
    </li>
  );
}
