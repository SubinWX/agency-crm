import { redirect } from "next/navigation";
import { getActor, PORTAL_HOME } from "@/server/auth/session";

/** Portal-neutral link used in notifications: forwards to the right portal's work page. */
export default async function WorkRedirect({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/");
  const { id } = await params;
  redirect(`${PORTAL_HOME[actor.portal]}/works/${encodeURIComponent(id)}`);
}
