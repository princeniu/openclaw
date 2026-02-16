export type WeeklyInputPolicyMode = "real-required" | "real-or-default" | "default-only";

export type WeeklySeries = {
  sales: number[];
  costs: number[];
  cashflow: number[];
};

type WeeklyInputResolution =
  | {
      ok: true;
      series: WeeklySeries;
      modeUsed: "real" | "default";
    }
  | {
      ok: false;
      error: string;
    };

const DEFAULT_WEEKLY_SERIES: WeeklySeries = {
  sales: [1, 1],
  costs: [1, 1],
  cashflow: [1, 1],
};

export function resolveWeeklyInput(params: {
  mode: WeeklyInputPolicyMode;
  realSeries?: WeeklySeries;
}): WeeklyInputResolution {
  const hasReal = hasValidSeries(params.realSeries);

  if (params.mode === "default-only") {
    return {
      ok: true,
      series: cloneSeries(DEFAULT_WEEKLY_SERIES),
      modeUsed: "default",
    };
  }

  if (params.mode === "real-required") {
    if (!hasReal || !params.realSeries) {
      return {
        ok: false,
        error: "weekly report requires real metrics in real-required mode",
      };
    }
    return {
      ok: true,
      series: cloneSeries(params.realSeries),
      modeUsed: "real",
    };
  }

  if (hasReal && params.realSeries) {
    return {
      ok: true,
      series: cloneSeries(params.realSeries),
      modeUsed: "real",
    };
  }

  return {
    ok: true,
    series: cloneSeries(DEFAULT_WEEKLY_SERIES),
    modeUsed: "default",
  };
}

function hasValidSeries(series: WeeklySeries | undefined): boolean {
  if (!series) {
    return false;
  }
  return (
    isValidNumberArray(series.sales) &&
    isValidNumberArray(series.costs) &&
    isValidNumberArray(series.cashflow)
  );
}

function isValidNumberArray(values: number[]): boolean {
  return (
    Array.isArray(values) && values.length > 0 && values.every((item) => Number.isFinite(item))
  );
}

function cloneSeries(series: WeeklySeries): WeeklySeries {
  return {
    sales: [...series.sales],
    costs: [...series.costs],
    cashflow: [...series.cashflow],
  };
}
