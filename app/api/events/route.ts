import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { createDbClient } from "@/lib/db/client";
import { ensurePostgresListener } from "@/lib/events/postgres-listener";
import { dottyEventBus } from "@/lib/events/server-bus";
import type { DottyChange } from "@/lib/events/types";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!z.string().uuid().safeParse(workspaceId).success) {
    return Response.json({ error: "工作空间不存在。" }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "请先登录。" }, { status: 401 });

  const db = createDbClient(userId);
  const { data: workspace } = await db
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle<{ id: string }>();
  if (!workspace) return Response.json({ error: "工作空间不存在。" }, { status: 404 });

  await ensurePostgresListener();

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let onChange: ((change: DottyChange) => void) | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      write("retry: 3000\n\n");
      onChange = (change) => {
        if (change.workspaceId !== workspaceId) return;
        write(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
      };
      dottyEventBus().on("change", onChange);
      heartbeat = setInterval(() => write(`: keepalive ${Date.now()}\n\n`), 15_000);

      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          if (onChange) dottyEventBus().off("change", onChange);
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
        { once: true },
      );
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (onChange) dottyEventBus().off("change", onChange);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
