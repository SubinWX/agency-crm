import { MyCommissions } from "@/components/my-commissions";
import { requirePagePermission } from "@/server/auth/session";
export const metadata = { title: "My commission" };
export default async function Page() {
  const actor = await requirePagePermission("AGENT", "commissions.view_own");
  return <MyCommissions actor={actor} workHref={(id) => `/agent/works/${id}`} />;
}
