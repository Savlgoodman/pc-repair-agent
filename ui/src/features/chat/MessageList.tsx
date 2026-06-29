import { Bot, UserRound } from "lucide-react";
import { memo } from "react";

import { MessageRenderer } from "../../components/MessageRenderer";
import type { ChatMessage, Session } from "../../types";
import { buildAssistantInlineEntries } from "./messageTools";
import { ToolCallGroup } from "./ToolCallViews";

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

interface MessageListProps {
  messages: ChatMessage[];
  session: Session;
  statusLabel: string;
}

export function MessageList({ messages, session, statusLabel }: MessageListProps) {
  return (
    <section className="chat-scroll">
      <div className="chat-content">
        <div className="session-banner">
          <div>
            <span className="eyebrow">当前会话</span>
            <strong>{statusLabel}</strong>
          </div>
          <p>所有命令执行、下载、安装和系统修改都会先经过风险说明与用户确认。</p>
        </div>

        {messages.length === 0 ? (
          <section className="empty-state">
            <Bot size={22} />
            <strong>描述电脑问题，Agent 会先生成只读检查计划。</strong>
            <span>涉及下载、安装、删除、移动、环境变量或注册表修改时，会先说明用途和风险，再等待确认。</span>
          </section>
        ) : null}

        {messages.map((message) => (
          <MessageItem key={`${session.id}-${message.id}`} message={message} />
        ))}
      </div>
    </section>
  );
}
