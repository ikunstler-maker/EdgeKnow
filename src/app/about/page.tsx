import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { PreferencesSwitch } from "@/components/prefs/preferences-switch";
import { AnglerFish } from "@/components/angler/angler-fish";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t.landing.title, description: t.landing.description };
}

const section = "mx-auto w-full max-w-6xl px-4 md:px-8";
const button = "inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-medium transition";

// The presentation page of EdgeKnow: open to everyone (it holds no team data),
// and where someone not signed in lands. In both languages, like the rest.
export default async function AboutPage() {
  const l = t.landing;
  const central = await createClient();
  const { data } = await central.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const go = signedIn ? { href: "/", label: l.open } : { href: "/login", label: l.signIn };

  return (
    <div className="flex min-h-dvh flex-col bg-background" data-landing>
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className={`${section} flex h-14 items-center gap-4`}>
          <Link href="/about" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">E</span>
            {l.brand}
          </Link>
          <nav className="hidden flex-1 items-center gap-5 text-sm text-muted md:flex" aria-label={l.title}>
            <a href="#services" className="hover:text-foreground">
              {l.nav.services}
            </a>
            <a href="#together" className="hover:text-foreground">
              {l.nav.together}
            </a>
            <a href="#security" className="hover:text-foreground">
              {l.nav.security}
            </a>
            <a href="#start" className="hover:text-foreground">
              {l.nav.start}
            </a>
          </nav>
          <span className="flex-1 md:hidden" />
          <div className="hidden sm:block">
            <PreferencesSwitch compact />
          </div>
          <Link href={go.href} className={`${button} min-h-9 bg-foreground px-4 text-background hover:opacity-90`}>
            {go.label}
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(60rem_30rem_at_70%_-10%,color-mix(in_oklab,var(--accent)_22%,transparent),transparent),radial-gradient(40rem_24rem_at_0%_20%,rgba(139,124,246,0.16),transparent)]" />
          <div className={`${section} relative grid items-center gap-10 py-16 md:grid-cols-[1.05fr_1fr] md:py-24`}>
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {l.badge}
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight md:text-5xl">{l.hero}</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{l.lead}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={go.href} className={`${button} bg-accent text-white shadow-lg shadow-accent/25 hover:opacity-90`} data-landing-start>
                  {signedIn ? l.open : l.primary} →
                </Link>
                <a href="#services" className={`${button} border border-border bg-background hover:bg-surface`}>
                  {l.secondary}
                </a>
              </div>
            </div>
            <Preview />
          </div>
          <div className={`${section} relative pb-12`}>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {l.stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-border bg-background/80 p-4">
                  <dt className="text-2xl font-bold tracking-tight">{stat.value}</dt>
                  <dd className="mt-1 text-sm text-muted">{stat.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Services */}
        <section id="services" className="scroll-mt-16 border-t border-border bg-surface/50 py-16 md:py-24">
          <div className={section}>
            <h2 className="text-3xl font-bold tracking-tight">{l.servicesTitle}</h2>
            <p className="mt-3 max-w-2xl text-muted">{l.servicesLead}</p>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {l.services.map((service) => (
                <article key={service.name} className="flex flex-col rounded-2xl border border-border bg-background p-5 shadow-sm" data-landing-service={service.name}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-2xl" aria-hidden="true">
                      {service.icon}
                    </span>
                    <div>
                      <h3 className="font-semibold">{service.name}</h3>
                      <p className="text-xs text-muted">{service.like}</p>
                    </div>
                  </div>
                  <ul className="mt-4 flex flex-col gap-2 text-sm">
                    {service.points.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span className="mt-0.5 text-accent" aria-hidden="true">
                          ✓
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {l.upcoming.map((service) => (
                <article key={service.name} className="rounded-2xl border border-dashed border-border bg-background/60 p-5">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden="true">
                      {service.icon}
                    </span>
                    <h3 className="font-semibold">{service.name}</h3>
                    <span className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">{l.soon}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{service.like}</p>
                  <p className="mt-3 text-sm text-muted">{service.about}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Together */}
        <section id="together" className="scroll-mt-16 py-16 md:py-24">
          <div className={section}>
            <h2 className="text-3xl font-bold tracking-tight">{l.togetherTitle}</h2>
            <p className="mt-3 max-w-2xl text-muted">{l.togetherLead}</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {l.together.map((item) => (
                <div key={item.title} className="rounded-2xl border border-border p-5">
                  <span className="text-3xl" aria-hidden="true">
                    {item.icon}
                  </span>
                  <h3 className="mt-3 font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-16 bg-[#0f172a] py-16 text-white md:py-24">
          <div className={section}>
            <h2 className="text-3xl font-bold tracking-tight">{l.securityTitle}</h2>
            <p className="mt-3 max-w-2xl text-slate-300">{l.securityLead}</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {l.security.map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <span className="text-2xl" aria-hidden="true">
                    {item.icon}
                  </span>
                  <h3 className="mt-3 font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comfort */}
        <section className="py-16">
          <div className={section}>
            <h2 className="text-2xl font-bold tracking-tight">{l.comfortTitle}</h2>
            <ul className="mt-6 flex flex-wrap gap-2">
              {l.comfort.map((item) => (
                <li key={item} className="rounded-full border border-border bg-surface px-4 py-2 text-sm">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Start */}
        <section id="start" className="scroll-mt-16 border-t border-border bg-surface/50 py-16 md:py-24">
          <div className={section}>
            <h2 className="text-3xl font-bold tracking-tight">{l.startTitle}</h2>
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {l.steps.map((step, i) => (
                <li key={step.title} className="rounded-2xl border border-border bg-background p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">{i + 1}</span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{step.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-12 flex flex-col items-center gap-4 rounded-3xl bg-gradient-to-br from-accent to-violet-500 px-6 py-12 text-center text-white">
              <div className="h-14 w-16">
                <AnglerFish className="h-full w-full" />
              </div>
              <h2 className="text-3xl font-bold">{l.ctaTitle}</h2>
              <p className="max-w-xl text-white/85">{l.ctaText}</p>
              <Link href={go.href} className={`${button} bg-white text-slate-900 hover:bg-white/90`}>
                {go.label} →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className={`${section} flex flex-wrap items-center gap-4 text-sm text-muted`}>
          <span>{l.footer.made}</span>
          <span className="flex-1" />
          <Link href="/help" className="hover:text-foreground">
            {l.footer.help}
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            {l.footer.privacy}
          </Link>
          <div className="sm:hidden">
            <PreferencesSwitch compact />
          </div>
        </div>
      </footer>
    </div>
  );
}

// A small drawing of the app (not a screenshot): the sidebar, a page with a
// table, a chart and a survey embedded, so a visitor sees how it fits together.
function Preview() {
  const services = ["📚", "✅", "🎨", "🧠", "📊", "📝"];
  const bars = [62, 88, 45, 74];
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-lg">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-accent/25 via-violet-400/15 to-transparent blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 h-4 flex-1 rounded bg-surface" />
        </div>
        <div className="grid grid-cols-[7rem_1fr] text-[10px]">
          <div className="flex flex-col gap-2 border-r border-border bg-surface/60 p-2">
            <div className="flex flex-wrap gap-1">
              {services.map((icon) => (
                <span key={icon} className="flex h-5 w-5 items-center justify-center rounded bg-background text-[11px]">
                  {icon}
                </span>
              ))}
            </div>
            {[70, 55, 80, 40, 65].map((w, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-accent/50" />
                <span className="h-1.5 rounded bg-border" style={{ width: `${w}%` }} />
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-2 p-3">
            <span className="h-3 w-2/3 rounded bg-foreground/80" />
            <span className="h-1.5 w-full rounded bg-border" />
            <span className="h-1.5 w-5/6 rounded bg-border" />
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border p-1.5">
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm bg-border">
                  {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} className={`h-2.5 ${i < 3 ? "bg-accent/20" : "bg-background"}`} />
                  ))}
                </div>
              </div>
              <div className="flex items-end gap-1 rounded-md border border-border p-1.5">
                {bars.map((h, i) => (
                  <span key={i} className="flex-1 rounded-t bg-accent" style={{ height: `${h * 0.45}px`, opacity: 0.55 + i * 0.12 }} />
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border p-2">
              <span className="block h-1.5 w-1/2 rounded bg-foreground/60" />
              {[0, 1].map((i) => (
                <span key={i} className="mt-1.5 flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full border ${i === 0 ? "border-accent bg-accent" : "border-muted"}`} />
                  <span className="h-1.5 w-1/3 rounded bg-border" />
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              {["bg-amber-200", "bg-sky-200", "bg-rose-200"].map((color) => (
                <span key={color} className={`h-6 flex-1 rounded-sm ${color} shadow-sm`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
