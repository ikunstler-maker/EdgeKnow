// Feedback types offered in the form (labels live in the dictionary).
export const FEEDBACK_TYPES = ["bug", "change", "add", "remove", "unclear", "other"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_MAX = 5000;
