// Toker (team chat): shapes shared by the chat screen and its server actions.
// The database decides who sees and changes what (decision 2026-11-12 "Toker, етап 1").

export type ChatVisibility = "open" | "closed" | "direct";
export type ChatNotify = "all" | "mentions" | "none";

// One row of chat_my_channels: a channel the person sees, with their own state.
export type ChatChannel = {
  id: string;
  name: string;
  topic: string;
  kind: "text" | "forum" | "voice";
  visibility: ChatVisibility;
  category_id: string | null;
  unit_id: string | null;
  position: number;
  archived_at: string | null;
  joined: boolean;
  role: "owner" | "member" | null;
  notify: ChatNotify;
  last_read_at: string | null;
  unread: number;
  mentioned: boolean;
  // Whether people added later see the earlier history.
  history_visible: boolean;
  // "chosen": only who manages the channel and the people marked can_post publish; the rest comment.
  post_policy: "everyone" | "chosen";
  can_publish: boolean;
  // A conversation's people (the others first), instead of a name.
  people: string[] | null;
};

export type ChatCategory = { id: string; name: string; position: number; restricted: boolean };

export type ChatPerson = { id: string; name: string; avatarUrl: string | null; guest: boolean };

export type ChatMessage = {
  id: string;
  channel_id: string;
  author_id: string | null;
  thread_root_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
  file_count: number;
};

// A file sent with a message (or being added to one).
export type ChatFile = {
  id: string;
  message_id: string | null;
  name: string;
  mime_type: string;
  bytes: number;
  kind: "file" | "image" | "voice";
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  // A voice message's levels (0..5), made in the browser from the sound.
  waveform: number[] | null;
};
export const chatFileUrl = (shortId: string, id: string, download = false) => `/api/chat/files/${id}?ws=${shortId}${download ? "&download" : ""}`;

export type ChatReaction = { message_id: string; user_id: string; emoji: string; created_at: string };

export type ChatMember = { user_id: string; role: "owner" | "member"; invited: boolean; history_from: string | null; can_post: boolean };

export type ChatCategoryAccess = { group_id: string | null; user_id: string | null };

// How the screen hears about changes: realtime signals (central database) or a
// short poll while the page is visible (a team's own database, for now).
export type ChatLive = "realtime" | "poll";

export const MESSAGE_PAGE = 50;
export const MAX_MESSAGE = 4000;

export const realtimeTopic = (channelId: string) => `chat:${channelId}`;
export const userTopic = (userId: string) => `chat-user:${userId}`;

// Newest last, no repeats: the stream as it is shown.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

// Channels grouped under their categories, in order; channels without one first.
export function groupChannels(channels: ChatChannel[], categories: ChatCategory[]) {
  const order = (a: ChatChannel, b: ChatChannel) => a.position - b.position || a.name.localeCompare(b.name);
  const loose = channels.filter((c) => !c.category_id || !categories.some((k) => k.id === c.category_id)).sort(order);
  const groups = [...categories]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((category) => ({ category, channels: channels.filter((c) => c.category_id === category.id).sort(order) }));
  return { loose, groups };
}

// Reactions of one message, grouped by sign, in the order they first appeared.
export function groupReactions(rows: ChatReaction[]) {
  const groups = new Map<string, string[]>();
  for (const r of rows) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r.user_id]);
  return [...groups.entries()].map(([emoji, users]) => ({ emoji, users }));
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "@Name" followed by the end, a space or punctuation (so "@Ann" is not inside "@Anna").
export const mentionPattern = (name: string) => new RegExp(`@${escapeRe(name)}(?=$|[\\s.,!?:;)\\]])`, "u");

// Mentions written as "@Name": the people whose name is in the text (at most 50).
export function mentionsIn(body: string, people: { id: string; name: string }[]) {
  if (!body.includes("@")) return [];
  return [...new Set(people.filter((p) => p.name && mentionPattern(p.name).test(body)).map((p) => p.id))].slice(0, 50);
}

// What a channel is called: its name, or for a conversation its people (without me).
export function channelTitle(channel: Pick<ChatChannel, "name" | "visibility" | "people">, names: Map<string, { name: string }>, me: string, alone: string, former: string) {
  if (channel.visibility !== "direct") return channel.name;
  const others = (channel.people ?? []).filter((id) => id !== me);
  if (!others.length) return alone;
  return others.map((id) => names.get(id)?.name ?? former).join(", ");
}

// A message found by search (the database gives only what the person sees).
export type ChatSearchHit = {
  id: string;
  channel_id: string;
  channel: string;
  visibility: ChatVisibility;
  thread_root_id: string | null;
  author_id: string | null;
  created_at: string;
  body: string;
};

// A message planned for later (seen only by its author).
export type ChatScheduled = { id: string; channel_id: string; thread_root_id: string | null; body: string; send_at: string };
