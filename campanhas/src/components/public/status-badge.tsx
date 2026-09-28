import { CAMPAIGN_STATUS_LABEL } from "@/lib/labels";

const STYLE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-900",
  PAUSED: "bg-amber-100 text-amber-900",
  CLOSED: "bg-stone-200 text-stone-800",
  FROZEN: "bg-blue-100 text-blue-900",
  DRAWN: "bg-brand-100 text-brand-800",
  CANCELLED: "bg-red-100 text-red-900",
  DRAFT: "bg-stone-200 text-stone-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STYLE[status] ?? STYLE.DRAFT}`}>{CAMPAIGN_STATUS_LABEL[status] ?? status}</span>;
}
