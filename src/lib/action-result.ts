// Shape returned by the database RPCs and the server actions that wrap them.
export type ActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
