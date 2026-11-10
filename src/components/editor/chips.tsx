"use client";

import { createContext, use, useState } from "react";
import Link from "next/link";
import { createReactInlineContentSpec } from "@blocknote/react";
import { t } from "@/i18n";
import {
  CHIP_COLORS,
  CHIP_LABEL_MAX,
  CHIP_MAX_OPTIONS,
  chipPresets,
  chipSetsIn,
  newOptionId,
  parseOptions,
  type ChipColor,
  type ChipOption,
  type ChipSet,
} from "@/lib/chips";
import type { MentionPerson } from "@/lib/comments";
import { pagePath } from "@/lib/paths";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { Popover } from "@/components/ui/popover";

const ch = t.editor.chips;
const COLOR_NAMES = Object.keys(CHIP_COLORS) as ChipColor[];

// People who can see the page, for person chips (provided by the page editor).
export const ChipPeopleContext = createContext<MentionPerson[]>([]);

const pillClass =
  "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-px align-baseline text-[0.85em] font-medium leading-snug whitespace-nowrap";

// --- Dropdown chip -----------------------------------------------------------------

export const dropdownChip = createReactInlineContentSpec(
  {
    type: "chip",
    propSchema: {
      name: { default: "" },
      options: { default: "[]" },
      value: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent, updateInlineContent, editor }) => {
      const props = inlineContent.props;
      return (
        <DropdownChipView
          name={props.name}
          options={parseOptions(props.options)}
          value={props.value}
          editable={editor.isEditable}
          pageSets={() => chipSetsIn(editor.document as never)}
          onChange={(next) => updateInlineContent({ type: "chip", props: { ...props, ...next } })}
        />
      );
    },
    toExternalHTML: ({ inlineContent }) => {
      const options = parseOptions(inlineContent.props.options);
      return <span>[{options.find((o) => o.id === inlineContent.props.value)?.label ?? ""}]</span>;
    },
  },
);

type ChipPatch = { name?: string; options?: string; value?: string };

function DropdownChipView({
  name,
  options,
  value,
  editable,
  pageSets,
  onChange,
}: {
  name: string;
  options: ChipOption[];
  value: string;
  editable: boolean;
  pageSets: () => ChipSet[];
  onChange: (patch: ChipPatch) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const current = options.find((o) => o.id === value);
  const colors = CHIP_COLORS[current?.color ?? "gray"];
  const label = current?.label || name || ch.choose;

  return (
    <span contentEditable={false} className="ek-chip">
      <button
        type="button"
        disabled={!editable}
        onClick={(event) => {
          setEditing(false);
          setAnchor(anchor ? null : event.currentTarget);
        }}
        aria-label={name ? `${name}: ${label}` : label}
        aria-haspopup="menu"
        className={`${pillClass} ${editable ? "cursor-pointer" : "cursor-default"}`}
        style={{ background: colors.bg, color: colors.fg }}
      >
        <span className="truncate">{label}</span>
        {editable && <span aria-hidden="true">▾</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={editing ? 300 : 220}>
          {editing ? (
            <ChipOptionsEditor
              name={name}
              options={options}
              pageSets={pageSets()}
              onSave={(nextName, nextOptions) => {
                onChange({
                  name: nextName,
                  options: JSON.stringify(nextOptions),
                  value: nextOptions.some((o) => o.id === value) ? value : (nextOptions[0]?.id ?? ""),
                });
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div role="menu" aria-label={name || ch.options}>
              {name && <p className="px-3 pb-1 pt-2 text-xs text-muted">{name}</p>}
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.id === value}
                  onClick={() => {
                    onChange({ value: o.id });
                    setAnchor(null);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface md:min-h-9"
                >
                  <span className={pillClass} style={{ background: CHIP_COLORS[o.color].bg, color: CHIP_COLORS[o.color].fg }}>
                    {o.label || ch.untitledOption}
                  </span>
                  {o.id === value && <span className="ml-auto text-accent">✓</span>}
                </button>
              ))}
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-surface md:min-h-9"
              >
                ⚙️ {ch.configure}
              </button>
            </div>
          )}
        </Popover>
      )}
    </span>
  );
}

