import { ProtocolError } from './schema.js';
export type StateValue = string | boolean | number | null;
export class TextUIStore {
  private kinds=new Map<string,string>();
  private values = new Map<string, StateValue>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  get<T extends StateValue>(key: string, initial: T): T {
    if (!key || (typeof initial === 'number' && !Number.isFinite(initial))) throw new ProtocolError('状态键不能为空，数字默认值必须有限。');
    if (!this.values.has(key)) {this.values.set(key, initial);this.kinds.set(key,initial===null?'number':typeof initial);}
    if (this.kinds.get(key) !== (initial===null?'number':typeof initial)) throw new ProtocolError(`状态键 ${key} 的默认值类型不一致。`);
    return this.values.get(key) as T;
  }
  read(key: string): StateValue | undefined { return this.values.get(key); }
  set(key: string, value: StateValue): void {
    const before = this.values.get(key);
    if (before !== undefined && this.kinds.get(key) !== (value===null?'number':typeof value)) throw new ProtocolError(`状态 ${key} 类型改变。`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new ProtocolError(`状态 ${key} 需要有限数值。`);
    if (Object.is(before, value)) return;
    this.kinds.set(key,value===null?'number':typeof value);this.values.set(key, value); this.listeners.forEach(listener => listener());
  }
  restore(key: string, raw: StateValue): void {
    const initial = this.values.get(key);
    let value: StateValue = raw;
    if (this.kinds.get(key) === 'number') {
      if (raw!==null && (typeof raw !== 'string' || (!raw.trim() || !Number.isFinite(Number(raw))))) throw new ProtocolError(`持久状态 ${key} 的数值无效。`);
      value = raw===null?null:Number(raw);
    } else if (typeof initial === 'boolean' && typeof raw === 'string') {
      if (!['true','false'].includes(raw)) throw new ProtocolError(`持久状态 ${key} 的布尔值无效。`);
      value = raw === 'true';
    }
    this.set(key, value);
  }
  snapshot(): Map<string, StateValue> {return new Map(this.values);}
  rollback(snapshot: Map<string, StateValue>): void {this.values = new Map(snapshot);this.kinds=new Map([...snapshot].map(([key,value])=>[key,value===null?'number':typeof value])); this.listeners.forEach(l => l());}
  clear(): void {this.listeners.clear();}
}
