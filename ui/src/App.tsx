import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  LayoutList,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  Paperclip,
  PanelLeft,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  UserRound,
  Wrench,
  X
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { MessageRenderer } from "./components/MessageRenderer";
import { cancelTurn, sendApprovalDecision, streamAgentTurn } from "./services/agentClient";
import {
  createConversation,
  listConversations,
  loadConversation,
  saveConversationMessages,
  saveConversationSession
} from "./services/conversationStore";
import type { AgentEvent, ApprovalRequest, ChatMessage, Session, ToolCallItem } from "./types";

const LEGACY_STORAGE_KEY = "pc-agent-ui-state-v2";
const STORAGE_WRITE_DELAY_MS = 800;
const STREAM_DELTA_FLUSH_MS = 60;

interface StoredState {
  sessions: Session[];
  messages: Record<string, ChatMessage[]>;
  activeSessionId: string;
}

interface AssistantInlineEntry {
  content: string;
  key: string;
  toolGroups: ToolCallItem[][];
}

interface PendingMessageDelta {
  messageId: string;
  reasoning: string;
  sessionId: string;
  text: string;
}

interface TextRange {
  end: number;
  start: number;
}

function createId(prefix: string) {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptySession(): Session {
  const now = Date.now();
  return {
    id: createId("session"),
    title: "新的维修会话",
    preview: "描述电脑问题，Agent 会先生成只读检查计划",
    createdAt: now,
    updatedAt: now,
    status: "idle"
  };
}

function createInitialState(): StoredState {
  const session = createEmptySession();
  return {
    activeSessionId: session.id,
    messages: {
      [session.id]: []
    },
    sessions: [session]
  };
}

function normalizeStoredState(value: StoredState): StoredState {
  if (!value.sessions?.length || !value.activeSessionId) {
    return createInitialState();
  }

  const now = Date.now();
  const sessions = value.sessions.map((session) => ({
    ...session,
    createdAt: typeof session.createdAt === "number" ? session.createdAt : now,
    updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : now,
    status: session.status === "running" || session.status === "approval" ? "idle" : session.status
  }));
  const messages = Object.fromEntries(
    Object.entries(value.messages ?? {}).map(([sessionId, items]) => [
      sessionId,
      items.map((message) => ({
        ...message,
        createdAt: typeof message.createdAt === "number" ? message.createdAt : now,
        streaming: false,
        toolCalls: message.toolCalls ?? []
      }))
    ])
  );

  return {
    activeSessionId: sessions.some((session) => session.id === value.activeSessionId)
      ? value.activeSessionId
      : sessions[0].id,
    messages,
    sessions
  };
}

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

async function handleWindowAction(action: "minimize" | "maximize" | "close") {
  const hasTauri = "__TAURI_INTERNALS__" in window;
  if (!hasTauri) {
    return;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();

  if (action === "minimize") {
    await currentWindow.minimize();
  } else if (action === "maximize") {
    await currentWindow.toggleMaximize();
  } else {
    await currentWindow.close();
  }
}

function formatSessionStatus(status: Session["status"]) {
  if (status === "running") {
    return "运行中";
  }
  if (status === "approval") {
    return "待审批";
  }
  if (status === "error") {
    return "异常";
  }
  return "空闲";
}

function formatTimeLabel(value: number) {
  const diff = Date.now() - value;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)} 分`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时`;
  }
  return `${Math.floor(diff / day)} 天`;
}

function titleFromInput(input: string) {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) {
    return "新的维修会话";
  }
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeArguments(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>).slice(0, 3);
      const summary = entries.map(([key, item]) => `${key} = ${JSON.stringify(item)}`).join(", ");
      return summary.length > 120 ? `${summary.slice(0, 120)}...` : summary || "{}";
    }
  } catch {
    // Fall back to plain text summary below.
  }

  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact || "{}";
}

function formatRisk(risk?: ToolCallItem["risk"]) {
  if (risk === "high") {
    return "高风险";
  }
  if (risk === "medium") {
    return "中风险";
  }
  if (risk === "blocked") {
    return "已阻止";
  }
  return "低风险";
}

function createAssistantMessage(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    streaming: true,
    toolCalls: []
  };
}

