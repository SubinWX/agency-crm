import { NotificationsList } from "@/components/notifications-list";
import { requirePortal } from "@/server/auth/session";
export const metadata = { title: "Alerts" };
export default async function Page() {
  const actor = await requirePortal("WORKER");
  return <NotificationsList actor={actor} />;
}
