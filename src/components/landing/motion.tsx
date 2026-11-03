"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ServiceMockup } from "./mockups";

// Movement on the presentation page, all driven by scrolling and all off for
// people who asked their system for less motion (then everything just shows).

const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fades and rises into view once.
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    if (calm()) {
      element.dataset.shown = "";
      return;
    }
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          element.dataset.shown = "";
          seen.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    seen.observe(element);
    return () => seen.disconnect();
  }, []);
  return (
    <div ref={box} className={`ek-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// The hero picture grows from a smaller tilted view to full size while the hero scrolls by.
export function HeroZoom({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || calm()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, 1 - rect.top / window.innerHeight));
      element.style.setProperty("--zoom", String(progress));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={box} className="ek-hero-zoom" data-hero-zoom>
      {children}
    </div>
  );
}

// A number that counts up to its value when it comes into view.
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const element = box.current;
    if (!element || calm() || value === 0) return;
    let frame = 0;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1200);
        setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      setShown(0);
      frame = requestAnimationFrame(step);
    });
    seen.observe(element);
    return () => {
      seen.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <span ref={box} data-count={value}>
      {shown}
      {suffix}
    </span>
  );
}

type Service = { key: string; icon: string; name: string; like: string; soon: boolean; headline: string; points: string[] };

// Each service's own colours, for its headline.
export const SERVICE_GRADIENTS: Record<string, string> = {
  wiki: "from-sky-300 to-blue-500",
  tasks: "from-emerald-300 to-teal-500",
  boards: "from-amber-300 to-pink-500",
  nodes: "from-violet-300 to-fuchsia-500",
  sheets: "from-lime-300 to-emerald-500",
  surveys: "from-orange-300 to-rose-500",
  slides: "from-rose-300 to-purple-500",
  chat: "from-cyan-300 to-indigo-500",
  files: "from-yellow-200 to-orange-500",
};

export function SoonBadge({ label }: { label: string }) {
  return <span className="ml-2 inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">{label}</span>;
}

// The six services: the screen stays in place while the text beside it scrolls;
// the screen changes to the service being read. On a phone, one after another.
export function ServiceTour({ services, soon }: { services: Service[]; soon: string }) {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const item of items.current) if (item) seen.observe(item);
    return () => seen.disconnect();
  }, []);
  return (
    <div className="grid gap-10 md:grid-cols-[1fr_1.15fr] md:gap-16">
      <div>
        {services.map((service, i) => (
          <article
            key={service.key}
            ref={(el) => {
              items.current[i] = el;
            }}
            data-index={i}
            data-landing-service={service.name}
            className={`flex flex-col justify-center py-10 transition-opacity duration-500 md:min-h-[72vh] ${active === i ? "opacity-100" : "md:opacity-30"}`}
          >
            <p className="text-sm font-medium text-white/50">
              <span aria-hidden="true">{service.icon}</span> {service.name} · {service.like}
              {service.soon && <SoonBadge label={soon} />}
            </p>
            <h3 className={`mt-3 bg-gradient-to-r bg-clip-text pb-1 text-3xl font-bold tracking-tight text-transparent md:text-5xl ${SERVICE_GRADIENTS[service.key] ?? "from-white to-white"}`}>{service.headline}</h3>
            <ul className="mt-6 flex flex-col gap-3 text-lg text-white/70">
              {service.points.map((point) => (
                <li key={point} className="flex gap-3">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-sky-300 to-violet-400" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-8 aspect-[4/3] md:hidden">
              <ServiceMockup service={service.key} label={service.name} />
            </div>
          </article>
        ))}
      </div>
      <div className="relative hidden md:block">
        <div className="sticky top-[14vh] aspect-[4/3.2]">
          <div aria-hidden="true" className="absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.28),transparent)] blur-2xl" />
          {services.map((service, i) => (
            <div key={service.key} className={`absolute inset-0 transition-all duration-700 ${active === i ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"}`} data-tour-screen={service.key}>
              <ServiceMockup service={service.key} label={service.name} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
