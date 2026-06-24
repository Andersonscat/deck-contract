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
