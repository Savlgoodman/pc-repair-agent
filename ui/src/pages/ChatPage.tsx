import { useEffect, useMemo, useRef, useState } from "react";

import { ChatComposer } from "../features/chat/ChatComposer";
import { ConversationHeader } from "../features/chat/ConversationHeader";
import { MessageList } from "../features/chat/MessageList";
import {
  createAssistantMessage,
  createEmptySession,
  createId,
  createInitialState,
  normalizeStoredState,
  type PendingMessageDelta,
  type StoredState,
  updateMessage
} from "../lib/chatState";
import { formatJson, formatSessionStatus, titleFromInput } from "../lib/formatters";
import { Sidebar } from "../layout/Sidebar";
import { cancelTurn, sendApprovalDecision, streamAgentTurn } from "../services/agentClient";
import {
  createConversation,
  listConversations,
  loadConversation,
  saveConversationMessages,
  saveConversationSession
} from "../services/conversationStore";
import type { AgentEvent, ApprovalRequest, ChatMessage, Session, ToolCallItem } from "../types";

const LEGACY_STORAGE_KEY = "pc-agent-ui-state-v2";
const STORAGE_WRITE_DELAY_MS = 800;
const STREAM_DELTA_FLUSH_MS = 60;

function loadLegacyStoredState(): StoredState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      return normalizeStoredState(JSON.parse(raw) as StoredState);
    }
  } catch {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  return null;
}

async function persistStoredState(state: StoredState) {
  await Promise.all(state.sessions.map((session) => saveConversationSession(session)));
  await Promise.all(
    Object.entries(state.messages).map(([sessionId, items]) => saveConversationMessages(sessionId, items))
  );
}

function upsertToolCall(
  toolCalls: ToolCallItem[],
  item: Partial<ToolCallItem> & Pick<ToolCallItem, "id" | "name">,
) {
  const now = Date.now();
  const index = toolCalls.findIndex((tool) => tool.id === item.id);
  if (index < 0) {
    return [
      ...toolCalls,
      {
        argumentsText: "{}",
        createdAt: now,
        status: "running",
        updatedAt: now,
        ...item
      } as ToolCallItem
    ];
  }

  return toolCalls.map((tool, currentIndex) =>
    currentIndex === index
      ? {
          ...tool,
          ...item,
          anchorOffset: item.anchorOffset ?? tool.anchorOffset,
          updatedAt: now
        }
      : tool
  );
}

