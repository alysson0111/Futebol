import { apiJson } from "../api/serverApi.js";

export function listSignals(cursor = 0, since = "", pendingIds = []) {
  const query = new URLSearchParams({ cursor: String(cursor) });
  if (since) {
    query.set("since", since);
    query.set("pendingIds", pendingIds.join(","));
  }
  return apiJson(`/api/signals?${query}`);
}

export function saveSignal(signal) {
  return apiJson("/api/signals", {
    method: "POST",
    body: JSON.stringify(signal)
  });
}

export function updateSignalResult(id, result, extra = {}) {
  return apiJson("/api/signals", {
    method: "PATCH",
    body: JSON.stringify({ id, result, ...extra })
  });
}

export function deleteSignal(id) {
  return apiJson("/api/signals", {
    method: "DELETE",
    body: JSON.stringify({ id })
  });
}
