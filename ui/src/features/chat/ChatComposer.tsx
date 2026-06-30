import { ChevronDown, Paperclip, Send, ShieldCheck, Square } from "lucide-react";

import type { ApprovalRequest, ConfiguredModel } from "../../types";
import { ApprovalCard } from "./ApprovalCard";

interface ChatComposerProps {
  activeTurnId: string | null;
  draft: string;
  models: ConfiguredModel[];
  onDraftChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
  onResolveApproval: (decision: "allow" | "deny") => void;
  onSendMessage: () => void;
  onStopTurn: () => void;
  pendingApproval: ApprovalRequest | null;
  selectedModelId: string | null;
}

export function ChatComposer({
  activeTurnId,
  draft,
  models,
  onDraftChange,
  onModelChange,
  onResolveApproval,
  onSendMessage,
  onStopTurn,
  pendingApproval,
  selectedModelId
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
              <label className="model-chip">
                <select
                  aria-label="选择模型"
                  disabled={models.length === 0}
                  onChange={(event) => onModelChange(event.target.value)}
                  value={selectedModelId ?? ""}
                >
                  {models.length === 0 ? <option value="">未配置模型</option> : null}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
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
