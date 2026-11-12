"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { realtimeTopic, userTopic, type ChatLive } from "@/lib/chat";

// The most channels one screen listens to at once (the rest refresh with the list).
const MAX_TOPICS = 60;

export type ChatSignal =
  | { kind: "message"; channelId: string; id: string; threadRootId: string | null }
  | { kind: "reaction"; channelId: string; messageId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "members"; channelId: string }
  | { kind: "channels" };

// Live signals for the chat (central database): one private realtime topic per channel
// the person is in, plus their own topic (added to or removed from a channel). Each
// signal carries ids only; the screen reads the rows again through the usual rules.
// Answers whether the signals are flowing; when not (a team's own database, or the
// connection failed), the screen polls instead.
export function useChatLive(live: ChatLive, me: string, channelIds: string[], onSignal: (signal: ChatSignal) => void) {
  const supabase = useMemo(() => (live === "realtime" ? createClient() : null), [live]);
  const handler = useRef(onSignal);
  useEffect(() => {
    handler.current = onSignal;
  }, [onSignal]);
  const [failed, setFailed] = useState(false);
  const wanted = channelIds.slice(0, MAX_TOPICS).sort().join(",");

  useEffect(() => {
    if (!supabase) return;
    let stopped = false;
    const subscribed: RealtimeChannel[] = [];
    const watch = (topic: string, channelId: string | null) => {
      const channel = supabase.channel(topic, { config: { private: true } });
      const emit = (signal: ChatSignal) => !stopped && handler.current(signal);
      if (channelId) {
        channel
          .on("broadcast", { event: "message" }, ({ payload }) =>
            emit({ kind: "message", channelId, id: String(payload?.id ?? ""), threadRootId: payload?.thread_root_id ? String(payload.thread_root_id) : null }),
          )
          .on("broadcast", { event: "reaction" }, ({ payload }) => emit({ kind: "reaction", channelId, messageId: String(payload?.message_id ?? "") }))
          .on("broadcast", { event: "channel" }, () => emit({ kind: "channel", channelId }))
          .on("broadcast", { event: "members" }, () => emit({ kind: "members", channelId }));
      } else {
        channel.on("broadcast", { event: "channels" }, () => emit({ kind: "channels" }));
      }
      channel.subscribe((status) => {
        if (stopped) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setFailed(true);
        if (status === "SUBSCRIBED") setFailed(false);
      });
      subscribed.push(channel);
    };
    void supabase.realtime.setAuth().then(() => {
      if (stopped) return;
      watch(userTopic(me), null);
      for (const id of wanted ? wanted.split(",") : []) watch(realtimeTopic(id), id);
    });
    return () => {
      stopped = true;
      for (const channel of subscribed) void supabase.removeChannel(channel);
    };
  }, [supabase, me, wanted]);

  return { connected: Boolean(supabase) && !failed };
}
