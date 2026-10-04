import {FieldValidationException,parseConstraints} from './validation.js';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { Node } from 'unist';
import { identity, ProtocolError } from './schema.js';
import type { ParsedScreen, ParsedControl, ParsedBlock, ControlType, ProtocolOptions } from './schema.js';

/** AST is used for syntax boundaries only; offsets always refer to the untouched source. */
export function parseTextUI(text: string, options: ProtocolOptions = {}): ParsedScreen {
  const excluded: [number, number][] = [];
  const blocks = new Map<string, ParsedBlock>();
  function visit(node: Node & { children?: Node[]; lang?: string | null; meta?: string | null }) {
    if (['code', 'inlineCode'].includes(node.type) && node.position) {
      excluded.push([node.position.start.offset!, node.position.end.offset!]);
      if(node.type==='code' && [...blocks.values()].some(b=>b.type==='textarea') && !node.lang && !node.meta) {
        const raw=text.slice(node.position.start.offset!,node.position.end.offset!);
        if(/^(`{3,}|~{3,})[ \t]*(?:\r?\n|$)/.test(raw) && !/\n[ \t>]*(`{3,}|~{3,})[ \t]*\r?$/.test(raw))throw new ProtocolError('Textarea 后存在未闭合围栏；请检查内容中的围栏长度。');
      }
      if (node.type === 'code' && (/(?:^|\s)(?:type|id)=/.test(node.meta ?? '') || (node.lang==='textui' && /(?:^|\s)(?:type|id)\b/.test(node.meta??'')))) {
        const attrs = new Map<string,string>();
        for (const field of (node.meta ?? '').split(/\s+/).filter(Boolean)) {
          const pair = /^([a-zA-Z]+)=([\w.+-]+)$/.exec(field);
          if (!pair || !['type','id','disabled','readOnly','required'].includes(pair[1]) || attrs.has(pair[1])) throw new ProtocolError('无效或重复的 Block 元数据。');
          attrs.set(pair[1], pair[2]);
        }
        for(const name of ['type','id'])if(attrs.has(name)&&!/^[\w.-]+$/.test(attrs.get(name)!))throw new ProtocolError('Block type/id 无效。');
        const type = attrs.get('type');
        if (!type) throw new ProtocolError('Block 需要 type。');
        const fullStart = node.position.start.offset!, fullEnd = node.position.end.offset!;
        const raw = text.slice(fullStart, fullEnd);
        const opening = /^(`{3,}|~{3,})[^\r\n]*\r?\n/.exec(raw);
        if (!opening) throw new ProtocolError('Block 需要围栏代码块。');
        const closing = /(?:^|\n)([ \t>]*)(`{3,}|~{3,})[ \t]*\r?$/.exec(raw);
        if (!closing || closing[2][0] !== opening[1][0] || closing[2].length < opening[1].length) throw new FieldValidationException(attrs.get('id')??identity('block',type,node.lang??''),'parse','Block 围栏未闭合。',fullStart,fullEnd);
        const start = fullStart + opening[0].length;
        const end = fullStart + closing.index - (raw[closing.index-1] === '\r' ? 1 : 0);
        if (end < start - 1) throw new ProtocolError('Block 内容范围无效。');
        const explicitId = attrs.get('id'), lang = node.lang ?? '';
        const id = explicitId ?? identity('block',type,lang);
        if (blocks.has(id)) throw new ProtocolError(`重复 ID 或 Block 身份歧义：${id}`);
        const bodyEnd = Math.max(start,end);
        const prefix=closing[1];
        const value=text.slice(start,bodyEnd).split('\n').map(line=>line.startsWith(prefix)?line.slice(prefix.length):line).join('\n');
        blocks.set(id,{...parseConstraints(attrs),id,explicitId,type,lang,value,start,end:bodyEnd,fullStart,fullEnd,opening:text.slice(fullStart,start),closing:text.slice(bodyEnd,fullEnd),fence:opening[1],prefix});
      }
    } else node.children?.forEach(visit);
  }
  visit(fromMarkdown(text,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]}));
  const controls = new Map<string, ParsedControl>();
  let boundary = 0;
  const markers = /<!--\s*textui:([^\r\n]*?)-->/g;
  for (const match of text.matchAll(markers)) {
    const offset = match.index!;
    if (excluded.some(([a, b]) => offset >= a && offset < b)) continue;
    const attrs = new Map<string, string>();
    for (const field of match[1].trim().split(/\s+/)) {
      const pair = /^([a-zA-Z]+)=([\w.+-]+)$/.exec(field);
      if (!pair || attrs.has(pair[1])) throw new ProtocolError(`无效或重复的 TextUI 属性：${match[0]}`);
      attrs.set(pair[1], pair[2]);
    }
    if (attrs.size === 1 && attrs.has('epoch')) {
      if (!/^\d+$/.test(attrs.get('epoch')!)) throw new ProtocolError('无效 epoch。');
      boundary = offset + match[0].length;
      continue;
    }
    for(const name of ['type','id','group'])if(attrs.has(name)&&!/^[\w.-]+$/.test(attrs.get(name)!))throw new ProtocolError('type/id/group 无效。');
    const type = attrs.get('type') as ControlType;
    if (!['input', 'number', 'check', 'action', 'select', 'output'].includes(type)) throw new ProtocolError('控件需要有效 type。');
    if ([...attrs.keys()].some(k => !['type', 'id', 'group', 'disabled', 'readOnly', 'required', 'min', 'max', 'step'].includes(k))) throw new ProtocolError('未知控件属性。');
    const group = attrs.get('group');
    if (type === 'select' ? !group : group !== undefined) throw new ProtocolError('控件 group 无效。');
    let from = Math.max(boundary, text.lastIndexOf('\n', offset - 1) + 1);
    let segment = text.slice(from, offset);
    // Container prefixes belong to ordinary Markdown, never to the control label.
    const prefix=/^[ \t]*(?:>[ \t]*)*/.exec(segment)![0];
    from+=prefix.length;segment=segment.slice(prefix.length);
    if(type==='input'||type==='number'||type==='output'||type==='select') {
      const list=/^(?:[-+*]|\d+\.)[ \t]+/.exec(segment);
      if(list){from+=list[0].length;segment=segment.slice(list[0].length);}
    } else {
      while(/^(?:[-+*]|\d+\.)[ \t]+(?=[-+*]|\d+\.)/.test(segment)) {
        const list=/^(?:[-+*]|\d+\.)[ \t]+/.exec(segment)![0];from+=list.length;segment=segment.slice(list.length);
      }
      const ordered=/^\d+\.[ \t]+(?=\[)/.exec(segment);
      if(ordered){from+=ordered[0].length;segment=segment.slice(ordered[0].length);}
    }
    let label: string, value: string | boolean, start: number, end: number;
    if (type === 'input' || type === 'number') {
      const pattern=options.allowEscapedNewlines ? /^\s*(?:>\s*)?(.+?):\s*\[((?:\\[\\\]nr]|[^\\\]\r\n])*)\]\s*$/ : /^\s*(?:>\s*)?(.+?):\s*\[((?:\\[\\\]]|[^\\\]\r\n])*)\]\s*$/;
      const token = pattern.exec(segment);
      if (!token) throw new FieldValidationException(attrs.get('id')??identity(type,segment),'parse','Input/NumberInput 需要单行「标签: [值]」，仅支持合法转义。',from,offset);
      label = token[1]; value = token[2].replace(/\\([\\\]nr])/g, (_,c:string)=>c==='n'?'\n':c==='r'?'\r':c);
      start = from + segment.indexOf('[', segment.indexOf(':') + 1); end = from + segment.trimEnd().length;
    } else if (type === 'output') {
      const token = /^\s*(?:>\s*)?(.+?):[ \t]*([^\r\n]*?)[ \t]*$/.exec(segment);
      if (!token) throw new ProtocolError('Output 需要「标签: 值」。');
      label = token[1]; value = token[2]; end = from + segment.trimEnd().length; start = end - value.length;
    } else {
      const pattern = type === 'select' ? /^\s*\(([ *])\)[ \t]+(.+?)[ \t]*$/ : /^\s*(?:[-*+]\s+)?\[([ xX])\][ \t]+(.+?)[ \t]*$/;
      const token = pattern.exec(segment);
      if (!token) throw new ProtocolError(`无效 ${type} 控件。`);
      label = token[2]; value = type === 'select' ? token[1] === '*' : token[1].toLowerCase() === 'x';
      start = from + segment.indexOf(type === 'select' ? '(' : '['); end = start + 3;
    }
    const explicitId = attrs.get('id');
    const id = explicitId ?? identity(type, label, group);
    if (controls.has(id) || blocks.has(id)) throw new ProtocolError(`重复 ID 或控件身份歧义：${id}；请提供不同 ID。`);
    controls.set(id, { ...parseConstraints(attrs), id, explicitId, type, group, label, value, start, end, fullStart: from, fullEnd: offset + match[0].length });
    boundary = offset + match[0].length;
  }
  // A damaged protocol opener outside code must not silently remove a control.
  for (const match of text.matchAll(/<!--\s*textui:/g)) {
    if (excluded.some(([a, b]) => match.index! >= a && match.index! < b)) continue;
    if (!/^<!--\s*textui:[^\r\n]*?-->/.test(text.slice(match.index))) throw new ProtocolError('TextUI 注释未闭合。');
  }
  return { text, controls, blocks };
}