function updateMessage(
  messages: Record<string, ChatMessage[]>,
  sessionId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
) {
  return {
    ...messages,
    [sessionId]: (messages[sessionId] ?? []).map((message) =>
      message.id === messageId ? updater(message) : message
    )
  };
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

function getLineRanges(content: string) {
  const lines: Array<TextRange & { text: string }> = [];
  let start = 0;

  while (start < content.length) {
    const nextLineBreak = content.indexOf("\n", start);
    const end = nextLineBreak >= 0 ? nextLineBreak + 1 : content.length;
    lines.push({
      end,
      start,
      text: content.slice(start, end)
    });
    start = end;
  }

  return lines;
}

function isMarkdownTableDivider(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  return Boolean(trimmed) && trimmed.includes("|") && !trimmed.startsWith("```");
}

function findMarkdownTableRanges(content: string): TextRange[] {
  const lines = getLineRanges(content);
  const ranges: TextRange[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    if (!isMarkdownTableDivider(lines[index].text) || !isMarkdownTableRow(lines[index - 1].text)) {
      continue;
    }

    let startIndex = index - 1;
    let endIndex = index + 1;

    while (startIndex > 0 && isMarkdownTableRow(lines[startIndex - 1].text)) {
      startIndex -= 1;
    }

    while (endIndex < lines.length && isMarkdownTableRow(lines[endIndex].text)) {
      endIndex += 1;
    }

    ranges.push({
      end: lines[endIndex - 1].end,
      start: lines[startIndex].start
    });
  }

  return ranges;
}

function moveOffsetAfterMarkdownTable(offset: number, tableRanges: TextRange[]) {
  for (const range of tableRanges) {
    if (offset > range.start && offset < range.end) {
      return range.end;
    }
  }

  return offset;
}

function buildAssistantInlineEntries(content: string, toolCalls: ToolCallItem[]) {
  const entries: AssistantInlineEntry[] = [];
  const contentLength = content.length;
  const tableRanges = findMarkdownTableRanges(content);
  const toolsByOffset = new Map<number, ToolCallItem[]>();

  for (const tool of toolCalls) {
    const rawOffset = typeof tool.anchorOffset === "number" ? tool.anchorOffset : contentLength;
    const boundedOffset = Math.max(0, Math.min(rawOffset, contentLength));
    const offset = moveOffsetAfterMarkdownTable(boundedOffset, tableRanges);
    toolsByOffset.set(offset, [...(toolsByOffset.get(offset) ?? []), tool]);
  }

  let cursor = 0;
  const offsets = [...toolsByOffset.keys()].sort((a, b) => a - b);

  for (const offset of offsets) {
    const text = content.slice(cursor, offset);
    if (text.trim()) {
      entries.push({
        content: text,
        key: `text-${cursor}-${offset}`,
        toolGroups: []
      });
    }

    entries.push({
      content: "",
      key: `tools-${offset}-${toolsByOffset.get(offset)?.map((tool) => tool.id).join("-")}`,
      toolGroups: [toolsByOffset.get(offset) ?? []]
    });
    cursor = offset;
  }

  const tail = content.slice(cursor);
  if (tail.trim()) {
    entries.push({
      content: tail,
      key: `text-${cursor}-${contentLength}`,
      toolGroups: []
    });
  }

  return entries;
}

function toolResultSummary(tool: ToolCallItem) {
  const value = tool.error ?? tool.resultText ?? "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return tool.status === "approval" ? "等待确认" : "运行中";
  }
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
}

function ToolCallCard({ tool }: { tool: ToolCallItem }) {
  const defaultOpen = tool.status !== "complete";

  return (
    <details className={`tool-call-card ${tool.status}`} open={defaultOpen}>
      <summary className="tool-call-head">
        <span className="tool-call-icon">
          {tool.status === "complete" ? (
            <CheckCircle2 size={14} />
          ) : tool.status === "error" ? (
            <AlertTriangle size={14} />
          ) : (
            <Circle size={14} className={tool.status === "running" ? "spin-dot" : ""} />
          )}
        </span>
        <strong>{tool.name}</strong>
        <span>{formatRisk(tool.risk)}</span>
        {tool.status === "complete" ? <em>{toolResultSummary(tool)}</em> : null}
      </summary>
      <div className="tool-call-detail">
        <span>入参</span>
        <pre>{tool.argumentsText}</pre>
        {tool.resultText || tool.error ? (
          <>
            <span>{tool.error ? "错误" : "输出"}</span>
            <pre>{tool.error ?? tool.resultText}</pre>
          </>
        ) : null}
      </div>
    </details>
  );
}

