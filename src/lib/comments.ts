// Comment threads as the page receives them, and helpers shared by the editor.

export type ThreadStatus = "open" | "resolved" | "orphaned";

export type CommentItem = {
  id: string;
  authorId: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
};

export type CommentThread = {
  id: string;
  status: ThreadStatus;
  quotedText: string;
  createdAt: string;
  comments: CommentItem[];
};

// Display names of everyone who wrote or was mentioned, by user id.
export type PeopleNames = Record<string, string>;

export type MentionPerson = { userId: string; label: string };

// Columns for the page's threads with their messages, oldest first.
export const THREAD_COLUMNS =
  "id, status, quoted_text, created_at, comments(id, author_id, body, mentions, created_at, edited_at)";

export type ThreadRow = {
  id: string;
  status: ThreadStatus;
  quoted_text: string;
  created_at: string;
  comments: {
    id: string;
    author_id: string | null;
    body: string;
    mentions: string[];
    created_at: string;
    edited_at: string | null;
  }[];
};

export function toThread(row: ThreadRow): CommentThread {
  return {
    id: row.id,
    status: row.status,
    quotedText: row.quoted_text,
    createdAt: row.created_at,
    comments: [...row.comments]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({
        id: c.id,
        authorId: c.author_id,
        body: c.body,
        mentions: c.mentions,
        createdAt: c.created_at,
        editedAt: c.edited_at,
      })),
  };
}

// A range of one block's text that the server marks for a commenter. Positions count
// characters the way Postgres does (code points), so emoji take one position.
export type MarkRange = { block: string; start: number; end: number; text: string };

// Mentions are kept for the people whose "@Name" is still in the text.
export function mentionsIn(body: string, picked: MentionPerson[]): string[] {
  return [...new Set(picked.filter((p) => body.includes(`@${p.label}`)).map((p) => p.userId))];
}
