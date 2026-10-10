import { apiJson } from "./serverApi.js";

export function fetchLiveFixtures() {
  return apiJson(`/api/games?mode=live&_=${Date.now()}`);
}

export function fetchPrematchFixtures(start, end) {
  return apiJson(`/api/games?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
}
