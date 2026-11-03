// Schematic, minimal screens of each service for the presentation page: drawn,
// not screenshots — lines instead of text, so they read in any language.

const line = (w: string, o = 0.18) => <span className="block h-1.5 rounded-full bg-white" style={{ width: w, opacity: o }} />;

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="ek-glass relative h-full w-full overflow-hidden rounded-[28px] p-5" role="img" aria-label={label}>
      <div className="mb-4 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
      </div>
      {children}
    </div>
  );
}

function Wiki() {
  return (
    <div className="grid h-[calc(100%-2rem)] grid-cols-[30%_1fr] gap-4">
      <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-3">
        {["70%", "55%", "80%", "45%", "65%", "50%"].map((w, i) => (
          <span key={i} className="flex items-center gap-2" style={{ paddingLeft: i % 3 === 1 ? 12 : 0 }}>
            <span className="h-2 w-2 rounded-sm bg-sky-300/60" />
            {line(w, 0.2)}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <span className="h-3 w-1/2 rounded-full bg-white/70" />
        {line("95%")}
        {line("88%")}
        {line("70%")}
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/[0.06] p-2">
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-white/10">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className={`h-3 ${i < 3 ? "bg-sky-300/25" : "bg-black/30"}`} />
              ))}
            </div>
          </div>
          <div className="flex items-end gap-1.5 rounded-xl bg-white/[0.06] p-2">
            {[40, 70, 55, 90].map((h, i) => (
              <span key={i} className="flex-1 rounded-t bg-gradient-to-t from-sky-400/60 to-violet-300/70" style={{ height: h * 0.5 }} />
            ))}
          </div>
        </div>
        {line("80%")}
        {line("60%")}
      </div>
    </div>
  );
}

function Tasks() {
  const cols = [
    ["bg-amber-300/60", "bg-sky-300/60", "bg-rose-300/60"],
    ["bg-violet-300/60", "bg-sky-300/60"],
    ["bg-emerald-300/60", "bg-emerald-300/60", "bg-amber-300/60"],
  ];
  return (
    <div className="grid h-[calc(100%-2rem)] grid-cols-3 gap-3">
      {cols.map((cards, c) => (
        <div key={c} className="flex flex-col gap-2.5 rounded-2xl bg-white/[0.04] p-2.5">
          {line("45%", 0.35)}
          {cards.map((dot, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl bg-white/[0.08] p-2.5">
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {line("40%", 0.3)}
              </span>
              {line("85%")}
              {line("60%", 0.12)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Boards() {
  const notes = [
    ["left-[6%] top-[8%] rotate-[-4deg] bg-amber-200/80", "w-[26%]"],
    ["left-[36%] top-[4%] rotate-[3deg] bg-sky-200/80", "w-[24%]"],
    ["left-[66%] top-[12%] rotate-[-2deg] bg-rose-200/80", "w-[26%]"],
    ["left-[14%] top-[52%] rotate-[2deg] bg-emerald-200/80", "w-[24%]"],
    ["left-[48%] top-[50%] rotate-[-3deg] bg-violet-200/80", "w-[28%]"],
  ];
  return (
    <div className="relative h-[calc(100%-2rem)] rounded-2xl bg-[radial-gradient(circle,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:18px_18px]">
      {notes.map(([cls, w], i) => (
        <div key={i} className={`absolute aspect-square rounded-md p-2.5 shadow-lg shadow-black/40 ${cls} ${w}`}>
          <span className="block h-1.5 w-3/4 rounded-full bg-black/25" />
          <span className="mt-1.5 block h-1.5 w-1/2 rounded-full bg-black/15" />
          {i === 1 && <span className="absolute -right-2 -top-2 rounded-full bg-sky-500 px-1.5 text-[10px] font-bold text-white">3</span>}
        </div>
      ))}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M30 38 C 40 48, 46 46, 52 52" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" fill="none" strokeDasharray="2 1.5" />
      </svg>
    </div>
  );
}

function Nodes() {
  const kids = [
    [20, 18, "#7dd3fc"],
    [80, 18, "#c4b5fd"],
    [14, 72, "#86efac"],
    [86, 72, "#fda4af"],
    [50, 90, "#fcd34d"],
  ] as const;
  return (
    <div className="relative h-[calc(100%-2rem)]">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {kids.map(([x, y, c], i) => (
          <path key={i} d={`M50 50 Q ${(50 + x) / 2} ${y < 50 ? 50 : y} ${x} ${y}`} stroke={c} strokeOpacity="0.6" strokeWidth="0.7" fill="none" />
        ))}
      </svg>
      <div className="absolute left-1/2 top-1/2 w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white/90 p-3 shadow-xl">
        <span className="mx-auto block h-2 w-3/4 rounded-full bg-black/60" />
      </div>
      {kids.map(([x, y, c], i) => (
        <div key={i} className="absolute w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-2" style={{ left: `${x}%`, top: `${y}%`, borderColor: c, background: "rgba(255,255,255,0.06)" }}>
          <span className="block h-1.5 w-3/4 rounded-full" style={{ background: c, opacity: 0.7 }} />
        </div>
      ))}
    </div>
  );
}

function Sheets() {
  return (
    <div className="flex h-[calc(100%-2rem)] flex-col gap-3">
      <div className="grid grid-cols-5 gap-px overflow-hidden rounded-xl bg-white/10">
        {Array.from({ length: 30 }, (_, i) => (
          <span key={i} className={`h-5 ${i < 5 ? "bg-white/15" : i % 5 === 0 ? "bg-white/[0.07]" : "bg-black/40"} flex items-center px-1.5`}>
            {i >= 5 && i % 5 !== 0 && <span className="h-1 rounded-full bg-white/25" style={{ width: `${30 + ((i * 37) % 60)}%` }} />}
          </span>
        ))}
      </div>
      <div className="flex flex-1 items-end gap-2 rounded-xl bg-white/[0.05] p-3">
        {[35, 55, 45, 70, 60, 85, 75, 95].map((h, i) => (
          <span key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-emerald-400/50 to-sky-300/80" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function Surveys() {
  return (
    <div className="flex h-[calc(100%-2rem)] flex-col gap-3">
      <div className="rounded-2xl bg-white/[0.06] p-3">
        <span className="block h-2 w-1/2 rounded-full bg-white/70" />
        {[true, false, false].map((on, i) => (
          <span key={i} className="mt-2.5 flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full border ${on ? "border-sky-300 bg-sky-300" : "border-white/30"}`} />
            {line(`${50 - i * 8}%`, 0.25)}
          </span>
        ))}
      </div>
      <div className="rounded-2xl bg-white/[0.06] p-3">
        <span className="block h-2 w-1/3 rounded-full bg-white/70" />
        <span className="mt-2.5 flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`text-lg leading-none ${n <= 4 ? "text-amber-300" : "text-white/20"}`}>
              ★
            </span>
          ))}
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2 rounded-2xl bg-white/[0.06] p-3">
        {[80, 45, 25].map((w, i) => (
          <span key={i} className="h-3 rounded-full bg-gradient-to-r from-sky-400/70 to-violet-400/70" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

const SCREENS: Record<string, () => React.ReactElement> = { wiki: Wiki, tasks: Tasks, boards: Boards, nodes: Nodes, sheets: Sheets, surveys: Surveys };

export function ServiceMockup({ service, label }: { service: string; label: string }) {
  const Screen = SCREENS[service] ?? Wiki;
  return (
    <Frame label={label}>
      <Screen />
    </Frame>
  );
}
