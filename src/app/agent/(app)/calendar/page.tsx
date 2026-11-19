import { AvailabilityPicker } from "@/components/availability-picker";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { businessToday } from "@/server/lib/dates";

export const metadata = { title: "Availability" };

export default async function AgentCalendar() {
  await requirePagePermission("AGENT", "calendar.view");
  return (
    <>
      <PageHeader title="Availability" subtitle="Company-wide slots per day" />
      <div className="max-w-md"><AvailabilityPicker today={businessToday()} /></div>
    </>
  );
}
