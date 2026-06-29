import { ensureBackend } from "./agentClient";
import type { ChatMessage, Session } from "../types";

interface ListConversationsResponse {
  sessions: Session[];
}

interface CreateConversationResponse {
  session: Session;
}

interface LoadConversationResponse {
  session: Session;
  messages: ChatMessage[];
}

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
    throw new Error(`Backend returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listConversations(): Promise<Session[]> {
  const response = await requestJson<ListConversationsResponse>("/api/conversations");
  return response.sessions;
}

export async function createConversation(input?: {
  preview?: string;
  title?: string;
}): Promise<Session> {
  const response = await requestJson<CreateConversationResponse>("/api/conversations", {
    body: JSON.stringify(input ?? {}),
    method: "POST"
  });
  return response.session;
}

export async function loadConversation(sessionId: string): Promise<{
  messages: ChatMessage[];
  session: Session;
}> {
  const response = await requestJson<LoadConversationResponse>(`/api/conversations/${sessionId}`);
  return response;
}

export async function saveConversationSession(session: Session): Promise<Session> {
  const response = await requestJson<CreateConversationResponse>(`/api/conversations/${session.id}/session`, {
    body: JSON.stringify({ session }),
    method: "PUT"
  });
  return response.session;
}

export async function saveConversationMessages(
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/conversations/${sessionId}/messages`, {
    body: JSON.stringify({ messages }),
    method: "PUT"
  });
}
