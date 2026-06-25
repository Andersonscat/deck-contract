/**
 * On-demand image generation. Claude (the chat model) cannot draw, so when it wants a picture
 * it emits a high-level `generate_image` op; the server calls a real image model here, caches
 * the bytes locally, and rewrites the op into a normal image-caption insert/replace. The chosen
 * src is then stored in the deck, so compile stays pure and deterministic.
 */
export async function generateImage(
  prompt: string,
  apiKey: string,
  size = "1024x1024",
): Promise<Buffer> {
  // Generate a clean cutout (no opaque box): transparent background + isolated subject, so the
  // picture drops onto a slide as a sticker rather than a dark square.
  const fullPrompt =
    prompt.trim() +
    ". Full body, natural vivid colours, isolated on a fully transparent background, no scenery, no backdrop, no shadow, no white outline or border, centered with generous margins.";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: fullPrompt,
      size,
      n: 1,
      background: "transparent",
      output_format: "png",
    }),
  });
  if (!res.ok) {
    throw new Error("openai images " + res.status + ": " + (await res.text()).slice(0, 300));
  }
  const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (b64) return Buffer.from(b64, "base64");
  // gpt-image-1 returns b64_json, but fall back to a url-based model just in case.
  const url = data.data?.[0]?.url;
  if (url) {
    const img = await fetch(url);
    if (!img.ok) throw new Error("openai images: fetch url " + img.status);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("openai images: no image in response");
}

/**
 * Tier-2 perception: the ONE genuinely non-measurable check. "Is this actually a giraffe" can't
 * be computed, so ask a vision model to confirm the generated picture matches the prompt. Fails
 * OPEN (a flaky vision call never blocks the edit) and is only used to surface an honest note.
 */
export async function verifyImage(
  png: Buffer,
  prompt: string,
  anthropicKey: string,
  model = "claude-haiku-4-5",
): Promise<{ matches: boolean; sees: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
              {
                type: "text",
                text: `Is the MAIN SUBJECT of this request clearly present in the image: "${prompt}"? Judge ONLY the subject — ignore background, scenery, setting and style (the image is intentionally an isolated cut-out on a transparent/blank background). Set matches:false ONLY if the subject is absent or is the WRONG thing. Reply ONLY with JSON {"matches": true|false, "sees": "<3-6 word description of the subject shown>"}.`,
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return { matches: true, sees: "" };
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(" ");
    const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}") as { matches?: boolean; sees?: string };
    return { matches: j.matches !== false, sees: j.sees ?? "" };
  } catch {
    return { matches: true, sees: "" };
  }
}
