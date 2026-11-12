// Toker (team chat): shapes shared by the chat screen and its server actions.
// The database decides who sees and changes what (decision 2026-11-12 "Toker, етап 1").

export type ChatVisibility = "open" | "closed";
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
};

export type ChatMember = { user_id: string; role: "owner" | "member"; invited: boolean };

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
