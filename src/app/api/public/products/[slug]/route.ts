import { getPublicProduct } from "@/server/modules/inventory/catalog";
import { json, options, publicBase } from "../cors";

export const dynamic = "force-dynamic";

/** GET /api/public/products/<slug> — one product shown on the website. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getPublicProduct(publicBase(req), slug.toLowerCase());
  return product ? json(product) : json({ error: "Product not found" }, 404);
}
export const OPTIONS = options;
