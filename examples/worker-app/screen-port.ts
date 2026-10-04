import {absentSnapshot, assertRevision} from '@mineral/textui';
import type {ScreenPort, ScreenSnapshot, ScreenWriteOptions, ScreenChange} from '@mineral/textui';

/** All storage operations before notification are synchronous: CAS is one SQL transaction. */
export class DurableScreenPort implements ScreenPort {
  private listeners = new Map<string, Set<(change: ScreenChange) => void>>();
  constructor(private storage: DurableObjectStorage, private publish: (change: ScreenChange) => void) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS screens (id TEXT PRIMARY KEY, text TEXT NOT NULL, revision TEXT NOT NULL)');
  }
  async getScreen(id: string): Promise<ScreenSnapshot | null> {
    return this.storage.sql.exec<ScreenSnapshot & Record<string, SqlStorageValue>>('SELECT id, text, revision FROM screens WHERE id = ?', id).toArray()[0] ?? null;
  }
  async setScreen(id: string, text: string, options: ScreenWriteOptions): Promise<ScreenSnapshot> {
    let change: ScreenChange | undefined;
    const after = this.storage.transactionSync(() => {
      const before = this.storage.sql.exec<ScreenSnapshot & Record<string, SqlStorageValue>>('SELECT id, text, revision FROM screens WHERE id = ?', id).toArray()[0] ?? null;
      assertRevision(id, before, options);
      if (before?.text === text) return before;
      const saved = {id, text, revision:crypto.randomUUID()};
      this.storage.sql.exec('INSERT INTO screens (id, text, revision) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, revision=excluded.revision', id, text, saved.revision);
      change = {before:before ?? absentSnapshot(id), after:saved, origin:options.origin};
      return saved;
    });
    if (change) {
      for (const listener of this.listeners.get(id) ?? []) {
        try {listener(change);} catch (error) {console.error(JSON.stringify({event:'screen-listener-error', id, error:String(error)}));}
      }
      this.publish(change);
    }
    return after;
  }
  async onScreenChange(id: string, listener: (change: ScreenChange) => void) {
    const listeners = this.listeners.get(id) ?? new Set();
    this.listeners.set(id, listeners); listeners.add(listener);
    return () => {listeners.delete(listener); if (!listeners.size) this.listeners.delete(id);};
  }
}
