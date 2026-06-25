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
  /** What the harness should verify against the user's intent after applying the ops. */
  verify: "none" | "readability";
}

function preview(node: DeckNode): string {
  const c = node.content ?? {};
  if (node.type === "bar-fill") return `${c.barValue ?? "?"}%`;
  const t = c.text ?? c.items?.[0] ?? c.value ?? c.caption ?? "";
  return t.length > 50 ? t.slice(0, 47) + "…" : t;
}

function outline(deck: Deck): string {
  const rows: string[] = [];
  for (const { node, slideId } of buildIndex(deck).values()) {
    const text = node.content?.text ?? "";
    const marks = node.content?.marks ?? [];
    const m = marks.length
      ? `  marks:[${marks.map((k) => `${k.from}-${k.to} "${text.slice(k.from, k.to)}" ${JSON.stringify(k.style)}`).join("; ")}]`
      : "";
    rows.push(`${node.id} [${node.type}${node.role ? "/" + node.role : ""}] slide=${slideId} "${preview(node)}"${m}`);
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
  model = "claude-haiku-4-5",
  imagesEnabled = false,
): Promise<ChatResult> {
  const selectedNode = selection ? buildIndex(deck).get(selection.nodeId)?.node : undefined;

  const system = [
    "You edit a slide deck by returning JSON ops. Address every node by its stable id.",
    "Ops:",
    '- {"op":"set_text","nodeId":ID,"value":STRING}   (only a node\'s .text — titles/headings)',
    '- {"op":"set_content","nodeId":ID,"content":{...}}   (replace content fields: text | items[] | value,label,delta | src,alt,caption)',
    '- {"op":"set_token","nodeId":ID,"prop":"color"|"size"|"font"|...,"value":"token://ns/name"}   (styles the WHOLE node)',
    '- {"op":"set_token_where","selector":{"hasText":true,"slideId":SLIDE?,"types":[...]?},"prop":"color","value":"token://ns/name"}   (BULK: style EVERY node matching the selector at once — use this for "all text", "every title", etc. The harness enumerates the nodes; you only pick the token. Prefer this over many set_token ops when the user says all/every.)',
    '- {"op":"format_range","nodeId":ID,"target":{"match":"word"}|{"from":N,"to":M},"prop":"color"|"font"|"size","value":"token://ns/name"}   (style ONE word/phrase/letter INSIDE a text)',
    '- {"op":"clear_range","nodeId":ID,"target":{"match":"word"}|{"from":N,"to":M},"prop":"color"|"font"|"size"}   (remove a sub-text style)',
    '- {"op":"insert_node","parentId":ID,"index":N,"node":{...}}',
    '- {"op":"remove_node","nodeId":ID}',
    '- {"op":"move_node","nodeId":ID,"newParentId":ID,"index":N}',
    ...(imagesEnabled
      ? [
          '- {"op":"generate_image","prompt":STRING,"mode":"insert"|"replace","target":ID}   (GENERATE a real picture and place it. Use this for ANY "make/draw/add a picture of X" or "turn this into X / поменяй на X". mode:"replace" + target=the node to become the picture (the selected node if the user pointed at one); mode:"insert" to add a new picture to the current slide. The prompt is a vivid ENGLISH image description of the subject in its NATURAL, full colour, full body, on a transparent background; do NOT darken, grey out, or monochrome it to match the deck, and do not ask for a white outline. NEVER fake an image request by writing the word into a text/label field — always use this op.)',
        ]
      : []),
    "",
    "Component types and the words users use for them:",
    "- title (role slide-title/title): the slide headline. Words: заголовок, название, title, headline. Edit: set_text.",
    "- heading (role subtitle): a sub-heading. Words: подзаголовок, subtitle. Edit: set_text.",
    "- heading (role heading/quote): secondary heading or quote text. Edit: set_text.",
    "- bullet-list (role supporting-points): bullet points. Words: список, буллеты, list, points. Edit: set_content { items:[...] }.",
    "- stat-callout (role key-metric): a big metric. Words: метрика, число, показатель, KPI. Edit: set_content { value, label, delta }.",
    "- image-caption (role visual): image + caption. Words: картинка, изображение, image. Edit: set_content { src, alt, caption }.",
    "- bar-chart (role chart): a CONTAINER whose children are individual `bar` components (one per column), in order. Words: график, диаграмма, chart, bar chart.",
    "- bar (role bar): ONE column of a bar-chart, a CONTAINER decomposed into three atomic children, each individually addressable by id: bar-value (the number on top, content.text), bar-fill (the rectangle — content.barValue height 0..100, style.color the fill), bar-label (the category underneath, content.text). \"the third bar / третий столбец\" = the 3rd `bar` child of the chart, in order; its atoms are that bar's children. To recolour a column: set_token {prop:color} on its bar-fill. To change its height: set_content {barValue} on the bar-fill. To change the number/label: set_content {text} on its bar-value / bar-label. Touch only the atoms you're asked to.",
    "",
    "Rules: style/colors only via set_token / format_range with theme tokens (never raw hex/px). Only edit nodes that exist.",
    "Honesty: if you genuinely cannot do what was asked (it needs a capability you don't have, or the targeted node has no relevant field for it), say so plainly in `reply` and return an EMPTY ops array. NEVER fake it by editing a different node or stuffing the request into a text/label field. Respect the user's selected node.",
    'Verification: set `verify` to "readability" ONLY when the user explicitly wants text to be visible/legible/readable (e.g. "make the text visible", "сделай текст читаемым"). Then recolor the text to a contrasting token (set_token_where over text nodes is ideal) and the harness will MEASURE the contrast and keep going until it is legible. If the user wants a specific look even if low-contrast (e.g. "black text on black", a deliberate effect), set `verify` to "none" — never override their choice. Default is "none".',
    'To recolour/restyle ONE word, letter, or phrase INSIDE a text (e.g. "make the word build orange"), use format_range with target {match:"build"} — the server finds the character offsets itself; never compute offsets by hand. Use set_token only when the user means the WHOLE text node.',
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
          verify: {
            type: "string",
            enum: ["none", "readability"],
            description: "\"readability\" ONLY if the user asked for visible/legible text; else \"none\".",
          },
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
    content?: Array<{ type: string; name?: string; input?: { reply?: string; ops?: unknown[]; verify?: string } }>;
  };
  // tool_choice forces a single edit_deck tool call: reply is clean text, ops is structured.
  const tu = (data.content ?? []).find((c) => c.type === "tool_use" && c.name === "edit_deck");
  if (tu && tu.input) {
    return {
      reply: tu.input.reply ?? "Done.",
      ops: Array.isArray(tu.input.ops) ? tu.input.ops : [],
      verify: tu.input.verify === "readability" ? "readability" : "none",
    };
  }
  return { reply: "Sorry, I couldn't process that. Try rephrasing.", ops: [], verify: "none" };
}
