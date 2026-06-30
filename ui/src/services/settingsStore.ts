import { ensureBackend } from "./agentClient";
import type { AppAboutInfo, ModelProviderModelsResult, SavedModelProviderResult } from "../types";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await ensureBackend();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const message = typeof payload?.error === "string" ? payload.error : `Backend returned ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function loadAppAbout(): Promise<AppAboutInfo> {
  return requestJson<AppAboutInfo>("/api/settings/about");
}

export async function fetchProviderModels(options: {
  apiKey: string;
  baseUrl: string;
}): Promise<ModelProviderModelsResult> {
  return requestJson<ModelProviderModelsResult>("/api/settings/model-providers/models", {
    body: JSON.stringify({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl
    }),
    method: "POST"
  });
}

export async function saveDefaultModelProvider(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  supportsReasoning: boolean;
}): Promise<SavedModelProviderResult> {
  return requestJson<SavedModelProviderResult>("/api/settings/model-providers/default", {
    body: JSON.stringify({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      supportsReasoning: options.supportsReasoning
    }),
    method: "POST"
  });
}
