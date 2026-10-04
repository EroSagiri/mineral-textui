import { absentSnapshot, assertRevision } from './screen.js';
import type { ScreenPort, ScreenSnapshot, ScreenChange, ScreenWriteOptions, Unsubscribe } from './screen.js';

/** A reference Host with atomic in-instance compare-and-set and no environment APIs. */
export class MemoryScreen implements ScreenPort {
  private screens = new Map<string, ScreenSnapshot>();
  private listeners = new Map<string, Set<(change: ScreenChange) => void>>();
  private sequence = 0;
  constructor(private onError: (error: unknown) => void = () => {}) {}
  async getScreen(id: string): Promise<ScreenSnapshot | null> {return this.screens.get(id) ?? null;}
  async setScreen(id: string, text: string, options: ScreenWriteOptions): Promise<ScreenSnapshot> {
    const before = this.screens.get(id) ?? null;
    assertRevision(id, before, options);
    if (before?.text === text) return before;
    const after = Object.freeze({id, text, revision:`memory:${++this.sequence}`});
    this.screens.set(id, after);
    const change = Object.freeze({before:before ?? absentSnapshot(id), after, origin:options.origin});
    for (const listener of this.listeners.get(id) ?? []) {
      try {listener(change);} catch (error) {this.onError(error);}
    }
    return after;
  }
  async onScreenChange(id: string, listener: (change: ScreenChange) => void): Promise<Unsubscribe> {
    const listeners=this.listeners.get(id) ?? new Set(); this.listeners.set(id,listeners); listeners.add(listener);
    return () => {listeners.delete(listener); if (!listeners.size) this.listeners.delete(id);};
  }
}
