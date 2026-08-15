import http from "node:http";
import { activityFeedPath } from "../config.js";
import { loadActivities, recordActivity } from "../activityStore.js";
import type { OnboardingActivity } from "../types.js";

export async function publishActivity(activity: OnboardingActivity) {
  return recordActivity(activity);
}

export async function listActivityFeed() {
  return loadActivities();
}

export function getWalletActivityFeedPath() {
  return activityFeedPath;
}

export function createWalletActivityServer(port: number) {
  const server = http.createServer(async (_request, response) => {
    const payload = JSON.stringify(await loadActivities(), null, 2);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(payload);
  });

  return new Promise<http.Server>((resolve) => {
    server.listen(port, () => resolve(server));
  });
}