export function ChatPage() {
  const initialState = useMemo(createInitialState, []);
  const [sessions, setSessions] = useState(initialState.sessions);
  const [messages, setMessages] = useState(initialState.messages);
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const [searchText, setSearchText] = useState("");
  const [draft, setDraft] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestStoredStateRef = useRef<StoredState>(initialState);
  const didLoadStoredStateRef = useRef(false);
  const pendingMessageDeltasRef = useRef<Record<string, PendingMessageDelta>>({});
  const persistTimerRef = useRef<number | null>(null);
  const streamFlushTimerRef = useRef<number | null>(null);

  const activeSession = sessions.find((item) => item.id === activeSessionId) ?? sessions[0];
  const activeMessages = messages[activeSession.id] ?? [];

  const filteredSessions = useMemo(() => sessions.filter((item) => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return `${item.title} ${item.preview}`.toLowerCase().includes(query);
  }), [searchText, sessions]);

  useEffect(() => {
    let cancelled = false;

    async function loadStoredState() {
      try {
        const remoteSessions = await listConversations();
        let nextState: StoredState;

        if (remoteSessions.length > 0) {
          const activeId = remoteSessions[0].id;
          const loaded = await loadConversation(activeId);
          nextState = normalizeStoredState({
            activeSessionId: activeId,
            messages: {
              [activeId]: loaded.messages
            },
            sessions: remoteSessions
          });
        } else {
          const legacyState = loadLegacyStoredState();
          if (legacyState) {
            nextState = legacyState;
            await persistStoredState(nextState);
            localStorage.removeItem(LEGACY_STORAGE_KEY);
          } else {
            const session = await createConversation();
            nextState = {
              activeSessionId: session.id,
              messages: {
                [session.id]: []
              },
              sessions: [session]
            };
          }
        }

        if (cancelled) {
          return;
        }

        latestStoredStateRef.current = nextState;
        setSessions(nextState.sessions);
        setMessages(nextState.messages);
        setActiveSessionId(nextState.activeSessionId);
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) {
          didLoadStoredStateRef.current = true;
        }
      }
    }

    void loadStoredState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const state: StoredState = {
      sessions,
      messages,
      activeSessionId
    };
    latestStoredStateRef.current = state;

    if (!didLoadStoredStateRef.current) {
      return;
    }

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      void persistStoredState(latestStoredStateRef.current).catch((error) => console.error(error));
      persistTimerRef.current = null;
    }, STORAGE_WRITE_DELAY_MS);

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [activeSessionId, messages, sessions]);

  useEffect(() => {
    const persistNow = () => {
      if (didLoadStoredStateRef.current) {
        void persistStoredState(latestStoredStateRef.current).catch((error) => console.error(error));
      }
    };

    window.addEventListener("beforeunload", persistNow);
    window.addEventListener("pagehide", persistNow);

    return () => {
      window.removeEventListener("beforeunload", persistNow);
      window.removeEventListener("pagehide", persistNow);
      abortControllerRef.current?.abort();
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current);
      }
      persistNow();
    };
  }, []);

  function updateSession(sessionId: string, updater: (session: Session) => Session) {
    setSessions((current) => current.map((session) => (session.id === sessionId ? updater(session) : session)));
  }

  function createSession() {
    const fallbackSession = createEmptySession();
    void createConversation({
      preview: fallbackSession.preview,
      title: fallbackSession.title
    })
      .then((nextSession) => {
        setSessions((current) => [nextSession, ...current]);
        setMessages((current) => ({
          ...current,
          [nextSession.id]: []
        }));
        setActiveSessionId(nextSession.id);
      })
      .catch((error) => console.error(error));
    setDraft("");
    setPendingApproval(null);
  }

  function selectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setPendingApproval(null);
    if (messages[sessionId]) {
      return;
    }

    void loadConversation(sessionId)
      .then((conversation) => {
        setSessions((current) =>
          current.map((session) => (session.id === sessionId ? conversation.session : session))
        );
        setMessages((current) => ({
          ...current,
          [sessionId]: conversation.messages
        }));
      })
      .catch((error) => console.error(error));
  }

  function flushQueuedMessageDeltas() {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }

    const pendingDeltas = Object.values(pendingMessageDeltasRef.current);
    if (pendingDeltas.length === 0) {
      return;
    }

    pendingMessageDeltasRef.current = {};
    setMessages((current) => {
      let next = current;
      for (const delta of pendingDeltas) {
        if (!delta.text && !delta.reasoning) {
          continue;
        }

        next = updateMessage(next, delta.sessionId, delta.messageId, (message) => ({
          ...message,
          content: delta.text ? message.content + delta.text : message.content,
          reasoning: delta.reasoning ? `${message.reasoning ?? ""}${delta.reasoning}` : message.reasoning
        }));
      }
      return next;
    });
  }

  function scheduleMessageDeltaFlush() {
    if (streamFlushTimerRef.current !== null) {
      return;
    }

    streamFlushTimerRef.current = window.setTimeout(flushQueuedMessageDeltas, STREAM_DELTA_FLUSH_MS);
  }

  function queueMessageDelta(
    sessionId: string,
    assistantMessageId: string,
    delta: string,
    kind: "text" | "reasoning",
  ) {
    const key = `${sessionId}:${assistantMessageId}`;
    const current = pendingMessageDeltasRef.current[key] ?? {
      messageId: assistantMessageId,
      reasoning: "",
      sessionId,
      text: ""
    };

    pendingMessageDeltasRef.current[key] = {
      ...current,
      reasoning: kind === "reasoning" ? current.reasoning + delta : current.reasoning,
      text: kind === "text" ? current.text + delta : current.text
    };
    scheduleMessageDeltaFlush();
  }

  function handleAgentEvent(sessionId: string, assistantMessageId: string, event: AgentEvent) {
    if (event.type === "agent.text.delta") {
      queueMessageDelta(sessionId, assistantMessageId, event.delta, "text");
      return;
    }

    if (event.type === "agent.reasoning.delta") {
      queueMessageDelta(sessionId, assistantMessageId, event.delta, "reasoning");
      return;
    }

    if (event.type === "agent.text.completed" || event.type === "agent.reasoning.completed") {
      flushQueuedMessageDeltas();
      return;
    }

    if (event.type === "agent.tool.started") {
      flushQueuedMessageDeltas();
      setMessages((current) =>
        updateMessage(current, sessionId, assistantMessageId, (message) => ({
          ...message,
          toolCalls: upsertToolCall(message.toolCalls, {
            anchorOffset: message.content.length,
            argumentsText: formatJson(event.arguments),
            id: event.toolCallId || createId("tool"),
            name: event.name,
            risk: event.risk,
            status: "running"
          })
        }))
      );
      return;
    }

    if (event.type === "agent.tool.completed") {
      flushQueuedMessageDeltas();
      setMessages((current) =>
        updateMessage(current, sessionId, assistantMessageId, (message) => ({
          ...message,
          toolCalls: upsertToolCall(message.toolCalls, {
            id: event.toolCallId || createId("tool"),
            name: event.name,
            resultText: formatJson(event.result ?? event.metadata),
            status: "complete"
          })
        }))
      );
      return;
    }

    if (event.type === "agent.tool.failed") {
      flushQueuedMessageDeltas();
      setMessages((current) =>
        updateMessage(current, sessionId, assistantMessageId, (message) => ({
          ...message,
          toolCalls: upsertToolCall(message.toolCalls, {
            error: event.error ?? "工具调用失败",
            id: event.toolCallId || createId("tool"),
            name: event.name,
            status: "error"
          })
        }))
      );
      return;
    }

    if (event.type === "approval.required") {
      flushQueuedMessageDeltas();
      setPendingApproval({
        approvalId: event.approvalId,
        argumentsText: formatJson(event.argumentsText ? event.argumentsText : event.arguments),
        impact: event.impact,
        name: event.name,
        purpose: event.purpose,
        risk: event.risk,
        risks: event.risks,
        rollback: event.rollback,
        toolCallId: event.toolCallId
      });
      updateSession(sessionId, (session) => ({ ...session, status: "approval", updatedAt: Date.now() }));
      setMessages((current) =>
        updateMessage(current, sessionId, assistantMessageId, (message) => ({
          ...message,
          toolCalls: upsertToolCall(message.toolCalls, {
            anchorOffset: message.content.length,
            argumentsText: formatJson(event.argumentsText ? event.argumentsText : event.arguments),
            id: event.toolCallId || event.approvalId,
            name: event.name,
            risk: event.risk,
            status: "approval"
          })
        }))
      );
      return;
    }

    if (event.type === "agent.run.completed") {
      flushQueuedMessageDeltas();
      setMessages((current) =>
        updateMessage(current, sessionId, assistantMessageId, (message) => ({
          ...message,
          streaming: false,
          usage: typeof event.usage === "object" && event.usage ? (event.usage as ChatMessage["usage"]) : message.usage
        }))
      );
      updateSession(sessionId, (session) => ({ ...session, status: "idle", updatedAt: Date.now() }));
      return;
    }

    if (event.type === "agent.run.failed") {
      flushQueuedMessageDeltas();
      setMessages((current) =>
        updateMessage(current, sessionId, assistantMessageId, (message) => ({
          ...message,
          error: event.error ?? "Agent 运行失败",
          streaming: false
        }))
      );
      updateSession(sessionId, (session) => ({ ...session, status: "error", updatedAt: Date.now() }));
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || activeTurnId) {
      return;
    }

    const sessionId = activeSession.id;
    const now = Date.now();
    const turnId = createId("turn");
    const assistantMessageId = createId("assistant");
    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: text,
      createdAt: now,
      toolCalls: []
    };
    const assistantMessage = createAssistantMessage(assistantMessageId);

    setMessages((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), userMessage, assistantMessage]
    }));
    updateSession(sessionId, (session) => ({
      ...session,
      preview: text,
      status: "running",
      title: (messages[sessionId] ?? []).some((message) => message.role === "user") ? session.title : titleFromInput(text),
      updatedAt: now
    }));
    setDraft("");
    setActiveTurnId(turnId);
    setPendingApproval(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await streamAgentTurn({
        conversationId: sessionId,
        input: text,
        onEvent: (event) => handleAgentEvent(sessionId, assistantMessageId, event),
        signal: abortController.signal,
        turnId
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        handleAgentEvent(sessionId, assistantMessageId, {
          conversationId: sessionId,
          error: "用户取消了当前任务。",
          turnId,
          type: "agent.run.failed"
        });
      } else {
        handleAgentEvent(sessionId, assistantMessageId, {
          conversationId: sessionId,
          error: error instanceof Error ? error.message : String(error),
          turnId,
          type: "agent.run.failed"
        });
      }
    } finally {
      setActiveTurnId(null);
      abortControllerRef.current = null;
    }
  }

  async function stopCurrentTurn() {
    if (!activeTurnId) {
      return;
    }

    const turnId = activeTurnId;
    abortControllerRef.current?.abort();
    flushQueuedMessageDeltas();
    await cancelTurn(turnId).catch(() => undefined);
    setActiveTurnId(null);
    setPendingApproval(null);
  }

  async function resolveApproval(decision: "allow" | "deny") {
    if (!pendingApproval) {
      return;
    }

    const approvalId = pendingApproval.approvalId;
    setPendingApproval(null);
    updateSession(activeSession.id, (session) => ({ ...session, status: "running", updatedAt: Date.now() }));
    await sendApprovalDecision(approvalId, decision).catch((error) => {
      updateSession(activeSession.id, (session) => ({ ...session, status: "error", updatedAt: Date.now() }));
      console.error(error);
    });
  }

  return (
    <>
      <Sidebar
        activeSessionId={activeSession.id}
        onCreateSession={createSession}
        onSearchTextChange={setSearchText}
        onSelectSession={selectSession}
        searchText={searchText}
        sessions={filteredSessions}
      />

      <main className="main-panel">
        <ConversationHeader isRunning={Boolean(activeTurnId)} title={activeSession.title} />
        <MessageList
          messages={activeMessages}
          session={activeSession}
          statusLabel={formatSessionStatus(activeSession.status)}
        />
        <ChatComposer
          activeTurnId={activeTurnId}
          draft={draft}
          onDraftChange={setDraft}
          onResolveApproval={(decision) => void resolveApproval(decision)}
          onSendMessage={() => void sendMessage()}
          onStopTurn={() => void stopCurrentTurn()}
          pendingApproval={pendingApproval}
        />
      </main>
    </>
  );
}
