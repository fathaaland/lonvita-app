"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = ["Proč Lonvita", "Co děláme", "Kdo jsme"] as const;

// The BrandWave's shape redrawn as three identical crests, so each step fills an equal third of
// the stroke (pathLength=1 → dashoffset 2/3, 1/3, 0 lands exactly on a node).
const WAVE = "M8 30 C72 -2 136 62 200 30 S328 -2 392 30 S520 62 584 30";
const NODES_X = [200, 392, 584];

/** Where the stroke's end lands per step — pathLength 1 split into three equal crests. */
function WaveProgress({ step, onSelect }: { step: number; onSelect: (i: number) => void }) {
  return (
    <nav aria-label="Kroky úvodu" className="w-full max-w-[36rem]">
      <svg viewBox="0 0 592 60" className="w-full h-auto overflow-visible" aria-hidden="true">
        <path d={WAVE} pathLength={1} fill="none" stroke="hsl(var(--border))" strokeWidth={6} strokeLinecap="round" />
        <path
          d={WAVE}
          pathLength={1}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray="1 1"
          strokeDashoffset={1 - (step + 1) / STEPS.length}
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
        {NODES_X.map((x, i) => (
          <circle
            key={x}
            cx={x}
            cy={30}
            r={i === step ? 11 : 7}
            fill={i <= step ? "hsl(var(--primary))" : "hsl(var(--background))"}
            stroke={i <= step ? "hsl(var(--primary))" : "hsl(var(--border))"}
            strokeWidth={4}
            className="transition-all duration-500 motion-reduce:transition-none"
          />
        ))}
      </svg>
      <ol className="mt-2 grid grid-cols-3">
        {STEPS.map((label, i) => (
          <li key={label} className="text-right">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "text-sm transition-colors",
                i === step ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="tabular-nums">{i + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const headline = "font-medium tracking-[-0.05em] leading-[1.02] text-4xl sm:text-5xl lg:text-6xl";
const subhead = "font-medium tracking-[-0.04em] leading-tight text-2xl sm:text-3xl";

function Aside({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:col-span-4 lg:col-start-9 border-t border-border pt-5 text-muted-foreground leading-relaxed">
      {children}
    </div>
  );
}

function WhyStep() {
  return (
    <div className="mt-12 grid gap-8 border-t border-border pt-8 sm:grid-cols-[auto_1fr] sm:gap-12 lg:mt-16">
      <p className="font-medium tracking-[-0.05em] leading-none text-6xl sm:text-7xl text-primary">
        každý druhý
      </p>
      <div className="max-w-md text-muted-foreground leading-relaxed">
        <p>
          obyvatel Česka bude v druhé polovině století starší 50 let. Už dnes jde o 4,4 milionu lidí — a právě
          starší dospělí jsou nejvíc ohroženi osamělostí.
        </p>
        <p className="mt-3 text-xs">Zdroj: ČSÚ, projekce obyvatelstva; Eurostat, EUROPOP2025.</p>
      </div>
    </div>
  );
}

const ROLES = [
  { who: "Obyvatel", what: "Najde aktivity podle svých zájmů a jedním klepnutím se přihlásí." },
  { who: "Pořadatel", what: "Vytvoří akci, spravuje registrace a vidí, jak se plní." },
  { who: "Obec", what: "Vidí data o zapojení obyvatel a spravuje místní pořadatele." },
];

const PRESCRIPTION = ["Lékař, sociální pracovník nebo úředník", "Doporučí konkrétní komunitní aktivitu", "Člověk ji najde v nabídce obce na Lonvitě"];

function WhatStep() {
  return (
    <div className="mt-12 grid gap-5 lg:mt-16 lg:grid-cols-2">
      <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        <h2 className={subhead}>Komunitní modul</h2>
        <p className="mt-1 text-sm text-muted-foreground">Vývoj 2026, ostrý provoz od 2027</p>
        <p className="mt-4 max-w-prose leading-relaxed">
          Jedno místo pro akce, výlety, sport, kulturu i dobrovolnictví. Funguje pro malou obec stejně jako pro
          velké město.
        </p>
        <dl className="mt-6 divide-y divide-border border-t border-border">
          {ROLES.map((r) => (
            <div key={r.who} className="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
              <dt className="font-semibold text-primary">{r.who}</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{r.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Dashed, not solid: this module doesn't exist yet — the border says "outline of a plan". */}
      <section className="rounded-3xl border border-dashed border-primary/50 p-6 sm:p-8">
        <h2 className={subhead}>Intervenční modul</h2>
        <p className="mt-1 text-sm text-muted-foreground">Připravujeme, dlouhodobá vize</p>
        <p className="mt-4 max-w-prose leading-relaxed">
          Sociální předepisování: místo předpisu na lék dostane člověk doporučení, kam zajít a s kým se potkat —
          jako prevence osamělosti i doplněk léčby.
        </p>
        <ol className="mt-6 space-y-2">
          {PRESCRIPTION.map((s, i) => (
            <li key={s} className="flex items-start gap-3 text-sm leading-relaxed">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary tabular-nums">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

const TEAM = [
  { name: "Vojtěch Dvořák", bio: "Regionální rozvoj, inovace a evaluace veřejných politik. Zkušenost z přímé práce s obcemi a evropskými projekty." },
  { name: "David Dobrovolný", bio: "Stojí za technickým vývojem platformy, od prvního prototypu po ostrý provoz." },
];

const PARTNERS = [
  { name: "Menší obce v zázemí", text: "Připojí se k platformě větší obce jako součást mikroregionu, bez budování vlastního řešení." },
  { name: "Soukromí pořadatelé", text: "Spolky, kluby i jednotlivci nabízejí své akce i mimo přímou správu obce." },
];

function WhoStep() {
  return (
    <div className="mt-12 lg:mt-16">
      <div className="grid gap-8 sm:grid-cols-2 sm:gap-12">
        {TEAM.map((p) => (
          <div key={p.name}>
            <h2 className={subhead}>{p.name}</h2>
            <p className="mt-1 text-sm font-semibold text-primary">Spoluzakladatel</p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{p.bio}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-14 text-lg font-semibold tracking-tight">S kým chceme spolupracovat</h2>
      <div className="mt-4 grid gap-5 lg:grid-cols-[1.3fr_1fr_1fr]">
        <div className="rounded-3xl bg-primary p-6 text-primary-foreground sm:p-8">
          <h3 className="font-medium tracking-[-0.05em] text-4xl text-primary-foreground">Obce</h3>
          <p className="mt-3 leading-relaxed text-primary-foreground/90">
            Modul přizpůsobený své velikosti, přehled o zapojení obyvatel a nástroje pro správu vlastních aktivit.
          </p>
        </div>
        {PARTNERS.map((p) => (
          <div key={p.name} className="border-t-2 border-foreground/80 pt-4">
            <h3 className="text-lg font-semibold tracking-tight">{p.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const CONTENT = [
  {
    title: "Komunitní život potřebuje infrastrukturu, ne jen dobrou vůli.",
    aside:
      "Obce chtějí, aby lidé žili aktivněji a víc se potkávali. Chybí jim ale nástroj, který propojí pořadatele, nabídku aktivit a ukáže, co skutečně funguje.",
    body: <WhyStep />,
  },
  {
    title: "Lonvita stojí na dvou modulech.",
    aside: "Komunitní modul vyvíjíme už dnes — právě ho používáte. Intervenční modul je naše dlouhodobá vize.",
    body: <WhatStep />,
  },
  {
    title: "Kdo za Lonvitou stojí.",
    aside:
      "Lonvita vychází z praktické zkušenosti s prací s obcemi a z dlouhodobého zájmu o regionální rozvoj a aktivní život obyvatel.",
    body: <WhoStep />,
  },
];

/**
 * Three-step introduction a signed-out visitor sees on `/` before picking an obec — replaces the
 * old "map straight away" landing. Copy condensed from lonvita.cz. `onBrowse` opens the map.
 */
export function LonvitaIntro({ onBrowse }: { onBrowse: () => void }) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const last = step === STEPS.length - 1;
  const { title, aside, body } = CONTENT[step];

  // Moves focus (and screen readers) to the new step's heading — but not on page load, where
  // stealing focus from the top of the document would be disorienting.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  return (
    <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-6xl flex-col px-4 pt-6 sm:pt-10">
      <div className="flex items-start justify-between gap-6">
        <WaveProgress step={step} onSelect={setStep} />
        {!last && (
          <Button variant="link" onClick={onBrowse} className="shrink-0 px-0 text-muted-foreground">
            Přeskočit úvod
          </Button>
        )}
      </div>

      <article className="mt-10 sm:mt-14">
        <div className="grid gap-6 lg:grid-cols-12">
          <h1 ref={headingRef} tabIndex={-1} className={cn(headline, "lg:col-span-7 focus:outline-none")}>
            {title}
          </h1>
          <Aside>{aside}</Aside>
        </div>
        {body}
      </article>

      <div className="sticky bottom-0 mt-auto -mx-4 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:mt-12 sm:border-0 sm:bg-transparent sm:px-0 sm:py-10 sm:backdrop-blur-none">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => s - 1)}
          className={cn("gap-1 pl-2", step === 0 && "invisible")}
        >
          <ChevronLeft /> Zpět
        </Button>
        {last ? (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="lg" className="px-4 sm:px-6">
              <Link href="/auth?mode=signup">Zaregistrovat se</Link>
            </Button>
            <Button size="lg" onClick={onBrowse} className="px-4 sm:px-6">
              Vybrat obec na mapě
            </Button>
          </div>
        ) : (
          <Button size="lg" onClick={() => setStep((s) => s + 1)} className="gap-2 px-6">
            Pokračovat <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}
