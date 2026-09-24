/**
 * Mention extraction over stored ProseMirror JSON — pure, shared by the save
 * actions and the tests.
 *
 * The id-carrying `mention` node (lib/tiptap/note-extensions.ts) is the only
 * source of truth. Plain "@name" text is never parsed: names aren't unique and
 * change, so a text match would notify the wrong person.
 */

type JsonNode = { type?: unknown; attrs?: unknown; content?: unknown };

/** Distinct mentioned user ids, in document order. Tolerates any shape —
 *  it reads a JSONB column the client wrote, so nothing here is trusted. */
export function extractMentionIds(doc: unknown): string[] {
  const ids = new Set<string>();
  const stack: unknown[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop() as JsonNode | null | undefined;
    if (!node || typeof node !== "object") continue;
    if (node.type === "mention" && node.attrs && typeof node.attrs === "object") {
      const id = (node.attrs as { id?: unknown }).id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
    if (Array.isArray(node.content)) {
      // Reverse so popping walks children left-to-right.
      for (let i = node.content.length - 1; i >= 0; i--) stack.push(node.content[i]);
    }
  }
  return [...ids];
}

/** Ids present in `next` that were not in `prev` — who a save newly mentions. */
export function diffMentions(prev: unknown, next: unknown): string[] {
  const before = new Set(extractMentionIds(prev));
  return extractMentionIds(next).filter((id) => !before.has(id));
}

/** Plain-text preview of a doc for a notification line. */
export function docSnippet(doc: unknown, max = 140): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as JsonNode & { text?: unknown };
    if (typeof n.text === "string") parts.push(n.text);
    if (n.type === "mention" && n.attrs && typeof n.attrs === "object") {
      const label = (n.attrs as { label?: unknown }).label;
      if (typeof label === "string") parts.push(`@${label}`);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
      parts.push(" ");
    }
  };
  walk(doc);
  const text = parts.join("").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** What a public viewer sees in place of a mention. */
export const REDACTED_MENTION_TEXT = "@teammate";

/**
 * A copy of the doc with every mention replaced by plain `@teammate` text — no
 * name, no user id. For the public share page: its page JSON is serialized
 * into the HTML payload, so hiding the chip in the renderer would still ship
 * the id and name to anyone with the link. Returns the input untouched when
 * it isn't an object.
 */
export function redactMentions<T>(doc: T): T {
  if (!doc || typeof doc !== "object") return doc;
  const node = doc as JsonNode & Record<string, unknown>;
  if (node.type === "mention") {
    return { type: "text", text: REDACTED_MENTION_TEXT } as T;
  }
  if (!Array.isArray(node.content)) return doc;
  return { ...node, content: node.content.map((child) => redactMentions(child)) } as T;
}
