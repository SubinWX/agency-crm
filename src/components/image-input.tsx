"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Crop, ImagePlus, RotateCw, X } from "lucide-react";

type Item = { id: string; file: File; url: string | null; isImage: boolean };

const ASPECTS: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "Square", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
];

const isRaster = (f: File) => /^image\/(jpeg|png|webp|gif|bmp)$/.test(f.type);

/** Downscale a photo in the browser before upload (saves mobile data). Keeps the original if it can't be read. */
async function shrink(file: File, maxEdge: number): Promise<File> {
  if (!isRaster(file) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 2 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const keepAlpha = file.type === "image/png";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, keepAlpha ? "image/png" : "image/jpeg", 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, keepAlpha ? ".png" : ".jpg"), { type: blob.type });
  } catch {
    return file;
  }
}

async function cropToFile(item: Item, area: Area, rotation: number): Promise<File> {
  const bmp = await createImageBitmap(item.file, { imageOrientation: "from-image" });
  // Draw the rotated image, then cut the selected area out of it.
  const rad = (rotation * Math.PI) / 180;
  const bw = Math.abs(Math.cos(rad) * bmp.width) + Math.abs(Math.sin(rad) * bmp.height);
  const bh = Math.abs(Math.sin(rad) * bmp.width) + Math.abs(Math.cos(rad) * bmp.height);
  const rotated = document.createElement("canvas");
  rotated.width = bw;
  rotated.height = bh;
  const rc = rotated.getContext("2d")!;
  rc.translate(bw / 2, bh / 2);
  rc.rotate(rad);
  rc.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  const out = document.createElement("canvas");
  out.width = Math.round(area.width);
  out.height = Math.round(area.height);
  out.getContext("2d")!.drawImage(rotated, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  const png = item.file.type === "image/png";
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, png ? "image/png" : "image/jpeg", 0.9));
  if (!blob) return item.file;
  return new File([blob], item.file.name.replace(/\.[^.]+$/, png ? ".png" : ".jpg"), { type: blob.type });
}

/**
 * Image picker with preview, crop / rotate and in-browser shrinking. The
 * chosen (and edited) files are put into a hidden file input with `name`, so
 * the surrounding form submits them as usual. Non-images (PDF, SVG) pass
 * through untouched. The server optimises everything again on upload.
 */
export function ImageInput({
  name,
  multiple = false,
  accept = "image/*",
  required = false,
  capture,
  aspect,
  maxFiles = 10,
  maxEdge = 2000,
  label = multiple ? "Add photos" : "Choose image",
  hint,
}: {
  name: string;
  multiple?: boolean;
  accept?: string;
  required?: boolean;
  capture?: "environment" | "user";
  /** Lock the crop shape (e.g. 1 for profile pictures). */
  aspect?: number;
  maxFiles?: number;
  maxEdge?: number;
  label?: string;
  hint?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [shape, setShape] = useState<number | null>(aspect ?? null);
  const [natural, setNatural] = useState(4 / 3);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Keep the hidden input's files in sync with the list.
  useEffect(() => {
    if (!hidden.current) return;
    const dt = new DataTransfer();
    items.forEach((i) => dt.items.add(i.file));
    hidden.current.files = dt.files;
  }, [items]);

  // Clear when the form is reset after a successful save.
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const onReset = () => setItems([]);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  useEffect(() => () => items.forEach((i) => i.url && URL.revokeObjectURL(i.url)), [items]);

  const add = useCallback(
    async (list: FileList | null) => {
      if (!list?.length) return;
      setBusy(true);
      const picked = Array.from(list).slice(0, multiple ? maxFiles : 1);
      const prepared = await Promise.all(
        picked.map(async (f) => {
          const file = await shrink(f, maxEdge);
          const img = isRaster(file);
          return { id: crypto.randomUUID(), file, url: img ? URL.createObjectURL(file) : null, isImage: img };
        }),
      );
      setItems((prev) => (multiple ? [...prev, ...prepared].slice(0, maxFiles) : prepared));
      setBusy(false);
      if (picker.current) picker.current.value = "";
      // Single image with a fixed shape (e.g. profile picture): open the cropper straight away.
      if (!multiple && aspect && prepared[0]?.isImage) openCrop(prepared[0]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [multiple, maxFiles, maxEdge, aspect],
  );

  function openCrop(item: Item) {
    setEditing(item);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setShape(aspect ?? null);
    const img = new Image();
    img.onload = () => setNatural(img.naturalWidth / img.naturalHeight || 4 / 3);
    img.src = item.url!;
  }

  async function applyCrop() {
    if (!editing || !area) return;
    setBusy(true);
    const file = await cropToFile(editing, area, rotation);
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== editing.id) return i;
        if (i.url) URL.revokeObjectURL(i.url);
        return { ...i, file, url: URL.createObjectURL(file) };
      }),
    );
    setEditing(null);
    setBusy(false);
  }

  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div>
      <input ref={hidden} type="file" name={name} multiple={multiple} className="sr-only" tabIndex={-1} aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary cursor-pointer">
          <ImagePlus className="h-4 w-4" /> {busy ? "Preparing…" : items.length && !multiple ? "Change" : label}
          <input
            ref={picker}
            type="file"
            accept={accept}
            multiple={multiple}
            capture={capture}
            required={required && items.length === 0}
            onChange={(e) => add(e.target.files)}
            className="sr-only"
          />
        </label>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>

      {items.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {items.map((i) => (
            <li key={i.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {i.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.url} alt="" className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square items-center justify-center p-2 text-center text-xs font-medium text-slate-600">{i.file.name}</div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{kb(i.file.size)}</span>
              <div className="absolute right-1 top-1 flex gap-1">
                {i.isImage && (
                  <button type="button" onClick={() => openCrop(i)} className="rounded-md bg-white/90 p-1 text-slate-700 shadow hover:bg-white" aria-label="Crop image">
                    <Crop className="h-3.5 w-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))} className="rounded-md bg-white/90 p-1 text-red-600 shadow hover:bg-white" aria-label="Remove">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && editing.url && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="Crop image">
          <div className="relative flex-1">
            <Cropper
              image={editing.url}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={shape ?? natural}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, px) => setArea(px)}
              objectFit="contain"
            />
          </div>
          <div className="space-y-3 bg-white p-4">
            {!aspect && (
              <div className="flex flex-wrap gap-2">
                {ASPECTS.map((a) => (
                  <button key={a.label} type="button" onClick={() => setShape(a.value)} className={`rounded-full px-3 py-1 text-sm ${shape === a.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-12 text-xs text-slate-500">Zoom</span>
              <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" aria-label="Zoom" />
              <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} className="btn-secondary px-3" aria-label="Rotate 90 degrees">
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              <button type="button" onClick={applyCrop} disabled={busy || !area} className="btn-primary">{busy ? "Cropping…" : "Apply crop"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
