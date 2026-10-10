export function currencyOdd(value) {
  const odd = Number(value);
  return Number.isFinite(odd) && odd > 1 ? odd.toFixed(2) : "-";
}

export function getTodayInput() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function escapeCsv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function calculateReport(signals) {
  const green = signals.filter((signal) => signal.result === "green").length;
  const red = signals.filter((signal) => signal.result === "red").length;
  const push = signals.filter((signal) => signal.result === "push").length;
  const done = green + red;
  const profit = signals.reduce((sum, signal) => {
    const factor = signal.settlementFactor ?? 1;
    if (signal.result === "green") return sum + Math.max(0, Number(signal.odd || 0) - 1) * factor;
    if (signal.result === "red") return sum - factor;
    return sum;
  }, 0);
  return {
    total: signals.length,
    green,
    red,
    push,
    hitRate: done ? Math.round((green / done) * 100) : 0,
    profit,
    roi: done + push ? Math.round((profit / (done + push)) * 100) : 0
  };
}
