import { listPublicProducts } from "@/server/modules/inventory/catalog";
import { json, options, publicBase } from "./cors";

export const dynamic = "force-dynamic";

/** GET /api/public/products[?category=…] — products marked "Show on website". */
export async function GET(req: Request) {
  const category = new URL(req.url).searchParams.get("category")?.trim() || undefined;
  const products = await listPublicProducts(publicBase(req), category);
  return json({ count: products.length, products });
}
export const OPTIONS = options;
