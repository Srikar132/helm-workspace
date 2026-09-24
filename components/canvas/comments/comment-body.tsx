import type { ReactNode } from "react";

/**
 * Renders a stored comment (ProseMirror JSON, comment schema) as React
 * elements. Cheaper than a read-only editor per comment, and never an HTML
 * string: text is text, and the only attribute taken from the document is a
 * link href, which must be http(s) or mailto.
 */

type Mark = { type?: unknown; attrs?: { href?: unknown } };
type Node = { type?: unknown; text?: unknown; marks?: Mark[]; attrs?: { label?: unknown }; content?: unknown };

function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

function withMarks(text: ReactNode, marks: Mark[] | undefined, key: string): ReactNode {
  return (marks ?? []).reduce<ReactNode>((inner, mark, i) => {
    const k = `${key}-m${i}`;
    switch (mark.type) {
      case "bold":
        return <strong key={k}>{inner}</strong>;
      case "italic":
        return <em key={k}>{inner}</em>;
      case "strike":
        return <s key={k}>{inner}</s>;
      case "underline":
        return <u key={k}>{inner}</u>;
      case "code":
        return (
          <code key={k} className="rounded bg-muted px-1 font-mono text-[0.9em]">
            {inner}
          </code>
        );
      case "link": {
        const href = safeHref(mark.attrs?.href);
        return href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">
            {inner}
          </a>
        ) : (
          inner
        );
      }
      default:
        return inner;
    }
  }, text);
}

function renderInline(node: Node, key: string): ReactNode {
  if (node.type === "text" && typeof node.text === "string") return withMarks(node.text, node.marks, key);
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "mention") {
    const label = typeof node.attrs?.label === "string" ? node.attrs.label : "someone";
    return (
      <span key={key} className="mention">
        @{label}
      </span>
    );
  }
  return null;
}

export function CommentBody({ body }: { body: Record<string, unknown> }) {
  const blocks = Array.isArray(body.content) ? (body.content as Node[]) : [];
  return (
    <div className="comment-body space-y-1 break-words text-[13px] leading-relaxed">
      {blocks.map((block, b) => {
        const inline = Array.isArray(block.content) ? (block.content as Node[]) : [];
        return (
          <p key={b} className="min-h-[1em]">
            {inline.map((child, i) => renderInline(child, `${b}-${i}`))}
          </p>
        );
      })}
    </div>
  );
}