function ToolCallGroup({ tools }: { tools: ToolCallItem[] }) {
  const defaultOpen = tools.some((tool) => tool.status !== "complete");

  return (
    <details className="tool-call-group" open={defaultOpen}>
      <summary className="tool-call-group-head">已调用 {tools.length} 个工具</summary>
      <div className="tool-call-list">
        {tools.map((tool) => (
          <ToolCallCard key={tool.id} tool={tool} />
        ))}
      </div>
    </details>
  );
}

function AssistantMessageContent({ message }: { message: ChatMessage }) {
  const entries = buildAssistantInlineEntries(message.content, message.toolCalls);

  if (entries.length === 0) {
    return <MessageRenderer content={message.content} streaming={message.streaming} />;
  }

  const lastTextEntryIndex = entries.reduce(
    (lastIndex, entry, index) => (entry.content.trim() ? index : lastIndex),
    -1
  );

  return (
    <div className="assistant-flow">
      {entries.map((entry, index) => (
        <div className="assistant-flow-block" key={`${message.id}-${entry.key}`}>
          {entry.content.trim() ? (
            <MessageRenderer
              content={entry.content}
              streaming={message.streaming && index === lastTextEntryIndex}
            />
          ) : null}

          {entry.toolGroups.length > 0 ? (
            <div className="tool-call-list inline-tool-call-list">
              {entry.toolGroups.map((tools) => (
                <ToolCallGroup key={tools.map((tool) => tool.id).join("-")} tools={tools} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const MessageItem = memo(function MessageItem({ message }: { message: ChatMessage }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="message-avatar" aria-hidden="true">
        {message.role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}
      </div>
      <div className="message-body">
        {message.role === "assistant" ? (
          <AssistantMessageContent message={message} />
        ) : (
          <p className="user-message-text">{message.content}</p>
        )}

        {message.reasoning ? (
          <details className="reasoning-block">
            <summary>思考过程</summary>
            <p>{message.reasoning}</p>
          </details>
        ) : null}

        {message.error ? <p className="message-error">{message.error}</p> : null}
      </div>
    </article>
  );
});

function App() {
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
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left">
          <button className="icon-button" aria-label="侧边栏">
            <PanelLeft size={16} />
          </button>
          <button className="icon-button muted" aria-label="后退">
            <ArrowLeft size={16} />
          </button>
          <button className="icon-button muted" aria-label="前进">
            <ArrowRight size={16} />
          </button>
          <nav className="title-menu" aria-label="应用菜单">
            <button>文件</button>
            <button>编辑</button>
            <button>视图</button>
            <button>帮助</button>
          </nav>
        </div>
        <div className="titlebar-center">PC Repair Agent</div>
        <div className="window-controls">
          <button aria-label="最小化" onClick={() => void handleWindowAction("minimize")}>
            <Minus size={15} />
          </button>
          <button aria-label="最大化" onClick={() => void handleWindowAction("maximize")}>
            <Square size={13} />
          </button>
          <button aria-label="关闭" onClick={() => void handleWindowAction("close")}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-actions">
            <button className="nav-command primary" onClick={createSession}>
              <MessageSquarePlus size={16} />
              <span>新对话</span>
            </button>
            <label className="search-box">
              <Search size={15} />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜索会话"
              />
            </label>
            <button className="nav-command">
              <Wrench size={16} />
              <span>技能</span>
            </button>
            <button className="nav-command">
              <ShieldCheck size={16} />
              <span>审批</span>
            </button>
          </div>

          <div className="session-list" aria-label="会话列表">
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                className={`session-item ${session.id === activeSession.id ? "active" : ""}`}
                onClick={() => selectSession(session.id)}
              >
                <span className={`status-dot ${session.status}`} />
                <span className="session-copy">
                  <span className="session-title">{session.title}</span>
                  <span className="session-preview">{session.preview}</span>
                </span>
                <span className="session-time">{formatTimeLabel(session.updatedAt)}</span>
              </button>
            ))}
          </div>

          <div className="sidebar-footer">
            <button className="nav-command">
              <Settings size={16} />
              <span>设置</span>
            </button>
          </div>
        </aside>

        <main className="main-panel">
          <section className="conversation-header">
            <div className="conversation-title">
              <h1>{activeSession.title}</h1>
              <button className="icon-button" aria-label="更多">
                <MoreHorizontal size={17} />
              </button>
            </div>
            <div className="header-actions">
              <button className="outline-action">
                <ShieldCheck size={15} />
                {activeTurnId ? "Agent 运行中" : "完全访问"}
                <ChevronDown size={14} />
              </button>
              <button className="icon-button" aria-label="布局">
                <LayoutList size={16} />
              </button>
              <button className="icon-button" aria-label="参数">
                <SlidersHorizontal size={16} />
              </button>
            </div>
          </section>

          <section className="chat-scroll">
            <div className="chat-content">
              <div className="session-banner">
                <div>
                  <span className="eyebrow">当前会话</span>
                  <strong>{formatSessionStatus(activeSession.status)}</strong>
                </div>
                <p>所有命令执行、下载、安装和系统修改都会先经过风险说明与用户确认。</p>
              </div>

              {activeMessages.length === 0 ? (
                <section className="empty-state">
                  <Bot size={22} />
                  <strong>描述电脑问题，Agent 会先生成只读检查计划。</strong>
                  <span>涉及下载、安装、删除、移动、环境变量或注册表修改时，会先说明用途和风险，再等待确认。</span>
                </section>
              ) : null}

              {activeMessages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}

            </div>
          </section>

          <div className="composer-wrap">
            <div className="composer-stack">
              {pendingApproval ? (
                <section className="approval-panel">
                  <div className="approval-summary">
                    <div>
                      <span className="eyebrow">需要确认</span>
                      <strong>{pendingApproval.name}</strong>
                      <p>
                        {formatRisk(pendingApproval.risk)}。{pendingApproval.purpose}
                      </p>
                      <span className="approval-args">参数：{summarizeArguments(pendingApproval.argumentsText)}</span>
                    </div>
                    <div className="approval-actions">
                      <button onClick={() => void resolveApproval("deny")}>拒绝</button>
                      <button className="primary" onClick={() => void resolveApproval("allow")}>
                        允许
                      </button>
                    </div>
                  </div>
                  <details className="approval-detail">
                    <summary>查看详情</summary>
                    <dl>
                      <dt>影响范围</dt>
                      <dd>{pendingApproval.impact}</dd>
                      <dt>回滚方式</dt>
                      <dd>{pendingApproval.rollback}</dd>
                    </dl>
                    {pendingApproval.risks.length > 0 ? (
                      <ul>
                        {pendingApproval.risks.map((risk) => (
                          <li key={risk}>{risk}</li>
                        ))}
                      </ul>
                    ) : null}
                    <pre>{pendingApproval.argumentsText}</pre>
                  </details>
                </section>
              ) : null}

              <div className="composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="描述电脑问题，或要求继续变更"
                rows={2}
              />
              <div className="composer-actions">
                <div className="composer-left">
                  <button className="icon-button" aria-label="添加附件">
                    <Paperclip size={17} />
                  </button>
                  <button className="text-action">
                    <ShieldCheck size={15} />
                    完全访问
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="composer-right">
                  <button className="model-chip">
                    DeepSeek V4 Flash
                    <ChevronDown size={14} />
                  </button>
                  <button
                    className={`send-button ${activeTurnId ? "stop" : ""}`}
                    onClick={activeTurnId ? () => void stopCurrentTurn() : () => void sendMessage()}
                    aria-label={activeTurnId ? "停止" : "发送"}
                  >
                    {activeTurnId ? <Square size={13} /> : <Send size={17} />}
                  </button>
                </div>
              </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
