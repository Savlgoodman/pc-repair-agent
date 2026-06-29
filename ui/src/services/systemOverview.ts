import { ensureBackend } from "./agentClient";
import type { SystemOverview } from "../types";

export async function loadSystemOverview(): Promise<SystemOverview> {
  const baseUrl = await ensureBackend();
  const response = await fetch(`${baseUrl}/api/system/overview`);

  if (!response.ok) {
    throw new Error(`Backend returned ${response.status}`);
  }

  return response.json() as Promise<SystemOverview>;
}
