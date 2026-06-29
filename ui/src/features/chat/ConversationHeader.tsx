import { ChevronDown, LayoutList, MoreHorizontal, ShieldCheck, SlidersHorizontal } from "lucide-react";

interface ConversationHeaderProps {
  isRunning: boolean;
  title: string;
}

export function ConversationHeader({ isRunning, title }: ConversationHeaderProps) {
  return (
    <section className="conversation-header">
      <div className="conversation-title">
        <h1>{title}</h1>
        <button className="icon-button" aria-label="更多">
          <MoreHorizontal size={17} />
        </button>
      </div>
      <div className="header-actions">
        <button className="outline-action">
          <ShieldCheck size={15} />
          {isRunning ? "Agent 运行中" : "完全访问"}
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
  );
}
