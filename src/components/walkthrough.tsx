"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";

export type WalkthroughShot = { step: number; src: string; device: "desktop" | "phone" };

/**
 * Guide steps with screenshots: thumbnails next to each step, plus a
 * click-through walk-through (← → keys, autoplay) in a full-screen viewer.
 */
export function Walkthrough({ title, steps, shots }: { title: string; steps: string[]; shots: WalkthroughShot[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const slides = shots.filter((s) => s.step <= steps.length);
  const shotFor = (step: number) => slides.find((s) => s.step === step);

  const close = useCallback(() => {
    setOpen(null);
    setPlaying(false);
  }, []);
  const go = useCallback((d: number) => setOpen((i) => (i === null ? i : Math.min(slides.length - 1, Math.max(0, i + d)))), [slides.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close, go]);

  useEffect(() => {
    if (!playing || open === null) return;
    if (open >= slides.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => go(1), 5000);
    return () => clearTimeout(t);
  }, [playing, open, slides.length, go]);

  const cur = open !== null ? slides[open] : null;

  return (
    <>
      {slides.length > 0 && (
        <button type="button" onClick={() => { setOpen(0); setPlaying(true); }} className="btn-primary mb-4 rounded-full px-5">
          <Play className="h-4 w-4" /> Play walk-through · {slides.length} step{slides.length === 1 ? "" : "s"}
        </button>
      )}
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const shot = shotFor(i + 1);
          return (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <span className="pt-0.5">{s}</span>
                {shot && (
                  <button type="button" onClick={() => setOpen(slides.indexOf(shot))} className="group relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm hover:border-blue-400" aria-label={`Show step ${i + 1} screenshot`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.src} alt="" loading="lazy" className={shot.device === "phone" ? "h-28 w-auto" : "h-24 w-auto sm:h-24"} />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">🔍</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {cur && open !== null && (
        <div role="dialog" aria-modal="true" aria-label={`${title} walk-through`} className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white" onClick={close}>
          <div className="flex items-center justify-between gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
            <p className="truncate text-sm font-medium">{title}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPlaying((p) => !p)} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
                {playing ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Auto-play</>}
              </button>
              <button type="button" onClick={close} className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-14" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={cur.src}
              src={cur.src}
              alt={`Step ${cur.step}`}
              className={`max-h-full rounded-xl object-contain shadow-2xl ring-1 ring-white/10 ${cur.device === "phone" ? "max-w-[min(360px,100%)] rounded-[2rem] ring-8 ring-slate-800" : "max-w-full"}`}
            />
            <button type="button" onClick={() => go(-1)} disabled={open === 0} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2.5 hover:bg-white/30 disabled:opacity-20" aria-label="Previous step"><ChevronLeft className="h-6 w-6" /></button>
            <button type="button" onClick={() => go(1)} disabled={open === slides.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2.5 hover:bg-white/30 disabled:opacity-20" aria-label="Next step"><ChevronRight className="h-6 w-6" /></button>
          </div>

          <div className="px-4 pb-5 pt-4" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto max-w-3xl">
              <p className="flex gap-3 text-base">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold">{cur.step}</span>
                <span className="pt-0.5">{steps[cur.step - 1]}</span>
              </p>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-xs text-white/60">Step {open + 1} of {slides.length}</span>
                <div className="flex flex-1 gap-1.5">
                  {slides.map((s, i) => (
                    <button key={s.src} type="button" onClick={() => setOpen(i)} aria-label={`Go to step ${s.step}`} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                      <span className={`block h-full rounded-full bg-blue-500 ${i < open ? "w-full" : i === open ? (playing ? "animate-[walkthrough_5s_linear_forwards]" : "w-full") : "w-0"}`} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
