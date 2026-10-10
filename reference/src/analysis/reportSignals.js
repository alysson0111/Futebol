export function selectPendingSignalIds(signals, offset = 0, limit = 20) {
  const pending = signals.filter((signal) => signal.id && signal.result === "pendente" && !signal.finalConfirmed);
  const start = pending.length ? offset % pending.length : 0;
  const ids = Array.from({ length: Math.min(limit, pending.length) }, (_, i) => pending[(start + i) % pending.length].id);
  return { ids, nextOffset: pending.length ? (start + ids.length) % pending.length : 0 };
}

export function mergeReportSignals(current, incoming, deletedIds = new Set()) {
  const records = new Map(current.filter((signal) => !deletedIds.has(signal.id)).map((signal) => [signal.id, signal]));
  for (const signal of incoming) {
    if (deletedIds.has(signal.id)) continue;
    const previous = records.get(signal.id);
    if (previous?.finalConfirmed && !signal.finalConfirmed) continue;
    const previousTime = previous?.updatedAt?._seconds || 0;
    const incomingTime = signal.updatedAt?._seconds || 0;
    if (previousTime > incomingTime) continue;
    records.set(signal.id, { ...previous, ...signal });
  }
  return [...records.values()].sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0));
}
