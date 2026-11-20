import { PeopleList } from "@/components/people";
import { requirePagePermission } from "@/server/auth/session";
import { listAccessibleBranches } from "@/server/modules/branches/service";
import { listPeople } from "@/server/modules/people/service";

export const metadata = { title: "Workers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; branchId?: string; status?: string }> }) {
  const actor = await requirePagePermission("ADMIN", "users.manage");
  const sp = await searchParams;
  const [rows, branches] = await Promise.all([listPeople(actor, "WORKER", sp), listAccessibleBranches(actor)]);
  return <PeopleList kind="WORKER" rows={rows} branches={branches} sp={sp} />;
}
