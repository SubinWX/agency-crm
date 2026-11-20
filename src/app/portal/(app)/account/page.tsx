import { AccountPage } from "@/components/account-page";
import { requirePortal } from "@/server/auth/session";

export const metadata = { title: "My profile" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requirePortal("CUSTOMER");
  const { tab } = await searchParams;
  return <AccountPage actor={actor} base="/portal/account" tab={tab} />;
}
