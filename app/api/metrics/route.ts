import { connection } from "next/server";
import { metrics } from "@/lib/metrics";

export async function GET() {
  await connection();
  return new Response(await metrics.register.metrics(), {
    headers: {
      "Content-Type": metrics.register.contentType,
      "Cache-Control": "no-store",
    },
  });
}
