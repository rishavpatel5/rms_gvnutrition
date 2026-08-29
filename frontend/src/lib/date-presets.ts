import { IST_TIMEZONE } from "./ist-time";

export type DateRange = {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
};

export type DateRangePreset = {
  label: string;
  category?: "standard" | "tax";
  getRange: () => DateRange;
};

export function getTodayIst(): Date {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: IST_TIMEZONE });
  return new Date(istString);
}

export function toYmd(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDisplayDate(ymd: string): string {
  if (!ymd) return "";
  try {
    const d = parseYmd(ymd);
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

export function getAccountingPresets(): DateRangePreset[] {
  return [
    {
      label: "This Month",
      category: "standard",
      getRange: () => {
        const today = getTodayIst();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { from: toYmd(start), to: toYmd(end) };
      },
    },
    {
      label: "Last Month",
      category: "standard",
      getRange: () => {
        const today = getTodayIst();
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return { from: toYmd(start), to: toYmd(end) };
      },
    },
    {
      label: "Last 30 Days",
      category: "standard",
      getRange: () => {
        const today = getTodayIst();
        const start = new Date(today);
        start.setDate(today.getDate() - 29);
        return { from: toYmd(start), to: toYmd(today) };
      },
    },
    {
      label: "Last 90 Days",
      category: "standard",
      getRange: () => {
        const today = getTodayIst();
        const start = new Date(today);
        start.setDate(today.getDate() - 89);
        return { from: toYmd(start), to: toYmd(today) };
      },
    },
    {
      label: "Q1 (Apr - Jun)",
      category: "tax",
      getRange: () => {
        const today = getTodayIst();
        const fyYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        return {
          from: `${fyYear}-04-01`,
          to: `${fyYear}-06-30`,
        };
      },
    },
    {
      label: "Q2 (Jul - Sep)",
      category: "tax",
      getRange: () => {
        const today = getTodayIst();
        const fyYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        return {
          from: `${fyYear}-07-01`,
          to: `${fyYear}-09-30`,
        };
      },
    },
    {
      label: "Q3 (Oct - Dec)",
      category: "tax",
      getRange: () => {
        const today = getTodayIst();
        const fyYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        return {
          from: `${fyYear}-10-01`,
          to: `${fyYear}-12-31`,
        };
      },
    },
    {
      label: "Q4 (Jan - Mar)",
      category: "tax",
      getRange: () => {
        const today = getTodayIst();
        const fyYear = today.getMonth() >= 3 ? today.getFullYear() + 1 : today.getFullYear();
        return {
          from: `${fyYear}-01-01`,
          to: `${fyYear}-03-31`,
        };
      },
    },
    {
      label: "Current FY",
      category: "tax",
      getRange: () => {
        const today = getTodayIst();
        const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        return {
          from: `${fyStartYear}-04-01`,
          to: `${fyStartYear + 1}-03-31`,
        };
      },
    },
    {
      label: "Previous FY",
      category: "tax",
      getRange: () => {
        const today = getTodayIst();
        const fyStartYear = (today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1) - 1;
        return {
          from: `${fyStartYear}-04-01`,
          to: `${fyStartYear + 1}-03-31`,
        };
      },
    },
  ];
}
