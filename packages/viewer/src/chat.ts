import { buildIndex } from "@deck/core";
import type { Deck, DeckNode } from "@deck/contract";

/**
 * The right-panel AI chat. It runs on the user's own Anthropic key (same idea as the
 * MCP path: the builder pays nothing for inference) and edits the deck by returning the
 * same id-addressed ops the rest of the system uses. One round-trip per message.
 */
export interface ChatResult {
  reply: string;
  ops: unknown[];
}

function preview(node: DeckNode): string {
  const c = node.content ?? {};
  const t = c.text ?? c.items?.[0] ?? c.value ?? c.caption ?? "";
  return t.length > 50 ? t.slice(0, 47) + "…" : t;
}

function outline(deck: Deck): string {
  const rows: string[] = [];
  for (const { node, slideId } of buildIndex(deck).values()) {
    rows.push(`${node.id} [${node.type}${node.role ? "/" + node.role : ""}] slide=${slideId} "${preview(node)}"`);
  }
  return rows.join("\n");
}

function tokens(deck: Deck): string {
  const out: string[] = [];
  const t = deck.theme as unknown as Record<string, Record<string, string>>;
  for (const ns of ["color", "font", "type", "space", "radius"]) {
    const g = t[ns];
    if (g) for (const k of Object.keys(g)) out.push(`token://${ns}/${k}`);
  }
  return out.join(", ");
}

function extractJson(text: string): { reply?: string; ops?: unknown[] } {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1]!.trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    return JSON.parse(s);
  } catch {
    return { reply: text.trim(), ops: [] };
  }
}

export async function runChat(
  message: string,
  deck: Deck,
  selection: { nodeId: string } | null,
  apiKey: string,
  currentSlideId?: string,
  model = "claude-sonnet-4-6",
): Promise<ChatResult> {
  const selectedNode = selection ? buildIndex(deck).get(selection.nodeId)?.node : undefined;

  const system = [
    "You edit a slide deck by returning JSON ops. Address every node by its stable id.",
    "Ops:",
    '- {"op":"set_text","nodeId":ID,"value":STRING}   (only a node\'s .text — titles/headings)',
    '- {"op":"set_content","nodeId":ID,"content":{...}}   (replace content fields: text | items[] | value,label,delta | src,alt,caption)',
    '- {"op":"set_token","nodeId":ID,"prop":"color"|"size"|"font"|...,"value":"token://ns/name"}',
    '- {"op":"insert_node","parentId":ID,"index":N,"node":{...}}',
    '- {"op":"remove_node","nodeId":ID}',
    '- {"op":"move_node","nodeId":ID,"newParentId":ID,"index":N}',
    "",
    "Component types and the words users use for them:",
    "- title (role slide-title/title): the slide headline. Words: заголовок, название, title, headline. Edit: set_text.",
    "- heading (role subtitle): a sub-heading. Words: подзаголовок, subtitle. Edit: set_text.",
    "- heading (role heading/quote): secondary heading or quote text. Edit: set_text.",
    "- bullet-list (role supporting-points): bullet points. Words: список, буллеты, list, points. Edit: set_content { items:[...] }.",
    "- stat-callout (role key-metric): a big metric. Words: метрика, число, показатель, KPI. Edit: set_content { value, label, delta }.",
    "- image-caption (role visual): image + caption. Words: картинка, изображение, image. Edit: set_content { src, alt, caption }.",
    "",
    "Rules: style/colors only via set_token with theme tokens (never raw hex/px). Only edit nodes that exist.",
    "Available theme tokens: " + tokens(deck),
    "All components:\n" + outline(deck),
    currentSlideId ? 'The user is viewing slide: ' + currentSlideId + ' (treat "this slide"/"here"/"эта страница" as it).' : "",
    selectedNode
      ? "The user has SELECTED this component — treat \"this\"/\"it\"/\"это\" and the bare noun (title/название/метрика…) as THIS node unless they clearly mean another:\n" +
        JSON.stringify(selectedNode)
      : "No component is selected — resolve the target from the components list by role on the current slide.",
    'Reply with ONE JSON object and nothing else: {"reply": short message in the user\'s language, "ops": [ ... ]}. Use ops:[] if no edit is needed.',
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages: [{ role: "user", content: message }] }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + ": " + (await res.text()).slice(0, 300));
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = (data.content ?? []).map((c) => c.text ?? "").join("");
  const parsed = extractJson(text);
  return { reply: parsed.reply ?? "(no reply)", ops: Array.isArray(parsed.ops) ? parsed.ops : [] };
}
