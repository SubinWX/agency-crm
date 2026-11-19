import { createItemAction } from "@/app/actions/inventory";
import { ItemForm } from "@/components/item-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listCategories, listSuppliers } from "@/server/modules/inventory/catalog";

export const metadata = { title: "Add item" };

export default async function NewItemPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "inventory.manage");
  const { kind } = await searchParams;
  const [suppliers, categories] = await Promise.all([listSuppliers(actor), listCategories()]);
  return (
    <>
      <PageHeader title="Add product or raw material" subtitle="Stock is added per branch from the item page." />
      <Card className="max-w-3xl">
        <ItemForm action={createItemAction} suppliers={suppliers} categories={categories} submitLabel="Create item" defaultKind={kind === "RAW_MATERIAL" ? "RAW_MATERIAL" : "PRODUCT"} />
      </Card>
    </>
  );
}
