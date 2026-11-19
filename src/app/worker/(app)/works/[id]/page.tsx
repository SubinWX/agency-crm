import { notFound } from "next/navigation";
import { WorkDetailView } from "@/components/work-detail";
import { requirePortal } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getWorkDetail } from "@/server/modules/works/queries";

export default async function WorkerWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePortal("WORKER");
  const { id } = await params;
  const detail = await getWorkDetail(actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  return <WorkDetailView actor={actor} detail={detail} backHref="/worker" />;
}
