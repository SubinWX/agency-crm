import { notFound } from "next/navigation";
import { WorkDetailView } from "@/components/work-detail";
import { requirePortal } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getWorkDetail } from "@/server/modules/works/queries";

export default async function AgentWorkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requirePortal("AGENT");
  const { id } = await params;
  const detail = await getWorkDetail(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const { created } = await searchParams;
  return (
    <>
      {created && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Work submitted successfully.</div>}
      <WorkDetailView actor={actor} detail={detail} backHref="/agent" />
    </>
  );
}
