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

/** Validate (type by content, size) and store an uploaded file. Images always; PDF when allowed. */
export async function storeFile(file: UploadInput, folder: string, opts: { allowPdf?: boolean } = {}): Promise<StoredFile> {
  if (!file || file.size === 0) throw invalid("Please choose a file.");
  if (file.size > MAX_IMAGE_BYTES) throw invalid("File is too large (max 10 MB).");
  const buf = Buffer.from(await file.arrayBuffer());
  let mime = sniffImage(buf);
  let ext = mime ? IMAGE_TYPES[mime] : null;
  if (!mime && opts.allowPdf && buf.subarray(0, 5).toString("ascii") === "%PDF-") {
    mime = "application/pdf";
    ext = "pdf";
  }
  if (!mime || !ext) throw invalid(opts.allowPdf ? "Only images (JPG, PNG, WEBP, HEIC) or PDF files are allowed." : "Only JPG, PNG, WEBP or HEIC images are allowed.");
  const key = `${folder}/${randomUUID()}.${ext}`;
  await storage().put(key, buf, mime);
  return { storageKey: key, originalName: file.name.slice(0, 200) || "file", mimeType: mime, sizeBytes: buf.length };
}

/** Validate (type by content, size) and store an uploaded image. */
export function storeImage(file: UploadInput, folder: string): Promise<StoredFile> {
  return storeFile(file, folder);
}
