import fs from "node:fs/promises";
import path from "node:path";
import { activityFeedPath } from "./config.js";
import type { OnboardingActivity } from "./types.js";
import { IntegrationBoundaryError } from "./types.js";

async function ensureFeedFile() {
  await fs.mkdir(path.dirname(activityFeedPath), { recursive: true });
  try {
    await fs.access(activityFeedPath);
  } catch {
    await fs.writeFile(activityFeedPath, "[]\n", "utf8");
  }
}

export async function loadActivities(): Promise<OnboardingActivity[]> {
  await ensureFeedFile();
  const raw = await fs.readFile(activityFeedPath, "utf8");
  return JSON.parse(raw) as OnboardingActivity[];
}

export async function saveActivities(activities: OnboardingActivity[]) {
  await ensureFeedFile();
  await fs.writeFile(activityFeedPath, `${JSON.stringify(activities, null, 2)}\n`, "utf8");
}

export async function recordActivity(activity: OnboardingActivity) {
  try {
    const activities = await loadActivities();
    const index = activities.findIndex((item) => item.id === activity.id);
    if (index >= 0) {
      activities[index] = activity;
    } else {
      activities.push(activity);
    }
    await saveActivities(activities);
    return activity;
  } catch (error) {
    throw new IntegrationBoundaryError("wallet_sync_error", "Unable to persist onboarding activity feed", error);
  }
}

export async function resetActivities() {
  await saveActivities([]);
}
