import { z } from "zod";
import { getCurrentUser } from "@/lib/services/user";
import { getWorkspace } from "@/lib/services/queries";
import { describeCopilotError, runCopilot, type CopilotEvent } from "@/lib/ai/copilot";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1].role === "user", "Last message must be from the user"),
});

/** Streams newline-delimited JSON CopilotEvents. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const user = await getCurrentUser();
  const workspace = await getWorkspace(user.id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: CopilotEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        for await (const event of runCopilot(parsed.data.messages, { ...workspace, baseCurrency: user.baseCurrency }, req.signal)) send(event);
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[copilot]", err);
          send({ type: "error", message: describeCopilotError(err) });
          send({ type: "done" });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
