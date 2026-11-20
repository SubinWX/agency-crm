import { HelpPage } from "@/components/help-page";
import { requirePortal } from "@/server/auth/session";

export const metadata = { title: "Help & tutorials" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePortal("ADMIN");
  const { q } = await searchParams;
  return <HelpPage actor={actor} q={q} />;
}
