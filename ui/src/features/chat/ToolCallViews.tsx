import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";

import { formatRisk } from "../../lib/formatters";
import type { ToolCallItem } from "../../types";

function toolResultSummary(tool: ToolCallItem) {
  const value = tool.error ?? tool.resultText ?? "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return tool.status === "approval" ? "等待确认" : "运行中";
  }
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
}

export function ToolCallCard({ tool }: { tool: ToolCallItem }) {
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

export function ToolCallGroup({ tools }: { tools: ToolCallItem[] }) {
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
