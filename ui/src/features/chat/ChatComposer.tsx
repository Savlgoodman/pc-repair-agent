import { ChevronDown, Paperclip, Send, ShieldCheck, Square } from "lucide-react";

import type { ApprovalRequest } from "../../types";
import { ApprovalCard } from "./ApprovalCard";

interface ChatComposerProps {
  activeTurnId: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onResolveApproval: (decision: "allow" | "deny") => void;
  onSendMessage: () => void;
  onStopTurn: () => void;
  pendingApproval: ApprovalRequest | null;
}

export function ChatComposer({
  activeTurnId,
  draft,
  onDraftChange,
  onResolveApproval,
  onSendMessage,
  onStopTurn,
  pendingApproval
}: ChatComposerProps) {
  return (
    <div className="composer-wrap">
      <div className="composer-stack">
        {pendingApproval ? <ApprovalCard approval={pendingApproval} onResolve={onResolveApproval} /> : null}

        <div className="composer">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSendMessage();
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
                onClick={activeTurnId ? onStopTurn : onSendMessage}
                aria-label={activeTurnId ? "停止" : "发送"}
              >
                {activeTurnId ? <Square size={13} /> : <Send size={17} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
