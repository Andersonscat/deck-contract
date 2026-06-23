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
  if (node.type === "bar") return `${c.label ? c.label + " " : ""}${c.barValue ?? "?"}%`;
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
    "- bar-chart (role chart): a CONTAINER whose children are individual `bar` components (one per column), in order. Words: график, диаграмма, chart, bar chart.",
    "- bar (role bar): ONE column of a bar-chart, individually addressable by its id. content.barValue is its height 0..100; style.color is its fill. \"the third bar / третий столбец\" = the 3rd `bar` child of that chart, in order. Edit ONE bar: set_token {prop:color} to recolour it, set_content {barValue:N} to change its height/size. Never edit the others unless asked.",
    "",
    "Rules: style/colors only via set_token with theme tokens (never raw hex/px). Only edit nodes that exist.",
    "Available theme tokens: " + tokens(deck),
    "All components:\n" + outline(deck),
    currentSlideId ? 'The user is viewing slide: ' + currentSlideId + ' (treat "this slide"/"here"/"эта страница" as it).' : "",
    selectedNode
      ? "The user has SELECTED this component — treat \"this\"/\"it\"/\"это\" and the bare noun (title/название/метрика…) as THIS node unless they clearly mean another:\n" +
        JSON.stringify(selectedNode)
      : "No component is selected — resolve the target from the components list by role on the current slide.",
    "Call the edit_deck tool. Put a SHORT, friendly message in `reply` (plain English, never JSON, ops, ids, or code). Put the edits in `ops` (empty array if nothing to change). Do not write anything outside the tool call.",
  ].join("\n");

  const tools = [
    {
      name: "edit_deck",
      description: "Apply id-addressed edits to the deck and give the user a short message.",
      input_schema: {
        type: "object",
        properties: {
          reply: {
            type: "string",
            description: "A short, friendly message to the user in English. Never include JSON, ops, ids, or code.",
          },
          ops: { type: "array", items: { type: "object" }, description: "The id-addressed ops to apply." },
        },
        required: ["reply", "ops"],
      },
    },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: message }],
      tools,
      tool_choice: { type: "tool", name: "edit_deck" },
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + ": " + (await res.text()).slice(0, 300));
  const data = (await res.json()) as {
    content?: Array<{ type: string; name?: string; input?: { reply?: string; ops?: unknown[] } }>;
  };
  // tool_choice forces a single edit_deck tool call: reply is clean text, ops is structured.
  const tu = (data.content ?? []).find((c) => c.type === "tool_use" && c.name === "edit_deck");
  if (tu && tu.input) {
    return { reply: tu.input.reply ?? "Done.", ops: Array.isArray(tu.input.ops) ? tu.input.ops : [] };
  }
  return { reply: "Sorry, I couldn't process that. Try rephrasing.", ops: [] };
}
