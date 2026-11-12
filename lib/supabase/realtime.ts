"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./client";

/**
 * Subscribe to a Realtime channel AS THE SIGNED-IN USER.
 *
 * Our tables only let `authenticated` users read rows (RLS), and Realtime applies the same rules.
 * The browser client loads its session from cookies asynchronously, so a channel subscribed right
 * away joins as anonymous: it still says SUBSCRIBED but silently receives nothing. So we load the
 * session and hand its token to Realtime first. Broken/timed-out channels rejoin after a pause;
 * `onReady(rejoined)` lets callers catch up on anything missed while disconnected.
 * Returns an unsubscribe function.
 */
export function subscribeLive(
  name: string,
  setup: (channel: RealtimeChannel) => RealtimeChannel,
  onReady?: (rejoined: boolean) => void,
) {
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let stopped = false;
  let retry: number | undefined;
  let joins = 0;

  const start = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (stopped) return;
    if (session) await supabase.realtime.setAuth(session.access_token);
    if (stopped) return;
    // A unique topic per subscription: a quick unmount/remount must not reuse a closing channel.
    channel = setup(supabase.channel(`${name}:${Math.random().toString(36).slice(2, 8)}`));
    channel.subscribe((status, error) => {
      if (stopped) return;
      if (status === "SUBSCRIBED") {
        onReady?.(joins++ > 0);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (error) console.warn(`[realtime] ${name}: ${status}`, error.message);
        const broken = channel;
        channel = null;
        if (broken) void supabase.removeChannel(broken);
        window.clearTimeout(retry);
        retry = window.setTimeout(() => void start(), 3000);
      }
    });
  };
  void start();

  return () => {
    stopped = true;
    window.clearTimeout(retry);
    if (channel) void supabase.removeChannel(channel);
  };
}
