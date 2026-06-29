import { Streamdown } from "streamdown";

interface MessageRendererProps {
  content: string;
  streaming?: boolean;
}

export function MessageRenderer({ content, streaming }: MessageRendererProps) {
  return (
    <div className="streamdown-shell">
      <Streamdown
        animated
        className="streamdown-body"
        isAnimating={Boolean(streaming)}
        mode={streaming ? "streaming" : "static"}
      >
        {content || (streaming ? "..." : "")}
      </Streamdown>
    </div>
  );
}
