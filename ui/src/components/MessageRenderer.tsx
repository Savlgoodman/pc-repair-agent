import { memo, type ComponentProps } from "react";
import { Streamdown, type Components, type ExtraProps } from "streamdown";

interface MessageRendererProps {
  content: string;
  streaming?: boolean;
}

function MarkdownTable({ children, node: _node, ...props }: ComponentProps<"table"> & ExtraProps) {
  return (
    <div className="markdown-table-scroll">
      <table {...props}>{children}</table>
    </div>
  );
}

const markdownComponents: Components = {
  table: MarkdownTable
};

export const MessageRenderer = memo(function MessageRenderer({ content, streaming }: MessageRendererProps) {
  return (
    <div className="streamdown-shell">
      <Streamdown
        animated={Boolean(streaming)}
        className="streamdown-body"
        components={markdownComponents}
        isAnimating={Boolean(streaming)}
        mode={streaming ? "streaming" : "static"}
      >
        {content || (streaming ? "..." : "")}
      </Streamdown>
    </div>
  );
});