// Name the set, add, rename, recolour and remove options, or start from a preset.
function ChipOptionsEditor({
  name,
  options,
  pageSets,
  onSave,
  onCancel,
}: {
  name: string;
  options: ChipOption[];
  pageSets: ChipSet[];
  onSave: (name: string, options: ChipOption[]) => void;
  onCancel: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draft, setDraft] = useState<ChipOption[]>(options.length ? options : [{ id: newOptionId(), label: "", color: "gray" }]);
  const presets = chipPresets();
  const sets = [...presets, ...pageSets.filter((s) => !presets.some((p) => p.name === s.name && JSON.stringify(p.options) === JSON.stringify(s.options)))];
  const inputClass = "min-h-9 min-w-0 rounded-md border border-border bg-background px-2 text-base md:text-sm";
  const stop = (event: React.KeyboardEvent) => event.stopPropagation();

  return (
    <div className="space-y-2 p-2" onKeyDown={stop} role="group" aria-label={ch.configure}>
      <label className="block text-xs text-muted">
        {ch.preset}
        <select
          value=""
          onChange={(event) => {
            const set = sets[Number(event.target.value)];
            if (!set) return;
            setDraftName(set.name);
            setDraft(set.options.map((o) => ({ ...o })));
          }}
          className={`${inputClass} mt-1 w-full`}
        >
          <option value="">{ch.choosePreset}</option>
          {sets.map((set, i) => (
            <option key={i} value={i}>
              {set.name || ch.unnamedSet}
              {i >= presets.length ? ` · ${ch.fromPage}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        {ch.setName}
        <input
          value={draftName}
          maxLength={CHIP_LABEL_MAX}
          onChange={(event) => setDraftName(event.target.value)}
          className={`${inputClass} mt-1 w-full`}
        />
      </label>
      <ul className="space-y-1" aria-label={ch.options}>
        {draft.map((o, i) => (
          <li key={o.id} className="flex items-center gap-1">
            <button
              type="button"
              aria-label={ch.color(t.editor.chips.colors[o.color])}
              title={t.editor.chips.colors[o.color]}
              onClick={() => {
                const next = COLOR_NAMES[(COLOR_NAMES.indexOf(o.color) + 1) % COLOR_NAMES.length];
                setDraft(draft.map((x, j) => (j === i ? { ...x, color: next } : x)));
              }}
              className="h-7 w-7 shrink-0 rounded-full border border-border"
              style={{ background: CHIP_COLORS[o.color].bg }}
            />
            <input
              value={o.label}
              maxLength={CHIP_LABEL_MAX}
              aria-label={ch.optionLabel(i + 1)}
              onChange={(event) => setDraft(draft.map((x, j) => (j === i ? { ...x, label: event.target.value } : x)))}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              aria-label={ch.removeOption}
              disabled={draft.length <= 1}
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}
              className="h-9 w-8 shrink-0 rounded-md text-muted hover:bg-surface disabled:opacity-40"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={draft.length >= CHIP_MAX_OPTIONS}
        onClick={() => setDraft([...draft, { id: newOptionId(), label: "", color: COLOR_NAMES[draft.length % COLOR_NAMES.length] }])}
        className="min-h-9 w-full rounded-md border border-dashed border-border text-sm text-muted hover:bg-surface disabled:opacity-50"
      >
        ＋ {ch.addOption}
      </button>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface">
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={() => onSave(draftName.trim(), draft.map((o) => ({ ...o, label: o.label.trim() })))}
          className="min-h-9 rounded-md bg-accent px-3 text-sm font-medium text-white hover:opacity-90"
        >
          {t.common.save}
        </button>
      </div>
    </div>
  );
}

// --- Page chip -----------------------------------------------------------------------

// Only the page id is stored: the title and icon come from the reader's own page
// list, so someone without access sees "no access", never the title.
export const pageChip = createReactInlineContentSpec(
  {
    type: "pageChip",
    propSchema: { pageId: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => <PageChipView pageId={inlineContent.props.pageId} />,
    toExternalHTML: () => <span>[{ch.pageChip}]</span>,
  },
);

function PageChipView({ pageId }: { pageId: string }) {
  const pages = useOptionalPages();
  const page = pages?.pages.find((p) => p.id === pageId);
  if (!pages || !page) {
    return (
      <span contentEditable={false} className={`${pillClass} ek-chip bg-surface text-muted`} title={ch.noAccess}>
        🔒 {ch.noAccess}
      </span>
    );
  }
  return (
    <Link prefetch={false}
      href={pagePath(pages.workspace.shortId, page.id)}
      contentEditable={false}
      className={`${pillClass} ek-chip ek-chip-link border border-border bg-background text-foreground hover:bg-surface`}
    >
      <span aria-hidden="true">{page.icon ?? "📄"}</span>
      <span className="truncate">{page.title || t.pages.untitled}</span>
    </Link>
  );
}

// --- Person chip ---------------------------------------------------------------------

export const personChip = createReactInlineContentSpec(
  {
    type: "personChip",
    propSchema: { userId: { default: "" }, label: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => <PersonChipView userId={inlineContent.props.userId} label={inlineContent.props.label} />,
    toExternalHTML: ({ inlineContent }) => <span>@{inlineContent.props.label}</span>,
  },
);

function PersonChipView({ userId, label }: { userId: string; label: string }) {
  const people = use(ChipPeopleContext);
  // The current name if the person can still see the page; otherwise the name saved at insert.
  const name = people.find((p) => p.userId === userId)?.label ?? label;
  return (
    <span contentEditable={false} className={`${pillClass} ek-chip bg-accent/10 text-accent`} title={name}>
      <span aria-hidden="true">👤</span>
      <span className="truncate">{name || ch.someone}</span>
    </span>
  );
}
