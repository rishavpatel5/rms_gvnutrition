import { Gift } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { BillingLine } from "@/stores/billing-store";
import { useBillingStore } from "@/stores/billing-store";

type Props = {
  line: BillingLine;
};

/** Compact inline "Free" toggle — sits on the same row as the qty stepper. */
export function PosLineGiveaway({ line }: Props) {
  const setLineGiveaway = useBillingStore((s) => s.setLineGiveaway);

  return (
    <label
      htmlFor={`giveaway-${line.id}`}
      className={cn(
        "flex cursor-pointer items-center gap-2 text-xs font-medium",
        line.isGiveaway ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      <Gift className="size-3.5" />
      Giveaway
      <Switch
        id={`giveaway-${line.id}`}
        checked={line.isGiveaway}
        onCheckedChange={(checked) => setLineGiveaway(line.id, checked)}
      />
    </label>
  );
}

/** Reason box shown full-width once the line is marked as a giveaway. */
export function PosLineGiveawayReason({ line }: Props) {
  const setLineGiveawayReason = useBillingStore((s) => s.setLineGiveawayReason);
  if (!line.isGiveaway) return null;
  return (
    <Input
      type="text"
      placeholder="Giveaway reason (optional)"
      value={line.giveawayReason ?? ""}
      onChange={(e) => setLineGiveawayReason(line.id, e.target.value)}
      className="h-9 rounded-lg text-sm"
    />
  );
}
