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


function Slides() {
  return (
    <div className="grid h-[calc(100%-2rem)] grid-cols-[22%_1fr] gap-4">
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`aspect-video rounded-lg ${i === 1 ? "ring-2 ring-rose-300/70" : ""} bg-white/[0.07]`} />
        ))}
      </div>
      <div className="flex flex-col justify-center gap-4 rounded-2xl bg-gradient-to-br from-rose-400/15 via-purple-500/10 to-transparent p-6">
        <span className="h-4 w-2/3 rounded-full bg-white/80" />
        {line("50%", 0.3)}
        <div className="mt-2 flex items-end gap-2">
          {[45, 70, 55, 90, 65].map((h, i) => (
            <span key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-rose-400/60 to-purple-300/80" style={{ height: h }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Chat() {
  const messages = [
    [false, "70%"],
    [true, "55%"],
    [false, "40%"],
    [true, "65%"],
  ] as const;
  return (
    <div className="grid h-[calc(100%-2rem)] grid-cols-[28%_1fr] gap-4">
      <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-3">
        {["#", "#", "#", "@", "@"].map((mark, i) => (
          <span key={i} className={`flex items-center gap-2 rounded-md px-1 py-0.5 ${i === 1 ? "bg-white/10" : ""}`}>
            <span className="text-[11px] text-cyan-200/70">{mark}</span>
            {line(`${40 + ((i * 13) % 40)}%`, 0.25)}
          </span>
        ))}
      </div>
      <div className="flex flex-col justify-end gap-3">
        {messages.map(([mine, w], i) => (
          <div key={i} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
            <span className={`h-6 w-6 shrink-0 rounded-full ${mine ? "bg-indigo-300/60" : "bg-cyan-300/50"}`} />
            <span className={`rounded-2xl px-3 py-2.5 ${mine ? "bg-gradient-to-r from-cyan-500/50 to-indigo-500/50" : "bg-white/[0.08]"}`} style={{ width: w }}>
              {line("90%", 0.35)}
              {i === 2 && <span className="mt-1.5 inline-block rounded-full bg-white/10 px-1.5 text-[10px]">👍 3</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Files() {
  const tiles = ["bg-amber-300/60", "bg-sky-300/60", "bg-rose-300/60", "bg-emerald-300/60", "bg-violet-300/60", "bg-orange-300/60"];
  return (
    <div className="flex h-[calc(100%-2rem)] flex-col gap-4">
      <div className="flex items-center gap-2">
        {line("20%", 0.35)}
        <span className="text-white/30">›</span>
        {line("15%", 0.25)}
      </div>
      <div className="grid flex-1 grid-cols-3 gap-3">
        {tiles.map((color, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-2xl bg-white/[0.06] p-3">
            <span className={`h-8 w-10 rounded-md ${color} ${i < 2 ? "rounded-tl-none" : ""}`} />
            {line("80%", 0.3)}
            {line("45%", 0.15)}
          </div>
        ))}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full w-[38%] rounded-full bg-gradient-to-r from-yellow-300 to-orange-400" />
      </div>
    </div>
  );
}


function Calendar() {
  const events: Record<number, string> = { 2: "bg-sky-400/60", 8: "bg-violet-400/60", 10: "bg-emerald-400/60", 15: "bg-amber-400/60", 16: "bg-amber-400/60", 17: "bg-amber-400/60", 23: "bg-rose-400/60" };
  return (
    <div className="flex h-[calc(100%-2rem)] flex-col gap-2">
      <div className="flex items-center gap-2">
        {line("25%", 0.4)}
        <span className="ml-auto h-6 w-16 rounded-full bg-gradient-to-r from-cyan-400/60 to-blue-500/60" />
      </div>
      <div className="grid flex-1 grid-cols-7 gap-1.5">
        {Array.from({ length: 28 }, (_, i) => (
          <div key={i} className={`flex flex-col gap-1 rounded-lg p-1.5 ${i === 9 ? "ring-1 ring-sky-300/70" : ""} bg-white/[0.05]`}>
            <span className="h-1 w-3 rounded-full bg-white/30" />
            {events[i] && <span className={`h-2 rounded ${events[i]}`} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Meet() {
  const tiles = ["from-sky-400/40 to-indigo-500/30", "from-emerald-400/40 to-teal-500/30", "from-rose-400/40 to-purple-500/30", "from-amber-300/40 to-orange-500/30"];
  return (
    <div className="flex h-[calc(100%-2rem)] flex-col gap-3">
      <div className="grid flex-1 grid-cols-2 gap-3">
        {tiles.map((g, i) => (
          <div key={i} className={`relative flex items-center justify-center rounded-2xl bg-gradient-to-br ${g} ${i === 0 ? "ring-2 ring-sky-300/70" : ""}`}>
            <span className="h-10 w-10 rounded-full bg-white/25" />
            <span className="absolute bottom-2 left-2 h-1.5 w-12 rounded-full bg-white/40" />
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-3">
        {["bg-white/15", "bg-white/15", "bg-white/15", "bg-rose-500/80"].map((c, i) => (
          <span key={i} className={`h-8 w-8 rounded-full ${c}`} />
        ))}
      </div>
    </div>
  );
}

const SCREENS: Record<string, () => React.ReactElement> = { wiki: Wiki, tasks: Tasks, boards: Boards, nodes: Nodes, sheets: Sheets, surveys: Surveys, slides: Slides, chat: Chat, files: Files, calendar: Calendar, meet: Meet };

export function ServiceMockup({ service, label }: { service: string; label: string }) {
  const Screen = SCREENS[service] ?? Wiki;
  return (
    <Frame label={label}>
      <Screen />
    </Frame>
  );
}
