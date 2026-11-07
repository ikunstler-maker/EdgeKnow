// Things the browser shows before the database has made them (a new page, a new task).
// Saves that need the row first wait here; false: the database refused or was out of reach.
const pending = new Map<string, Promise<boolean>>();

export function trackCreate(id: string, done: Promise<boolean>) {
  pending.set(id, done);
  void done.finally(() => {
    if (pending.get(id) === done) pending.delete(id);
  });
}

export const whenCreated = (id: string): Promise<boolean> => pending.get(id) ?? Promise.resolve(true);
