import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { PreferencesSwitch } from "@/components/prefs/preferences-switch";
import { AnglerFish } from "@/components/angler/angler-fish";
import { CountUp, HeroZoom, Reveal, ServiceTour, SoonBadge } from "@/components/landing/motion";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t.landing.title, description: t.landing.description };
}

const wrap = "mx-auto w-full max-w-[1120px] px-5 md:px-8";
const pill = "inline-flex min-h-11 items-center justify-center rounded-full px-6 text-[15px] font-medium transition";
const eyebrow = "text-sm font-semibold uppercase tracking-[0.18em] text-white/45";
const title = "whitespace-pre-line text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] md:text-7xl";

// A generated picture (Gemini), in two sizes for ordinary and sharp screens.
function Picture({ name, alt, className = "", priority = false }: { name: string; alt: string; className?: string; priority?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- fixed, already optimised WebP files
    <img
      src={`/landing/${name}-1600.webp`}
      srcSet={`/landing/${name}-800.webp 800w, /landing/${name}-1600.webp 1600w`}
      sizes="(min-width: 1120px) 1120px, 100vw"
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}

// The presentation page of EdgeKnow: open to everyone (it holds no team data),
// and where someone not signed in lands. Always dark, like a product launch;
// in both languages.
export default async function AboutPage() {
  const l = t.landing;
  const central = await createClient();
  const { data } = await central.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const go = signedIn ? { href: "/", label: l.open } : { href: "/login", label: l.signIn };

  return (
    <div className="ek-landing flex min-h-dvh flex-col" data-landing>
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-black/55 backdrop-blur-xl backdrop-saturate-150">
        <div className={`${wrap} flex h-12 items-center gap-6 text-[13px]`}>
          <Link href="/about" className="flex items-center gap-2 font-semibold text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-sky-400 to-violet-500 text-[11px] font-bold">E</span>
            {l.brand}
          </Link>
          <nav className="hidden flex-1 items-center justify-center gap-7 text-white/70 md:flex" aria-label={l.title}>
            <a href="#services" className="hover:text-white">
              {l.nav.services}
            </a>
            <a href="#ai" className="hover:text-white">
              {l.nav.ai}
            </a>
            <a href="#together" className="hover:text-white">
              {l.nav.together}
            </a>
            <a href="#security" className="hover:text-white">
              {l.nav.security}
            </a>
            <a href="#compare" className="hover:text-white">
              {l.nav.compare}
            </a>
          </nav>
          <span className="flex-1 md:hidden" />
          <PreferencesSwitch compact languageOnly />
          <Link href={go.href} className="rounded-full bg-white px-3.5 py-1.5 font-medium text-black hover:bg-white/90">
            {go.label}
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden pt-32 md:pt-40">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[80vh] bg-[radial-gradient(50rem_28rem_at_50%_0%,rgba(99,102,241,0.28),transparent)]" />
          <div className={`${wrap} relative text-center`}>
            <Reveal>
              <p className={eyebrow}>{l.eyebrow}</p>
              <h1 className={`${title} mx-auto mt-5 md:text-8xl`}>
                <span className="ek-gradient-text">{l.hero}</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/65 md:text-[22px]">{l.lead}</p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <Link href={go.href} className={`${pill} bg-white text-black hover:bg-white/90`} data-landing-start>
                  {signedIn ? l.open : l.primary}
                </Link>
                <a href="#services" className={`${pill} text-sky-300 hover:text-sky-200`}>
                  {l.secondary} ›
                </a>
              </div>
            </Reveal>
          </div>
          <div className={`${wrap} relative mt-14 md:mt-20`}>
            <HeroZoom>
              <Picture name="hero" alt="" priority className="w-full" />
            </HeroZoom>
          </div>
        </section>

        {/* Numbers */}
        <section className="py-24 md:py-36">
          <div className={`${wrap} grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-4`}>
            {l.stats.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 100}>
                <p className="text-5xl font-semibold tracking-tight text-white md:text-6xl">
                  <CountUp value={stat.value} suffix={stat.suffix} />
                </p>
                <p className="mt-3 max-w-[14rem] text-[15px] leading-snug text-white/55">{stat.label}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Services */}
        <section id="services" className="scroll-mt-12 pb-24 md:pb-36">
          <div className={wrap}>
            <Reveal className="mb-6 max-w-3xl md:mb-10">
              <p className={eyebrow}>{l.servicesEyebrow}</p>
              <h2 className={`${title} ek-grad-a mt-4`}>{l.servicesTitle}</h2>
            </Reveal>
            <ServiceTour services={l.services} soon={l.soon} />
          </div>
        </section>

        {/* AI assistant */}
        <section id="ai" className="relative scroll-mt-12 overflow-hidden bg-[#06060a] py-28 md:py-40">
          <div className={wrap}>
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className={eyebrow}>
                {l.aiEyebrow}
                <SoonBadge label={l.soon} />
              </p>
              <h2 className={`${title} ek-grad-c mt-4`}>{l.aiTitle}</h2>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/60 md:text-xl">{l.aiLead}</p>
            </Reveal>
            <Reveal className="mt-10">
              <Picture name="ai" alt="" className="mx-auto w-full max-w-3xl" />
            </Reveal>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {l.ai.map((item, i) => (
                <Reveal key={item.title} delay={(i % 3) * 100}>
                  <div className="ek-glass h-full rounded-3xl p-6">
                    <h3 className="bg-gradient-to-r from-cyan-200 to-fuchsia-300 bg-clip-text text-lg font-bold text-transparent">{item.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-white/60">{item.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Together */}
        <section id="together" className="scroll-mt-12 bg-[#0b0b0f] py-28 md:py-40">
          <div className={wrap}>
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className={eyebrow}>{l.togetherEyebrow}</p>
              <h2 className={`${title} ek-grad-b mt-4`}>{l.togetherTitle}</h2>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/60 md:text-xl">{l.togetherLead}</p>
            </Reveal>
            <Reveal className="mt-16">
              <Picture name="connect" alt="" className="mx-auto w-full max-w-4xl" />
            </Reveal>
            <div className="mx-auto mt-14 grid max-w-4xl gap-4 md:grid-cols-3">
              {l.flow.map((step, i) => (
                <Reveal key={step} delay={i * 150}>
                  <div className="ek-glass flex h-full items-center gap-4 rounded-3xl p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-sm font-semibold">{i + 1}</span>
                    <span className="text-[17px] font-medium">{step}</span>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal className="mx-auto mt-24 max-w-3xl text-center">
              <h3 className="ek-grad-c text-3xl font-semibold tracking-tight md:text-5xl">{l.searchTitle}</h3>
              <p className="mt-5 text-lg text-white/60">{l.searchText}</p>
              <div className="ek-glass mx-auto mt-10 flex max-w-xl items-center gap-3 rounded-full px-6 py-4 text-left text-white/50">
                <span aria-hidden="true">🔎</span>
                <span className="flex-1">
                  <span className="block h-2 w-2/3 rounded-full bg-white/25" />
                </span>
                <span className="rounded-md border border-white/15 px-1.5 text-xs">⌘K</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Knowledge people trust */}
        <section className="py-28 md:py-40">
          <div className={wrap}>
            <Reveal className="max-w-3xl">
              <p className={eyebrow}>{l.trustEyebrow}</p>
              <h2 className={`${title} ek-grad-e mt-4`}>{l.trustTitle}</h2>
              <p className="mt-6 max-w-xl text-lg text-white/60">{l.trustLead}</p>
            </Reveal>
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {l.trust.map((item, i) => (
                <Reveal key={item.title} delay={(i % 3) * 100}>
                  <div className="ek-glass h-full rounded-3xl p-6">
                    <h3 className="text-lg font-semibold">
                      {item.title}
                      {item.soon && <SoonBadge label={l.soon} />}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-white/60">{item.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section className="bg-[#0b0b0f] py-28 md:py-36">
          <div className={wrap}>
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className={eyebrow}>
                {l.connectEyebrow}
                <SoonBadge label={l.soon} />
              </p>
              <h2 className={`${title} ek-grad-b mt-4`}>{l.connectTitle}</h2>
            </Reveal>
            <Reveal className="mt-12">
              <ul className="mx-auto flex max-w-4xl flex-wrap justify-center gap-3">
                {l.integrations.map((name) => (
                  <li key={name} className="ek-glass rounded-full px-5 py-2.5 text-[15px] text-white/80">
                    {name}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal className="mx-auto mt-14 max-w-3xl">
              <div className="ek-glass rounded-[28px] p-8 text-center">
                <h3 className="text-2xl font-semibold md:text-3xl">
                  {l.publicTitle}
                  <SoonBadge label={l.soon} />
                </h3>
                <p className="mt-3 text-lg text-white/60">{l.publicText}</p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-12 py-28 md:py-40">
          <div className={`${wrap} grid items-center gap-12 md:grid-cols-2`}>
            <Reveal>
              <p className={eyebrow}>{l.securityEyebrow}</p>
              <h2 className={`${title} ek-grad-d mt-4`}>{l.securityTitle}</h2>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-white/60">{l.securityLead}</p>
            </Reveal>
            <Reveal delay={150}>
              <Picture name="security" alt="" className="w-full" />
            </Reveal>
          </div>
          <div className={`${wrap} mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
            {l.security.map((item, i) => (
              <Reveal key={item.title} delay={(i % 3) * 100}>
                <div className="ek-glass h-full rounded-3xl p-6">
                  <h3 className="text-lg font-semibold">
                    {item.title}
                    {item.soon && <SoonBadge label={l.soon} />}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/60">{item.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Devices */}
        <section className="bg-[#0b0b0f] py-28 md:py-40">
          <div className={wrap}>
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className={eyebrow}>{l.devicesEyebrow}</p>
              <h2 className={`${title} ek-grad-c mt-4`}>{l.devicesTitle}</h2>
              <p className="mx-auto mt-6 max-w-xl text-lg text-white/60">{l.devicesLead}</p>
            </Reveal>
            <Reveal className="mt-16">
              <Picture name="devices" alt="" className="w-full" />
            </Reveal>
          </div>
        </section>

        {/* Compare */}
        <section id="compare" className="scroll-mt-12 py-28 md:py-40">
          <div className={wrap}>
            <Reveal className="max-w-3xl">
              <p className={eyebrow}>{l.compareEyebrow}</p>
              <h2 className={`${title} ek-grad-e mt-4`}>{l.compareTitle}</h2>
              <p className="mt-6 max-w-xl text-lg text-white/60">{l.compareLead}</p>
            </Reveal>
            <Reveal className="mt-14">
              <div className="ek-glass overflow-hidden rounded-[28px]">
                <table className="w-full text-left text-[15px]" data-landing-compare>
                  <thead className="text-xs uppercase tracking-wider text-white/45">
                    <tr className="border-b border-white/10">
                      <th className="px-5 py-4 font-medium md:px-8">{l.compareKind}</th>
                      <th className="hidden px-5 py-4 font-medium sm:table-cell">{l.compareUsual}</th>
                      <th className="px-5 py-4 text-right font-medium md:px-8">{l.brand}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.compareRows.map((row) => (
                      <tr key={row.kind} className="border-b border-white/5 last:border-0">
                        <td className="px-5 py-4 font-medium md:px-8">
                          {row.kind}
                          <span className="mt-0.5 block text-sm font-normal text-white/45 sm:hidden">{row.usual}</span>
                        </td>
                        <td className="hidden px-5 py-4 text-white/50 sm:table-cell">{row.usual}</td>
                        <td className="px-5 py-4 text-right md:px-8">
                          {row.soon ? (
                            <SoonBadge label={l.soon} />
                          ) : (
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-sm">✓</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-white/35">{l.compareNote}</p>
            </Reveal>
          </div>
        </section>

        {/* Steps */}
        <section className="py-28 md:py-36">
          <div className={wrap}>
            <Reveal>
              <h2 className="ek-grad-a text-4xl font-semibold tracking-tight md:text-6xl">{l.stepsTitle}</h2>
            </Reveal>
            <ol className="mt-14 grid gap-10 md:grid-cols-3">
              {l.steps.map((step, i) => (
                <Reveal key={step.title} delay={i * 120}>
                  <li className="border-t border-white/15 pt-6">
                    <span className="ek-gradient-text text-5xl font-semibold">{i + 1}</span>
                    <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-white/60">{step.text}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Finale */}
        <section className="relative overflow-hidden py-32 md:py-44">
          <Picture name="finale" alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-b from-black via-black/30 to-black" aria-hidden="true" />
          <Reveal className={`${wrap} relative flex flex-col items-center text-center`}>
            <div className="h-16 w-20">
              <AnglerFish className="h-full w-full" />
            </div>
            <h2 className={`${title} ek-grad-a mt-6`}>{l.ctaTitle}</h2>
            <p className="mt-5 max-w-lg text-lg text-white/65">{l.ctaText}</p>
            <Link href={go.href} className={`${pill} mt-9 bg-white text-black hover:bg-white/90`}>
              {go.label}
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8 text-[13px] text-white/45">
        <div className={`${wrap} flex flex-wrap items-center gap-5`}>
          <span>{l.footer.made}</span>
          <span className="flex-1" />
          <Link href="/help" className="hover:text-white">
            {l.footer.help}
          </Link>
          <Link href="/privacy" className="hover:text-white">
            {l.footer.privacy}
          </Link>
        </div>
      </footer>
    </div>
  );
}
