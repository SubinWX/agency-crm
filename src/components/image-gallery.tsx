"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GalleryImage = { src: string; caption?: string | null; meta?: string | null; badge?: string | null };

/** Thumbnail grid + lightbox with zoom, next/previous, full screen and download. */
export function ImageGallery({ images, allowDownload = true }: { images: GalleryImage[]; allowDownload?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [zoom, setZoom] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(null);
    setZoom(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  const step = useCallback((n: number) => {
    setZoom(false);
    setOpen((i) => (i === null ? i : (i + n + images.length) % images.length));
  }, [images.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (images.length === 0) return <p className="text-sm text-slate-500">No images.</p>;
  const cur = open !== null ? images[open] : null;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((img, i) => (
          <button key={img.src} type="button" onClick={() => setOpen(i)} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.src} alt={img.caption ?? "Work image"} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
            {img.badge && <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">{img.badge}</span>}
          </button>
        ))}
      </div>

      {cur && (
        <div ref={boxRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" onClick={close}>
          <div className="flex items-center justify-between gap-2 p-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <span className="truncate">
              {open! + 1} / {images.length} {cur.caption ? `· ${cur.caption}` : ""}
            </span>
            <div className="flex shrink-0 gap-2">
              <button type="button" className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={() => setZoom((z) => !z)}>{zoom ? "Fit" : "Zoom"}</button>
              <button type="button" className="hidden rounded bg-white/10 px-3 py-1.5 hover:bg-white/20 sm:block" onClick={() => boxRef.current?.requestFullscreen?.().catch(() => {})}>Full screen</button>
              {allowDownload && <a className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20" href={`${cur.src}?download=1`}>Download</a>}
              <button type="button" className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={close} aria-label="Close">✕</button>
            </div>
          </div>
          <div className={`relative flex flex-1 items-center justify-center ${zoom ? "overflow-auto" : "overflow-hidden"}`} onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cur.src}
              alt={cur.caption ?? "Work image"}
              onClick={() => setZoom((z) => !z)}
              className={zoom ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
              style={zoom ? { width: "200%" } : undefined}
            />
            {images.length > 1 && (
              <>
                <button type="button" onClick={() => step(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2 text-xl hover:bg-white/30" aria-label="Previous">‹</button>
                <button type="button" onClick={() => step(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2 text-xl hover:bg-white/30" aria-label="Next">›</button>
              </>
            )}
          </div>
          {cur.meta && <p className="p-3 text-center text-xs text-white/70" onClick={(e) => e.stopPropagation()}>{cur.meta}</p>}
        </div>
      )}
    </>
  );
}
