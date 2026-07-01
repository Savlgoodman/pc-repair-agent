import { useEffect, useMemo, useRef, useState } from "react";

import { Check, ChevronDown, ChevronRight, Flame, Gauge, Paperclip, Send, ShieldQuestion, Square, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ApprovalRequest, CommandPermissionMode, ConfiguredModel } from "../../types";
import { ApprovalCard } from "./ApprovalCard";

interface ChatComposerProps {
  activeTurnId: string | null;
  draft: string;
  models: ConfiguredModel[];
  onDraftChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
  onPermissionModeChange: (mode: CommandPermissionMode) => void;
  onResolveApproval: (decision: "allow" | "deny") => void;
  onSendMessage: () => void;
  onStopTurn: () => void;
  pendingApproval: ApprovalRequest | null;
  permissionMode: CommandPermissionMode;
  permissionModeBusy?: boolean;
  selectedModelId: string | null;
}

const permissionModeOptions = [
  { id: "ask", icon: ShieldQuestion, label: "用户审批", hint: "中高风险确认" },
  { id: "auto", icon: Gauge, label: "自动审批", hint: "高风险确认" },
  { id: "full", icon: Flame, label: "完全允许", hint: "非禁止自动允许" },
  { id: "repair", icon: Wrench, label: "维修模式", hint: "先过维修过滤器" }
] satisfies Array<{ id: CommandPermissionMode; icon: LucideIcon; label: string; hint: string }>;

function permissionModeLabel(mode: CommandPermissionMode) {
  return permissionModeOptions.find((item) => item.id === mode)?.label ?? "用户审批";
}

export function ChatComposer({
  activeTurnId,
  draft,
  models,
  onDraftChange,
  onModelChange,
  onPermissionModeChange,
  onResolveApproval,
  onSendMessage,
  onStopTurn,
  pendingApproval,
  permissionMode,
  permissionModeBusy = false,
  selectedModelId
}: ChatComposerProps) {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isPermissionMenuOpen, setIsPermissionMenuOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const providerGroups = useMemo(() => {
    const groups: Array<{ id: string; name: string; models: ConfiguredModel[] }> = [];
    const indexes = new Map<string, number>();
    for (const model of models) {
      const providerId = model.providerId || "unknown";
      const providerName = model.providerName || "未命名供应商";
      const index = indexes.get(providerId);
      if (index === undefined) {
        indexes.set(providerId, groups.length);
        groups.push({ id: providerId, name: providerName, models: [model] });
      } else {
        groups[index].models.push(model);
      }
    }
    return groups;
  }, [models]);
  const activeProvider =
    providerGroups.find((provider) => provider.id === activeProviderId) ??
    providerGroups.find((provider) => provider.id === selectedModel?.providerId) ??
    providerGroups[0] ??
    null;
  const ActivePermissionIcon = permissionModeOptions.find((item) => item.id === permissionMode)?.icon ?? ShieldQuestion;

  useEffect(() => {
    if (!isModelMenuOpen) {
      return undefined;
    }

    setActiveProviderId(selectedModel?.providerId ?? providerGroups[0]?.id ?? null);

    function closeOnOutside(event: MouseEvent) {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", closeOnOutside);
    return () => window.removeEventListener("mousedown", closeOnOutside);
  }, [isModelMenuOpen, providerGroups, selectedModel?.providerId]);

  useEffect(() => {
    if (!isPermissionMenuOpen) {
      return undefined;
    }

    function closeOnOutside(event: MouseEvent) {
      if (!permissionMenuRef.current?.contains(event.target as Node)) {
        setIsPermissionMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", closeOnOutside);
    return () => window.removeEventListener("mousedown", closeOnOutside);
  }, [isPermissionMenuOpen]);

  function selectModel(modelId: string) {
    onModelChange(modelId);
    setIsModelMenuOpen(false);
  }

  function selectPermissionMode(mode: CommandPermissionMode) {
    onPermissionModeChange(mode);
    setIsPermissionMenuOpen(false);
  }

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
              <div className="permission-picker" ref={permissionMenuRef}>
                <button
                  aria-expanded={isPermissionMenuOpen}
                  aria-haspopup="menu"
                  className={`text-action permission-chip mode-${permissionMode}`}
                  disabled={permissionModeBusy}
                  onClick={() => setIsPermissionMenuOpen((current) => !current)}
                  title={`命令执行权限：${permissionModeLabel(permissionMode)}`}
                  type="button"
                >
                  <ActivePermissionIcon size={15} />
                  <span>{permissionModeLabel(permissionMode)}</span>
                  <ChevronDown size={14} />
                </button>
                {isPermissionMenuOpen ? (
                  <div className="permission-menu" role="menu">
                    {permissionModeOptions.map((option) => {
                      const Icon = option.icon;
                      return (
                        <button
                          className={`permission-menu-item mode-${option.id} ${option.id === permissionMode ? "selected" : ""}`}
                          key={option.id}
                          onClick={() => selectPermissionMode(option.id)}
                          role="menuitem"
                          type="button"
                        >
                          <Icon className="permission-menu-icon" size={15} />
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.hint}</small>
                          </span>
                          {option.id === permissionMode ? <Check size={14} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="composer-right">
              <div className="model-picker" ref={modelMenuRef}>
                <button
                  aria-expanded={isModelMenuOpen}
                  aria-haspopup="menu"
                  className="model-chip"
                  disabled={models.length === 0}
                  onClick={() => setIsModelMenuOpen((current) => !current)}
                  title={selectedModel?.providerName ? `${selectedModel.providerName} / ${selectedModel.label}` : selectedModel?.label}
                  type="button"
                >
                  <span>{selectedModel?.label ?? "未配置模型"}</span>
                  <ChevronDown size={14} />
                </button>
                {isModelMenuOpen ? (
                  <>
                    <div className="model-menu" role="menu">
                      {providerGroups.map((provider) => (
                        <button
                          className={`model-provider-label ${provider.id === activeProvider?.id ? "active" : ""}`}
                          key={provider.id}
                          onClick={() => setActiveProviderId(provider.id)}
                          onMouseEnter={() => setActiveProviderId(provider.id)}
                          type="button"
                        >
                          <span>{provider.name}</span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                    <div className="model-submenu" role="menu">
                      {(activeProvider?.models ?? []).map((model) => (
                        <button
                          className={`model-menu-item ${model.id === selectedModelId ? "selected" : ""}`}
                          key={model.id}
                          onClick={() => selectModel(model.id)}
                          role="menuitem"
                          type="button"
                        >
                          <span>{model.label}</span>
                          {model.id === selectedModelId ? <Check size={14} /> : null}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
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
