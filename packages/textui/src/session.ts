import { ScreenConflictError } from './screen.js';
import type { ScreenPort, ScreenSnapshot, Unsubscribe } from './screen.js';
import { stampText } from './version.js';

const owners = new WeakMap<ScreenPort, Set<string>>();
let sequence = 0;
/** One serialized read/dispatch/write lane shared by React and text-only applications. */
export class ScreenSession {
  readonly origin = `textui:${++sequence}`;
  snapshot: ScreenSnapshot | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private unsubscribe?: Unsubscribe;
  private active = false;
  private initializing = true;
  private observed?: string;
  private onExternal?: (snapshot: ScreenSnapshot) => Promise<void>;
  constructor(readonly host: ScreenPort, readonly id: string, private onError: (error: unknown) => void) {}
  run<T>(task: () => Promise<T>): Promise<T> {
    const result=this.tail.then(task); this.tail=result.catch(()=>{}); return result;
  }
  async start(initialize: (snapshot: ScreenSnapshot | null) => Promise<void>, onExternal: (snapshot: ScreenSnapshot) => Promise<void>): Promise<void> {
    const owned=owners.get(this.host) ?? new Set<string>();
    if (owned.has(this.id)) throw new Error('同一个 Host 的屏幕不能由两个运行中的 Root 或 Session 同时写入。');
    owners.set(this.host,owned); owned.add(this.id); this.active=true; this.onExternal=onExternal;
    try {
      this.unsubscribe=await this.host.onScreenChange(this.id,()=>{if (!this.initializing) this.refresh();});
      await this.run(async()=>{
        this.snapshot=await this.host.getScreen(this.id);
        this.observed=this.snapshot?.revision;
        await initialize(this.snapshot);
        this.initializing=false;
        // The read follows subscription completion; this catches changes during initialization.
        await this.readExternal();
      });
    } catch(error) {await this.close(); throw error;}
  }
  refresh(): void {
    if (!this.active) return;
    void this.run(()=>this.readExternal()).catch(this.onError);
  }
  private async readExternal(): Promise<void> {
    if (!this.active) return;
    const latest=await this.host.getScreen(this.id);
    if (!latest) throw new Error(`屏幕 ${this.id} 被删除；恢复后将重新读取。`);
    if (latest.revision===this.snapshot?.revision || latest.revision===this.observed) return;
    this.observed=latest.revision;
    // A repaired file can exactly match the last confirmed bytes. The runtime
    // still needs to acknowledge its new revision and clear a failed transaction.
    await this.onExternal!(latest);
  }
  async commit(source: ScreenSnapshot | null, text: string): Promise<ScreenSnapshot> {
    const stamped=source ? stampText(text,source.text) : text;
    try {
      const after=await this.host.setScreen(this.id,stamped,{expectedRevision:source?.revision ?? null,origin:this.origin});
      if (after.id!==this.id || after.text!==stamped || !after.revision) throw new Error('Host 返回了与提交不一致的 ScreenSnapshot。');
      this.snapshot=after; this.observed=after.revision; return after;
    } catch(error) {
      if (error instanceof ScreenConflictError) this.refresh();
      throw error;
    }
  }
  async idle(): Promise<void> {let pending; do {pending=this.tail; await pending;} while (pending!==this.tail);}
  async close(): Promise<void> {
    if (!this.active) return;
    this.active=false;
    try {this.unsubscribe?.(); await this.idle();}
    finally {owners.get(this.host)?.delete(this.id); this.onExternal=undefined;}
  }
}
