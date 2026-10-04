import {constraintMetadata} from './validation.js';
import type { ElementNode, HostNode } from './tree.js';
import type { ControlType, ControlValue } from './schema.js';
import { encodeInput, identity, singleLine, ProtocolError } from './schema.js';
import { parseTextUI } from './parser.js';
import { attribute, fencedCode } from './blocks.js';

export interface RegisteredControl {
  id: string; type: ControlType; label: string; group?: string; value: ControlValue;
  stateKey?: string; optionValue?: string; props: Record<string, unknown>; line: string;
}
export interface RegisteredBlock {
  id: string; type: string; lang: string; value: string; props: Record<string, unknown>; line: string; stateKey?: string;
}
export interface SerializedStructure {text:string; ids:string[]}
export interface SerializedTree {text: string; registry: Map<string, RegisteredControl>; blocks: Map<string, RegisteredBlock>; staticBlocks: string[]; structures:SerializedStructure[]}
function rawText(node: HostNode): string {
  if (node.hidden) return '';
  return node.kind === 'text' ? node.value : node.children.map(rawText).join('');
}
function escapeLabel(value: string): string {return singleLine(value).replace(/[\\[\]]/g,'\\$&');}
function destination(value: unknown): string {
  const text=String(value ?? '');
  if (/[\r\n<>]/.test(text)) throw new ProtocolError('Link/Image 地址无效。');
  return `<${text.replace(/ /g,'%20')}>`;
}
function title(value: unknown): string {return value === undefined ? '' : ` "${singleLine(String(value)).replace(/[\\"]/g,'\\$&')}"`;}
export function serializeTree(root: ElementNode): SerializedTree {
  const registry = new Map<string, RegisteredControl>(), blocks = new Map<string,RegisteredBlock>();
  const groups = new Set<string>();
  const structures:SerializedStructure[]=[];let structureDepth=0;
  function add(type: ControlType, props: Record<string, unknown>, value: ControlValue, optionValue?: string): string {
    const label = singleLine(String(props.label ?? ''));
    if (!label) throw new ProtocolError('控件标签不能为空。');
    const group = props.group as string | undefined, explicitId = props.id as string | undefined;
    for (const item of [explicitId, group]) if (item !== undefined && !/^[\w.-]+$/.test(item)) throw new ProtocolError('id/group 只能含字母、数字、下划线、点和连字符。');
    const id = explicitId ?? identity(type, label, group);
    if (registry.has(id) || blocks.has(id)) throw new ProtocolError(`重复 ID 或身份歧义：${id}`);
    const marker = `<!-- textui:${explicitId ? `id=${explicitId} ` : ''}type=${type}${group ? ` group=${group}` : ''}${constraintMetadata(props)} -->`;
    const body = (type === 'input' || type === 'number') ? `${label}: [${encodeInput(String(value))}]`
      : type === 'output' ? `${label}: ${singleLine(String(value))}`
      : type === 'select' ? `(${value ? '*' : ' '}) ${label}` : `- [${value ? 'x' : ' '}] ${label}`;
    const line = `${body} ${marker}`;
    registry.set(id, {id, type, label, group, value, optionValue, props, line, stateKey:props.stateKey as string | undefined});
    return line;
  }
  function inlineChildren(nodes:HostNode[],literal=false,parentFormat=''):string {
    const merged:HostNode[]=[];
    for(const node of nodes){if(node.hidden)continue;
      const last=merged[merged.length-1];
      if(node.kind==='element' && ['strong','emphasis','strike'].includes(node.type) && last?.kind==='element' && last.type===node.type){merged[merged.length-1]={...last,children:[...last.children,...node.children]};}
      else merged.push(node);
    }
    return merged.map(node=>inline(node,literal,parentFormat)).join('');
  }
  function inline(node:HostNode, literal=false, parentFormat=''):string {
    if(node.hidden)return '';
    if(node.kind==='text')return literal?node.value.replace(/[\\`*_{}\[\]()<>#!|~]/g,'\\$&'):node.value;
    const content=()=>inlineChildren(node.children,literal,parentFormat),p=node.props;
    switch(node.type) {
      case 'text': return content();
      case 'strong': case 'emphasis': case 'strike': {
        const marker=node.type==='strong'?'**':node.type==='emphasis'?'*':'~~';
        const value=inlineChildren(node.children,true,node.type);
        if(!value)return '';
        if(parentFormat===node.type)return value;
        const parts=/^(\s*)([\s\S]*?)(\s*)$/.exec(value)!;
        return parts[2]?parts[1]+marker+parts[2]+marker+parts[3]:value;
      }
      case 'link': return `[${node.children.map(child=>child.kind==='text'?escapeLabel(child.value):inline(child,true)).join('')}](${destination(p.href)}${title(p.title)})`;
      case 'image': return `![${escapeLabel(String(p.alt??''))}](${destination(p.src)}${title(p.title)})`;
      case 'code': {
        const value=singleLine(rawText(node));
        const fence='`'.repeat(Math.max(1,...(value.match(/`+/g)??[]).map(s=>s.length+1)));
        const pad=value.startsWith('`') || value.endsWith('`') || (/^ .* $/.test(value) && value.trim()) ? ' ' : '';
        return `${fence}${pad}${value}${pad}${fence}`;
      }
      default: throw new ProtocolError(`此处需要行内组件：${node.type}`);
    }
  }
  function children(node:ElementNode):string {
    const parts:string[]=[];let run:HostNode[]=[];
    const flushRun=()=>{const text=inlineChildren(run);if(text.trim())parts.push(text);run=[];};
    for(const child of node.children) {
      if(child.hidden)continue;
      if(child.kind==='text' || ['link','image','code','strong','emphasis','strike'].includes(child.type)) {run.push(child);continue;}
      flushRun();
      const part=visit(child);if(part)parts.push(part);
    }
    flushRun();
    return parts.join('\n\n');
  }
  function visit(node: HostNode):string {
    if(node.kind==='element' && !node.hidden && ['list','ordered-list','quote','section'].includes(node.type)) {
      const outer=structureDepth++===0;
      let result:string;
      try{result=body(node);}finally{structureDepth--;}
      if(outer) {
        const parsed=parseTextUI(result);
        const ids=[...parsed.controls.values(),...parsed.blocks.values()].sort((a,b)=>a.fullStart-b.fullStart).map(c=>c.id);
        if(ids.length || node.type==='section')structures.push({text:result,ids});
      }
      return result;
    }
    return body(node);
  }
  function body(node: HostNode):string {
    if (node.hidden) return '';
    if (node.kind === 'text') return node.value;
    const p = node.props;
    switch (node.type) {
      case 'screen': return children(node);
      case 'section': return `${'#'.repeat(level(p.level))} ${singleLine(String(p.title??''))}${node.children.length?'\n\n'+children(node):''}`;
      case 'heading': return `${'#'.repeat(level(p.level))} ${singleLine(inlineChildren(node.children))}`;
      case 'text': case 'link': case 'image': case 'code': case 'strong': case 'emphasis': case 'strike': return inline(node);
      case 'divider': return '---';
      case 'quote': return children(node).split('\n').map(line=>`> ${line}`).join('\n');
      case 'code-block': if(typeof p.children!=='string')throw new ProtocolError('CodeBlock children 必须为字符串。'); return fencedCode(rawText(node),String(p.lang??''),String(p.meta??''));
      case 'textarea': case 'block': {
        if(typeof p.value!=='string')throw new ProtocolError('Block value 必须为字符串。');
        const type=node.type==='textarea'?'textarea':attribute(String(p.type??'')),lang=String(p.lang??'textui');
        if(!lang)throw new ProtocolError('Block lang 不能为空。');
        const explicitId=p.id===undefined?undefined:attribute(String(p.id));
        const id=explicitId??identity('block',type,lang);
        if(registry.has(id)||blocks.has(id))throw new ProtocolError(`重复 ID 或 Block 身份歧义：${id}`);
        const line=fencedCode(p.value,lang,`type=${type}${explicitId?` id=${explicitId}`:''}${constraintMetadata(p)}`);
        blocks.set(id,{id,type,lang,value:p.value,props:p,line,stateKey:p.stateKey as string|undefined});return node.type==='textarea'&&p.label?`## ${singleLine(String(p.label))}\n\n${line}`:line;
      }
      case 'list': case 'ordered-list': {
        const start=p.start??1;
        if(!Number.isInteger(start)||Number(start)<1)throw new ProtocolError('OrderedList start 必须为正整数。');
        return node.children.filter(child=>!child.hidden).map((child,index)=>{
          if(child.kind!=='element'||child.type!=='list-item')throw new ProtocolError('List 只能包含 ListItem。');
          const marker=node.type==='list'?'- ':`${Number(start)+index}. `;
          const lines=children(child).split('\n');
          if(/^- \[[ xX]\] /.test(lines[0]))lines[0]=lines[0].slice(2);
          return marker+lines[0]+lines.slice(1).map(line=>'\n'+' '.repeat(marker.length)+line).join('');
        }).join('\n');
      }
      case 'list-item': throw new ProtocolError('ListItem 必须位于 List 内。');
      case 'table': {
        const columns=p.columns as {key:string;title:string;align?:'left'|'center'|'right'}[],rows=p.rows as Record<string,unknown>[];
        if(!Array.isArray(columns)||!columns.length||new Set(columns.map(c=>c.key)).size!==columns.length||!Array.isArray(rows))throw new ProtocolError('Table 需要非空唯一列和 rows。');
        const cell=(v:unknown)=>singleLine(String(v??'')).replace(/(?<!\\)(?:\\\\)*\|/g,match=>match.slice(0,-1)+'\\|');
        const row=(values:unknown[])=>'| '+values.map(cell).join(' | ')+' |';
        return [row(columns.map(c=>c.title)),row(columns.map(c=>{
          if(c.align!==undefined&&!['left','center','right'].includes(c.align))throw new ProtocolError('Table align 无效。');
          return c.align==='center'?':---:':c.align==='right'?'---:':c.align==='left'?':---':'---';
        })),...rows.map(r=>row(columns.map(c=>r[c.key])))].join('\n');
      }
      case 'number': if(p.value!==null&&(typeof p.value!=='number'||!Number.isFinite(p.value)))throw new ProtocolError('NumberInput value 必须为有限数字或 null。');return add('number',p,p.value===null?'':String(p.value));
      case 'input': if (typeof p.value !== 'string') throw new ProtocolError('Input value 必须为字符串。'); return add('input', p, p.value);
      case 'check': if (p.checked !== undefined && typeof p.checked !== 'boolean') throw new ProtocolError('Check checked 必须为布尔值。'); return add('check', p, p.checked ?? false);
      case 'action': return add('action', p, false);
      case 'output': return add('output', p, String(p.value));
      case 'select': {
        const options = p.options as {label:string; value:string; id?:string}[];
        if (!p.group || groups.has(String(p.group))) throw new ProtocolError('Select group 必须唯一且非空。');
        groups.add(String(p.group));
        if (!Array.isArray(options) || !options.length || new Set(options.map(o => o.value)).size !== options.length || (p.value !== null && !options.some(o => o.value === p.value))) throw new ProtocolError('Select 必须具有唯一选项值与合法的当前选择。');
        return options.map(o => add('select', {...p, label:o.label, id:o.id ?? (p.id ? `${p.id}.${o.value}` : undefined)}, o.value === p.value, o.value)).join('\n\n');
      }
      default: throw new ProtocolError(`未知 Host 组件：${node.type}`);
    }
  }
  function level(value:unknown):number {
    const result=value??1;
    if(typeof result!=='number'||result<1||result>6||!Number.isInteger(result))throw new ProtocolError('Heading level 必须为 1–6。');return result;
  }
  const text=visit(root)+'\n';
  const parsed = parseTextUI(text);
  if (parsed.controls.size !== registry.size || parsed.blocks.size!==blocks.size) throw new ProtocolError('生成的文档含无效控件或 Block。');
  for (const [id, control] of registry) if (parsed.controls.get(id)?.value !== control.value) throw new ProtocolError(`控件值无法无损序列化：${id}；请检查空白和标签。`);
  for (const [id, block] of blocks) if (parsed.blocks.get(id)?.value!==block.value) throw new ProtocolError(`Block 无法无损序列化：${id}`);
  // Static fragments exclude every managed range, including controls in lists/sections.
  const structureRanges=structures.map(s=>({fullStart:text.indexOf(s.text),fullEnd:text.indexOf(s.text)+s.text.length}));
  const ranges=[...structureRanges,...[...parsed.controls.values(),...parsed.blocks.values()].filter(c=>!structureRanges.some(s=>c.fullStart>=s.fullStart&&c.fullEnd<=s.fullEnd))].sort((a,b)=>a.fullStart-b.fullStart);
  const staticBlocks:string[]=[];let offset=0;
  for(const range of ranges){const part=text.slice(offset,range.fullStart).trim();if(part)staticBlocks.push(part);offset=range.fullEnd;}
  const tail=text.slice(offset).trim();if(tail)staticBlocks.push(tail);
  return {text,registry,blocks,staticBlocks,structures};
}
export function serialize(root: ElementNode): string { return serializeTree(root).text; }
