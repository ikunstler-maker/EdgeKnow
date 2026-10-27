import { uk, type Dictionary } from "./uk";

// Single locale for now. When a second language is added, pick the dictionary
// here (e.g. from a cookie or user profile) instead of exporting `uk` directly.
export const locale = "uk";
export const t: Dictionary = uk;
