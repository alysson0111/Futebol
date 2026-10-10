import { apiJson } from "./serverApi.js";

export function analyzePrematchWithForebet(games, start, end) {
  return apiJson("/api/forebet-analysis", {
    method: "POST",
    body: JSON.stringify({ games, start, end })
  });
}
