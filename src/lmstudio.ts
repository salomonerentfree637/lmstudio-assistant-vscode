export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chatCompletion(
  baseUrl: string,
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  return data?.choices?.[0]?.message?.content ?? "";
}
