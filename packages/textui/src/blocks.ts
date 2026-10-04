import {ProtocolError} from './schema.js';

export interface BlockType<T = unknown> {
  parse(text: string): T;
  serialize(value: T): string;
  deriveEvents?(before: T, after: T): readonly unknown[];
}
/** Applications may use a private registry to avoid sharing codecs between roots. */
export class BlockTypeRegistry {
  private types = new Map<string, BlockType<any>>();
  register<T>(type: string, codec: BlockType<T>): () => void {
    attribute(type);
    if (this.types.has(type)) throw new ProtocolError(`Block 类型已注册：${type}`);
    if (typeof codec.parse !== 'function' || typeof codec.serialize !== 'function') throw new ProtocolError('Block 类型需要 parse 和 serialize。');
    this.types.set(type, codec);
    return () => {if (this.types.get(type) === codec) this.types.delete(type);};
  }
  get(type: string): BlockType<any> | undefined {return this.types.get(type);}
  parse(type: string, text: string): unknown {const codec=this.get(type);return codec?codec.parse(text):text;}
  serialize(type: string, value: unknown): string {
    const codec = this.get(type);
    if (!codec) {if (typeof value === 'string') return value; throw new ProtocolError(`未注册的 Block 类型需要字符串：${type}`);}
    const text = codec.serialize(value);
    if (typeof text !== 'string') throw new ProtocolError('Block serialize 必须返回字符串。');
    return text;
  }
}
export const blockTypes = new BlockTypeRegistry();
export function registerBlockType<T>(type: string, codec: BlockType<T>): () => void {return blockTypes.register(type, codec);}
export function attribute(value: string): string {
  if (!/^[\w.-]+$/.test(value)) throw new ProtocolError('Block type/id 只能含字母、数字、下划线、点和连字符。');
  return value;
}
export function fencedCode(value: string, lang = '', meta = ''): string {
  if (/[\s`~]/.test(lang) || /[\r\n`]/.test(meta)) throw new ProtocolError('代码块语言或元数据无效。');
  const runs = value.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${fence}${lang}${meta ? ` ${meta}` : ''}\n${value}\n${fence}`;
}
