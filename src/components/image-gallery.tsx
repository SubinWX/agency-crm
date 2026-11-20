"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import type { ActionResult } from "@/server/lib/errors";
import { ActionForm, SubmitButton } from "./action-form";
import { ImageInput } from "./image-input";

export type GalleryImage = { src: string; caption?: string | null; meta?: string | null; badge?: string | null; id?: string };

type ImgAction = (id: string, p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

/** Small dialog used for replacing / removing an image right from its thumbnail. */
function EditDialog({ mode, img, edit, onClose }: { mode: "replace" | "remove"; img: GalleryImage; edit: { replace: ImgAction; remove: ImgAction }; onClose: () => void }) {
  const action = (mode === "replace" ? edit.replace : edit.remove).bind(null, img.id!);
  useEffect(() => {
    // Esc closes — unless the crop window is open on top.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[aria-label="Crop image"][role="dialog"]') && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.src} alt="" className="h-16 w-16 rounded-lg object-cover" />
          <div className="flex-1">
            <p className="font-semibold">{mode === "replace" ? "Replace image" : "Remove image"}</p>
            <p className="text-xs text-slate-500">{mode === "replace" ? "The current image is kept in history." : "It's hidden from the work but kept in history."}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <ActionForm action={async (p, fd) => { const r = await action(p, fd); if (r.ok) setTimeout(onClose, 600); return r; }} className="space-y-3">
          {mode === "replace" && <ImageInput name="image" required label="Choose new image" />}
          <input name="reason" required className="input" placeholder={mode === "replace" ? "Reason for replacing *" : "Reason for removing *"} autoFocus={mode === "remove"} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <SubmitButton className={mode === "replace" ? "btn-primary" : "btn-danger"} pendingText={mode === "replace" ? "Uploading…" : "Removing…"}>{mode === "replace" ? "Replace" : "Remove"}</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}

/** Thumbnail grid + lightbox with zoom, next/previous, full screen and download. */
export function ImageGallery({
  images,
  allowDownload = true,
  edit,
}: {
  images: GalleryImage[];
  allowDownload?: boolean;
  /** When given, each thumbnail shows Replace / Remove buttons (images need an `id`). */
  edit?: { replace: ImgAction; remove: ImgAction };
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ mode: "replace" | "remove"; img: GalleryImage } | null>(null);
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
          <div key={img.src} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            <button type="button" onClick={() => setOpen(i)} className="h-full w-full" aria-label={`Open image ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.caption ?? "Work image"} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
            </button>
            {img.badge && <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">{img.badge}</span>}
            {edit && img.id && (
              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button type="button" onClick={() => setEditing({ mode: "replace", img })} className="rounded-md bg-white/95 p-1.5 text-slate-700 shadow hover:bg-white" aria-label={`Replace image ${i + 1}`} title="Replace">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setEditing({ mode: "remove", img })} className="rounded-md bg-white/95 p-1.5 text-red-600 shadow hover:bg-white" aria-label={`Remove image ${i + 1}`} title="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && edit && <EditDialog mode={editing.mode} img={editing.img} edit={edit} onClose={() => setEditing(null)} />}

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
