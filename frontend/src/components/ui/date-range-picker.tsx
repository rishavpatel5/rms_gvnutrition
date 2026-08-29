import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type DateRange,
  type DateRangePreset,
  formatDisplayDate,
  getAccountingPresets,
  getTodayIst,
  parseYmd,
  toYmd,
} from "@/lib/date-presets";

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  align?: "left" | "right";
  showTaxPresets?: boolean;
};

export function DateRangePicker({
  value,
  onChange,
  className = "",
  align = "left",
  showTaxPresets = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Temporary selection state
  const [tempFrom, setTempFrom] = useState(value.from);
  const [tempTo, setTempTo] = useState(value.to);
  const [selectingStep, setSelectingStep] = useState<"from" | "to">("from");
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Calendar month state
  const initialMonth = useMemo(() => {
    const d = value.to ? parseYmd(value.to) : getTodayIst();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, [value.to]);

  const [currentMonth, setCurrentMonth] = useState<Date>(initialMonth);

  // Sync temp state with incoming value when opened
  useEffect(() => {
    if (open) {
      setTempFrom(value.from);
      setTempTo(value.to);
      setSelectingStep("from");
      if (value.to) {
        const d = parseYmd(value.to);
        setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
      }
    }
  }, [open, value]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const presets = useMemo(() => getAccountingPresets(), []);

  // Determine active preset label
  const activePreset = useMemo(() => {
    return presets.find((p) => {
      const r = p.getRange();
      return r.from === value.from && r.to === value.to;
    });
  }, [presets, value]);

  const handleApply = () => {
    let finalFrom = tempFrom;
    let finalTo = tempTo;
    if (finalFrom > finalTo) {
      const swap = finalFrom;
      finalFrom = finalTo;
      finalTo = swap;
    }
    onChange({ from: finalFrom, to: finalTo });
    setOpen(false);
  };

  const handlePresetSelect = (preset: DateRangePreset) => {
    const range = preset.getRange();
    setTempFrom(range.from);
    setTempTo(range.to);
    onChange(range);
    setOpen(false);
  };

  const handleDayClick = (dayYmd: string) => {
    if (selectingStep === "from") {
      setTempFrom(dayYmd);
      setTempTo(dayYmd);
      setSelectingStep("to");
    } else {
      if (dayYmd < tempFrom) {
        setTempTo(tempFrom);
        setTempFrom(dayYmd);
      } else {
        setTempTo(dayYmd);
      }
      setSelectingStep("from");
    }
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  // Calendar Day Grid Computation
  const monthData = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: { ymd: string; dayNum: number; isCurrentMonth: boolean }[] = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevM = month === 0 ? 11 : month - 1;
      const prevY = month === 0 ? year - 1 : year;
      const ymd = `${prevY}-${String(prevM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ ymd, dayNum: d, isCurrentMonth: false });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ ymd, dayNum: d, isCurrentMonth: true });
    }

    // Next month padding
    const remaining = 35 - days.length >= 0 ? 35 - days.length : 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const nextM = month === 11 ? 0 : month + 1;
      const nextY = month === 11 ? year + 1 : year;
      const ymd = `${nextY}-${String(nextM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ ymd, dayNum: d, isCurrentMonth: false });
    }

    return {
      monthName: currentMonth.toLocaleString("en-IN", { month: "long", year: "numeric" }),
      days,
    };
  }, [currentMonth]);

  const todayYmd = toYmd(getTodayIst());

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <CalendarIcon className="size-4 text-primary" />
        <span className="tabular-nums">
          {formatDisplayDate(value.from)} – {formatDisplayDate(value.to)}
        </span>
        {activePreset ? (
          <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-medium">
            {activePreset.label}
          </Badge>
        ) : null}
      </button>

      {/* Popover Card */}
      {open && (
        <div
          className={`absolute z-50 mt-2 max-w-[calc(100vw-2rem)] w-[490px] rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl transition-all duration-150 animate-in fade-in-0 zoom-in-95 ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ maxWidth: "min(490px, 94vw)" }}
        >
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Left Column: Quick Presets */}
            <div className="w-full sm:w-[155px] space-y-3 sm:border-r sm:pr-3 border-border/70">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="size-3" /> Quick Presets
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-1 gap-0.5">
                  {presets
                    .filter((p) => p.category === "standard")
                    .map((preset) => {
                      const range = preset.getRange();
                      const isSelected = tempFrom === range.from && tempTo === range.to;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => handlePresetSelect(preset)}
                          className={`rounded-md px-2 py-1 text-left text-xs font-medium transition-colors ${
                            isSelected
                              ? "bg-primary text-primary-foreground font-semibold"
                              : "text-foreground hover:bg-muted"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                </div>
              </div>

              {showTaxPresets ? (
                <div className="space-y-1 pt-1 border-t sm:border-t-0 border-border/70">
                  <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Sparkles className="size-3 text-amber-500" /> GST / Financial
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-0.5">
                    {presets
                      .filter((p) => p.category === "tax")
                      .map((preset) => {
                        const range = preset.getRange();
                        const isSelected = tempFrom === range.from && tempTo === range.to;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => handlePresetSelect(preset)}
                            className={`rounded-md px-2 py-1 text-left text-xs font-medium transition-colors ${
                              isSelected
                                ? "bg-primary text-primary-foreground font-semibold"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right Column: Visual Calendar & Inputs */}
            <div className="flex-1 space-y-3 min-w-0">
              {/* Month Navigation */}
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-foreground">
                  {monthData.monthName}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full hover:bg-muted"
                    onClick={prevMonth}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full hover:bg-muted"
                    onClick={nextMonth}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
                <span>Su</span>
                <span>Mo</span>
                <span>Tu</span>
                <span>We</span>
                <span>Th</span>
                <span>Fr</span>
                <span>Sa</span>
              </div>

              {/* Day Grid */}
              <div className="grid grid-cols-7 gap-y-1 gap-x-0.5">
                {monthData.days.map(({ ymd, dayNum, isCurrentMonth }) => {
                  const isToday = ymd === todayYmd;
                  const isFrom = ymd === tempFrom;
                  const isTo = ymd === tempTo;

                  const effectiveHover = hoverDate || tempTo;
                  const inRange =
                    tempFrom &&
                    effectiveHover &&
                    ymd >= (tempFrom < effectiveHover ? tempFrom : effectiveHover) &&
                    ymd <= (tempFrom < effectiveHover ? effectiveHover : tempFrom);

                  const isRangeStart = isFrom || (inRange && ymd === (tempFrom < effectiveHover ? tempFrom : effectiveHover));
                  const isRangeEnd = isTo || (inRange && ymd === (tempFrom < effectiveHover ? effectiveHover : tempFrom));

                  return (
                    <div
                      key={ymd}
                      className={`relative flex items-center justify-center p-0 ${
                        inRange ? "bg-primary/10" : ""
                      } ${isRangeStart ? "rounded-l-md" : ""} ${isRangeEnd ? "rounded-r-md" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => handleDayClick(ymd)}
                        onMouseEnter={() => {
                          if (selectingStep === "to") setHoverDate(ymd);
                        }}
                        onMouseLeave={() => setHoverDate(null)}
                        className={`relative flex size-7 items-center justify-center rounded-md text-xs transition-all ${
                          !isCurrentMonth ? "text-muted-foreground/30" : "text-foreground"
                        } ${
                          isFrom || isTo
                            ? "bg-primary text-primary-foreground font-bold shadow"
                            : inRange
                              ? "text-primary font-medium hover:bg-primary/20"
                              : "hover:bg-muted"
                        } ${isToday && !isFrom && !isTo ? "border border-primary/50 font-semibold" : ""}`}
                      >
                        {dayNum}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Range Preview & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t pt-3">
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {formatDisplayDate(tempFrom)}
                  </span>
                  <span className="mx-1 text-muted-foreground">→</span>
                  <span className="font-semibold text-foreground">
                    {formatDisplayDate(tempTo)}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-3 text-xs font-semibold"
                    onClick={handleApply}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
