/**
 * File storage abstraction (spec §46, §62, §78). Development uses the local
 * disk; production should plug in an S3-compatible provider implementing the
 * same interface. Files are never served statically — they go through an
 * authenticated route that checks access first.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { invalid } from "../lib/errors";

export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalDiskStorage implements StorageProvider {
  constructor(private root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  get(key: string) {
    return readFile(this.resolve(key));
  }
}

let provider: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (!provider) provider = new LocalDiskStorage(process.env.UPLOAD_DIR || "./uploads");
  return provider;
}
/** Test hook. */
export function setStorageProvider(p: StorageProvider) {
  provider = p;
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface UploadInput {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Check magic bytes so a renamed non-image can't pass as an image. */
function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

export interface StoredFile {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ImageOptions {
  /** Longest side in pixels after optimisation (default 2000). */
  maxEdge?: number;
  /** Output format: webp (default, smallest) or png (keeps transparency; needed for PDF logos). */
  format?: "webp" | "png";
  /** Crop to a centred square (avatars). */
  square?: boolean;
}

/**
 * Shrink and re-encode an uploaded image: fix camera rotation, cap the size,
 * strip metadata (incl. GPS) and convert to WebP. Falls back to the original
 * bytes if the image can't be decoded (e.g. some HEIC files).
 */
export async function optimizeImage(buf: Buffer, mime: string, o: ImageOptions = {}): Promise<{ buf: Buffer; mime: string; ext: string }> {
  try {
    const { default: sharp } = await import("sharp");
    const edge = o.maxEdge ?? 2000;
    let img = sharp(buf, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
    img = o.square ? img.resize(edge, edge, { fit: "cover", position: "attention" }) : img.resize(edge, edge, { fit: "inside", withoutEnlargement: true });
    const out = o.format === "png" ? await img.png({ compressionLevel: 9, palette: true }).toBuffer() : await img.webp({ quality: 80, effort: 4 }).toBuffer();
    const outMime = o.format === "png" ? "image/png" : "image/webp";
    // Keep the original only if it is already smaller and in the same format.
    if (out.length >= buf.length && mime === outMime) return { buf, mime, ext: IMAGE_TYPES[mime] };
    return { buf: out, mime: outMime, ext: o.format === "png" ? "png" : "webp" };
  } catch {
    return { buf, mime, ext: IMAGE_TYPES[mime] };
  }
}

/** Validate (type by content, size) and store an uploaded file. Images are optimised; PDF allowed when asked. */
export async function storeFile(file: UploadInput, folder: string, opts: { allowPdf?: boolean; image?: ImageOptions } = {}): Promise<StoredFile> {
  if (!file || file.size === 0) throw invalid("Please choose a file.");
  if (file.size > MAX_IMAGE_BYTES * 2) throw invalid("File is too large (max 20 MB).");
  let buf: Buffer = Buffer.from(await file.arrayBuffer());
  let mime = sniffImage(buf);
  let ext = mime ? IMAGE_TYPES[mime] : null;
  if (!mime && opts.allowPdf && buf.subarray(0, 5).toString("ascii") === "%PDF-") {
    if (buf.length > MAX_IMAGE_BYTES) throw invalid("PDF is too large (max 10 MB).");
    mime = "application/pdf";
    ext = "pdf";
  } else if (mime) {
    const o = await optimizeImage(buf, mime, opts.image);
    buf = o.buf;
    mime = o.mime;
    ext = o.ext;
    if (buf.length > MAX_IMAGE_BYTES) throw invalid("Image is too large even after compression (max 10 MB).");
  }
  if (!mime || !ext) throw invalid(opts.allowPdf ? "Only images (JPG, PNG, WEBP, HEIC) or PDF files are allowed." : "Only JPG, PNG, WEBP or HEIC images are allowed.");
  const key = `${folder}/${randomUUID()}.${ext}`;
  await storage().put(key, buf, mime);
  const base = (file.name.slice(0, 200) || "file").replace(/\.[a-z0-9]+$/i, "");
  return { storageKey: key, originalName: mime === "application/pdf" ? file.name.slice(0, 200) : `${base}.${ext}`, mimeType: mime, sizeBytes: buf.length };
}

/** Validate (type by content, size) and store an uploaded image. */
export function storeImage(file: UploadInput, folder: string, image?: ImageOptions): Promise<StoredFile> {
  return storeFile(file, folder, { image });
}

// ───────────────────────────── Logos (incl. SVG) ─────────────────────────────

const MAX_SVG_BYTES = 1024 * 1024;
/** Anything that could run code or load external content inside an SVG. */
const UNSAFE_SVG = /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|<!DOCTYPE|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["'](?!#|data:image\/(?:png|jpe?g|webp);base64,)/i;

export function isSvg(buf: Buffer) {
  const head = buf.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}

/** Reject SVGs with scripts, event handlers, external references or entity tricks. */
export function assertSafeSvg(buf: Buffer) {
  if (buf.length > MAX_SVG_BYTES) throw invalid("SVG logo is too large (max 1 MB).");
  const text = buf.toString("utf8");
  if (!isSvg(buf)) throw invalid("That file is not a valid SVG.");
  if (UNSAFE_SVG.test(text)) throw invalid("This SVG contains scripts or external links and can't be used. Export it again as a plain SVG.");
}

/**
 * Store a company logo. SVG is kept as-is (after safety checks) for the app,
 * and a PNG copy is rendered for invoice PDFs. Raster logos are optimised to PNG.
 */
export async function storeLogo(file: UploadInput): Promise<{ logoKey: string; logoPdfKey: string }> {
  if (!file || file.size === 0) throw invalid("Choose a logo file.");
  const buf = Buffer.from(await file.arrayBuffer());
  const { default: sharp } = await import("sharp");
  if (isSvg(buf)) {
    assertSafeSvg(buf);
    let png: Buffer;
    try {
      png = await sharp(buf, { density: 300 }).resize(800, 800, { fit: "inside", withoutEnlargement: false }).png({ compressionLevel: 9 }).toBuffer();
    } catch {
      throw invalid("This SVG could not be read. Try exporting it again.");
    }
    const id = randomUUID();
    await storage().put(`branding/${id}.svg`, buf, "image/svg+xml");
    await storage().put(`branding/${id}.png`, png, "image/png");
    return { logoKey: `branding/${id}.svg`, logoPdfKey: `branding/${id}.png` };
  }
  const mime = sniffImage(buf);
  if (!mime) throw invalid("Logo must be SVG, PNG, JPG or WEBP.");
  if (buf.length > MAX_IMAGE_BYTES) throw invalid("Logo is too large (max 10 MB).");
  const o = await optimizeImage(buf, mime, { maxEdge: 800, format: "png" });
  if (o.mime !== "image/png" && o.mime !== "image/jpeg") throw invalid("This logo format can't be used on invoices. Please upload SVG, PNG or JPG.");
  const key = `branding/${randomUUID()}.${o.ext}`;
  await storage().put(key, o.buf, o.mime);
  return { logoKey: key, logoPdfKey: key };
}
