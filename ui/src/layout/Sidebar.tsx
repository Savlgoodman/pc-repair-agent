import { MessageSquarePlus, Search, Settings, ShieldCheck, Wrench } from "lucide-react";

import { formatTimeLabel } from "../lib/formatters";
import type { Session } from "../types";

interface SidebarProps {
  activeSessionId: string;
  onCreateSession: () => void;
  onSearchTextChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
  searchText: string;
  sessions: Session[];
}

export function Sidebar({
  activeSessionId,
  onCreateSession,
  onSearchTextChange,
  onSelectSession,
  searchText,
  sessions
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="nav-command primary" onClick={onCreateSession}>
          <MessageSquarePlus size={16} />
          <span>新对话</span>
        </button>
        <label className="search-box">
          <Search size={15} />
          <input
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
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
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? "active" : ""}`}
            onClick={() => onSelectSession(session.id)}
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
  );
}
