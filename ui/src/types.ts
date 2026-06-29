export type SessionStatus = "idle" | "running" | "approval" | "error";

export interface Session {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  reasoning?: string;
  streaming?: boolean;
  error?: string;
  toolCalls: ToolCallItem[];
  usage?: UsageStats;
}

export interface ToolCallItem {
  id: string;
  name: string;
  argumentsText: string;
  resultText?: string;
  status: "pending" | "running" | "complete" | "error" | "approval";
  risk?: "low" | "medium" | "high" | "blocked";
  error?: string;
  anchorOffset?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalRequest {
  approvalId: string;
  toolCallId?: string;
  name: string;
  argumentsText: string;
  risk: "low" | "medium" | "high" | "blocked";
  purpose: string;
  impact: string;
  risks: string[];
  rollback: string;
}

export interface UsageStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type AgentEvent =
  | {
      type: "conversation.turn.started";
      conversationId: string;
      turnId: string;
      session: Session;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }
  | {
      type: "agent.run.started";
      conversationId: string;
      turnId: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "agent.text.delta";
      conversationId: string;
      turnId: string;
      delta: string;
    }
  | {
      type: "agent.text.completed";
      conversationId: string;
      turnId: string;
      resuming?: boolean;
    }
  | {
      type: "agent.reasoning.delta";
      conversationId: string;
      turnId: string;
      delta: string;
    }
  | {
      type: "agent.reasoning.completed";
      conversationId: string;
      turnId: string;
      content?: string;
    }
  | {
      type: "agent.tool.started";
      conversationId: string;
      turnId: string;
      toolCallId: string;
      name: string;
      arguments?: unknown;
      risk?: ToolCallItem["risk"];
    }
  | {
      type: "agent.tool.completed";
      conversationId: string;
      turnId: string;
      toolCallId: string;
      name: string;
      result?: unknown;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "agent.tool.failed";
      conversationId: string;
      turnId: string;
      toolCallId: string;
      name: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "approval.required";
      conversationId: string;
      turnId: string;
      approvalId: string;
      toolCallId?: string;
      name: string;
      arguments?: unknown;
      argumentsText?: string;
      risk: "low" | "medium" | "high" | "blocked";
      purpose: string;
      impact: string;
      risks: string[];
      rollback: string;
    }
  | {
      type: "agent.run.completed";
      conversationId: string;
      turnId: string;
      result?: unknown;
      session?: Session;
      usage?: unknown;
    }
  | {
      type: "agent.run.failed";
      conversationId: string;
      turnId: string;
      error?: string;
      session?: Session;
    };
