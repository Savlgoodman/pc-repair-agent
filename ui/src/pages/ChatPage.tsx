import { useEffect, useMemo, useRef, useState } from "react";

import { ChatComposer } from "../features/chat/ChatComposer";
import { ConversationHeader } from "../features/chat/ConversationHeader";
import { MessageList } from "../features/chat/MessageList";
import {
  createEmptySession,
  createId,
  createInitialState,
  normalizeStoredState,
  type PendingMessageDelta,
  type StoredState,
  updateMessage
} from "../lib/chatState";
import { formatJson, formatSessionStatus } from "../lib/formatters";
import { Sidebar } from "../layout/Sidebar";
import { cancelTurn, sendApprovalDecision, streamAgentTurn } from "../services/agentClient";
import {
  listConversations,
  loadConversation
} from "../services/conversationStore";
import type { AgentEvent, ApprovalRequest, ChatMessage, Session, ToolCallItem } from "../types";

const DRAFT_SESSION_ID = "__draft_session__";
const STREAM_DELTA_FLUSH_MS = 60;

function createDraftSession(): Session {
  return {
    ...createEmptySession(),
    id: DRAFT_SESSION_ID
  };
}

function isDraftSessionId(sessionId: string) {
  return sessionId === DRAFT_SESSION_ID;
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
  const initialState = useMemo<StoredState>(() => {
    const session = createDraftSession();
    return {
      activeSessionId: session.id,
      messages: {
        [session.id]: []
      },
      sessions: [session]
    };
  }, []);
  const [sessions, setSessions] = useState(initialState.sessions);
  const [messages, setMessages] = useState(initialState.messages);
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const [archivedSessionIds, setArchivedSessionIds] = useState<Set<string>>(() => new Set());
  const [searchText, setSearchText] = useState("");
  const [draft, setDraft] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingMessageDeltasRef = useRef<Record<string, PendingMessageDelta>>({});
  const streamFlushTimerRef = useRef<number | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeStreamSessionIdRef = useRef<string | null>(null);

  const activeSession = sessions.find((item) => item.id === activeSessionId) ?? sessions[0];
  const activeMessages = messages[activeSession.id] ?? [];

  const visibleSessions = useMemo(
    () => sessions.filter((session) => !archivedSessionIds.has(session.id)),
    [archivedSessionIds, sessions]
  );

  const filteredSessions = useMemo(() => visibleSessions.filter((item) => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return `${item.title} ${item.preview}`.toLowerCase().includes(query);
  }), [searchText, visibleSessions]);

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
          nextState = initialState;
        }

        if (cancelled) {
          return;
        }

        setSessions(nextState.sessions);
        setMessages(nextState.messages);
        setActiveSessionId(nextState.activeSessionId);
      } catch (error) {
        console.error(error);
      }
    }

    void loadStoredState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current);
      }
    };
  }, []);

  function updateSession(sessionId: string, updater: (session: Session) => Session) {
    setSessions((current) => current.map((session) => (session.id === sessionId ? updater(session) : session)));
  }

  function createSession() {
    const draftSession = createDraftSession();
    setArchivedSessionIds((current) => {
      if (!current.has(DRAFT_SESSION_ID)) {
        return current;
      }
      const next = new Set(current);
      next.delete(DRAFT_SESSION_ID);
      return next;
    });
    setSessions((current) => [
      draftSession,
      ...current.filter((session) => !isDraftSessionId(session.id))
    ]);
    setMessages((current) => ({
      ...current,
      [draftSession.id]: []
    }));
    setActiveSessionId(draftSession.id);
    setDraft("");
    setPendingApproval(null);
  }

  function selectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setPendingApproval(null);
    if (isDraftSessionId(sessionId)) {
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

  function archiveSession(sessionId: string) {
    setArchivedSessionIds((current) => {
      const next = new Set(current);
      next.add(sessionId);
      return next;
    });

    if (sessionId !== activeSessionId) {
      return;
    }

    const nextSession = sessions.find((session) => session.id !== sessionId && !archivedSessionIds.has(session.id));
    if (nextSession) {
      selectSession(nextSession.id);
      return;
    }

    createSession();
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

  function handleAgentEvent(sessionId: string, event: AgentEvent) {
    if (event.type === "conversation.turn.started") {
      const nextSessionId = event.conversationId;
      activeAssistantMessageIdRef.current = event.assistantMessage.id;
      activeStreamSessionIdRef.current = nextSessionId;
      setActiveSessionId(nextSessionId);
      setSessions((current) => {
        const withoutDraft = current.filter((session) => session.id !== sessionId);
        const existingIndex = withoutDraft.findIndex((session) => session.id === nextSessionId);
        if (existingIndex >= 0) {
          return withoutDraft.map((session) => (session.id === nextSessionId ? event.session : session));
        }
        return [event.session, ...withoutDraft];
      });
      setMessages((current) => ({
        ...Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)),
        [nextSessionId]: [...(current[nextSessionId] ?? []), event.userMessage, event.assistantMessage]
      }));
      return;
    }

    const assistantMessageId = activeAssistantMessageIdRef.current;
    const targetSessionId = activeStreamSessionIdRef.current ?? sessionId;
    if (!assistantMessageId) {
      return;
    }

    if (event.type === "agent.text.delta") {
      queueMessageDelta(targetSessionId, assistantMessageId, event.delta, "text");
      return;
    }

    if (event.type === "agent.reasoning.delta") {
      queueMessageDelta(targetSessionId, assistantMessageId, event.delta, "reasoning");
      return;
    }

    if (event.type === "agent.text.completed" || event.type === "agent.reasoning.completed") {
      flushQueuedMessageDeltas();
      return;
    }

    if (event.type === "agent.tool.started") {
      flushQueuedMessageDeltas();
      setMessages((current) =>
        updateMessage(current, targetSessionId, assistantMessageId, (message) => ({
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
        updateMessage(current, targetSessionId, assistantMessageId, (message) => ({
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
        updateMessage(current, targetSessionId, assistantMessageId, (message) => ({
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
      updateSession(targetSessionId, (session) => ({ ...session, status: "approval", updatedAt: Date.now() }));
      setMessages((current) =>
        updateMessage(current, targetSessionId, assistantMessageId, (message) => ({
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
        updateMessage(current, targetSessionId, assistantMessageId, (message) => ({
          ...message,
          streaming: false,
          usage: typeof event.usage === "object" && event.usage ? (event.usage as ChatMessage["usage"]) : message.usage
        }))
      );
      updateSession(targetSessionId, (session) => event.session ?? { ...session, status: "idle", updatedAt: Date.now() });
      return;
    }

    if (event.type === "agent.run.failed") {
      flushQueuedMessageDeltas();
      setMessages((current) =>
        updateMessage(current, targetSessionId, assistantMessageId, (message) => ({
          ...message,
          error: event.error ?? "Agent 运行失败",
          streaming: false
        }))
      );
      updateSession(targetSessionId, (session) => event.session ?? { ...session, status: "error", updatedAt: Date.now() });
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || activeTurnId) {
      return;
    }

    const sessionId = activeSession.id;
    const conversationId = isDraftSessionId(sessionId) ? undefined : sessionId;
    const turnId = createId("turn");
    setDraft("");
    setActiveTurnId(turnId);
    activeAssistantMessageIdRef.current = null;
    activeStreamSessionIdRef.current = null;
    setPendingApproval(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await streamAgentTurn({
        conversationId,
        input: text,
        onEvent: (event) => handleAgentEvent(sessionId, event),
        signal: abortController.signal,
        turnId
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        handleAgentEvent(sessionId, {
          conversationId: sessionId,
          error: "用户取消了当前任务。",
          turnId,
          type: "agent.run.failed"
        });
      } else {
        handleAgentEvent(sessionId, {
          conversationId: sessionId,
          error: error instanceof Error ? error.message : String(error),
          turnId,
          type: "agent.run.failed"
        });
      }
    } finally {
      setActiveTurnId(null);
      activeStreamSessionIdRef.current = null;
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
    await sendApprovalDecision(approvalId, decision)
      .then((result) => {
        if (result.session) {
          updateSession(activeSession.id, () => result.session as Session);
        }
      })
      .catch((error) => {
        updateSession(activeSession.id, (session) => ({ ...session, status: "error", updatedAt: Date.now() }));
        console.error(error);
      });
  }

  return (
    <>
      <Sidebar
        activeSessionId={activeSession.id}
        onArchiveSession={archiveSession}
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
