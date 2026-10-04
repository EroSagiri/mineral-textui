import MarkdownIt from 'markdown-it';
import {parseTextUI} from '@mineral/textui';
import type {ParsedBlock,ParsedControl} from '@mineral/textui';
import type {PreviewEdit} from './model.ts';

export interface BlockPreviewAPI {readonly writable:boolean; edit(value:string):void}
export type BlockPreview=(block:ParsedBlock,api:BlockPreviewAPI)=>HTMLElement;
export class PreviewRegistry {
  private blocks=new Map<string,BlockPreview>();
  register(type:string,render:BlockPreview){if(this.blocks.has(type))throw new Error(`Duplicate preview: ${type}`);this.blocks.set(type,render);return ()=>this.blocks.delete(type);}
  get(type:string){return this.blocks.get(type);}
}
export function definePreview(options:{blocks:Record<string,BlockPreview>}){
  const registry=new PreviewRegistry();for(const [type,render] of Object.entries(options.blocks))registry.register(type,render);return registry;
}
export interface PreviewOptions {writable?:boolean;commit?:'input'|'change';onEdit?:(edit:PreviewEdit)=>void;registry?:PreviewRegistry;frame?:{targetId:string;markdown:string}|null}
/** Markdown first, then DOM enhancement. Raw HTML is disabled. */
export function renderPreview(root:HTMLElement,text:string,options:PreviewOptions={}):string|null{
  if(root.dataset.composing==='true')return null;
  const active=root.contains(document.activeElement)?document.activeElement as HTMLInputElement:null;
  const focus=active?.dataset.control,selection=active?.type==='text'||active?.tagName==='TEXTAREA'?[active.selectionStart,active.selectionEnd]:null;
  const md=new MarkdownIt({html:false,linkify:false});
  md.inline.ruler.before('text','textui_epoch',(state)=>{
    const marker=/^<!--\s*textui:epoch=\d+\s*-->/.exec(state.src.slice(state.pos));
    if(!marker)return false;state.pos+=marker[0].length;return true;
  });
  let parsed:ReturnType<typeof parseTextUI>;
  try{parsed=parseTextUI(text);}catch(error){root.innerHTML=md.render(text);return error instanceof Error?error.message:String(error);}
  let prefix='textui-preview-';while(text.includes(prefix))prefix+='x';
  const replacements=[...parsed.controls.values(),...parsed.blocks.values()].sort((a,b)=>b.fullStart-a.fullStart);
  const slots=new Map<string,ParsedControl|ParsedBlock>();
  let projected=text;
  for(const [index,item] of replacements.entries()){
    const token=`${prefix}${index}`;slots.set(token,item);
    const bullet=!('lang' in item) && ['action','check'].includes(item.type)?/^(?:[-+*])[ \t]+/.exec(text.slice(item.fullStart,item.fullEnd))?.[0]??'':'';
    projected=projected.slice(0,item.fullStart)+bullet+'`'+token+'`'+projected.slice(item.fullEnd);
  }
  const original=md.renderer.rules.code_inline!;
  md.renderer.rules.code_inline=(tokens,index,opts,env,renderer)=>slots.has(tokens[index].content)?`<span data-preview-slot="${tokens[index].content}"></span>`:original(tokens,index,opts,env,renderer);
  root.innerHTML=md.render(projected);
  for(const slot of root.querySelectorAll<HTMLElement>('[data-preview-slot]')){
    const item=slots.get(slot.dataset.previewSlot!)!,writable=options.writable===true && !item.disabled && !item.readOnly;
    const edit=(value:string|boolean)=>{if(writable)options.onEdit?.({id:item.id,value});};
    let node:HTMLElement;
    if('lang' in item){
      const custom=options.registry?.get(item.type);
      if(custom){try{node=custom(item,{writable,edit});}catch(error){node=document.createElement('pre');node.textContent=String(error);}}
      else if(item.type==='textarea'){
        const input=document.createElement('textarea');input.value=item.value;input.disabled=!writable;input.setAttribute('aria-label',item.id);bindInput(input,edit,options.commit);node=input;
      }else{node=document.createElement('pre');const code=document.createElement('code');code.textContent=item.value;node.append(code);node.title=`Unregistered block: ${item.type}`;}
    }else if(item.type==='action'){
      const button=document.createElement('button');button.textContent=item.label;button.disabled=!writable || item.value===true;button.onclick=()=>edit(true);node=button;
    }else if(item.type==='output'){
      node=document.createElement('output');node.textContent=`${item.label}: ${options.frame?.targetId===item.id?options.frame.markdown:item.value}`;
        if(options.frame?.targetId===item.id)node.classList.add('preview-frame','animation-frame');
    }else{
      const label=document.createElement('label'),input=document.createElement('input');
      input.type=item.type==='check'?'checkbox':item.type==='select'?'radio':'text';
      // Number uses text + decimal keyboard so partial/invalid text remains inspectable.
      if(item.type==='number')input.inputMode='decimal';
      if(item.type==='select')input.name=`${prefix}${item.group}`;
      input.disabled=!writable;input.required=item.required??false;
      if(typeof item.value==='boolean'){input.checked=item.value;input.onchange=()=>edit(input.checked);}
      else{input.value=item.value;bindInput(input,edit,options.commit);}
      input.dataset.control=item.id;label.append(item.label+' ',input);node=label;
    }
    node.dataset.previewId=item.id;
    if(node.tagName==='TEXTAREA')node.dataset.control=item.id;
    slot.replaceWith(node);
  }
  if(focus){const input=[...root.querySelectorAll<HTMLInputElement>('[data-control]')].find(node=>node.dataset.control===focus);input?.focus();if(input && selection)input.setSelectionRange(selection[0],selection[1]);}
  return null;
}
function bindInput(input:HTMLInputElement|HTMLTextAreaElement,edit:(value:string)=>void,commit:'input'|'change'='input'){
  input.addEventListener('compositionstart',()=>{input.closest<HTMLElement>('#preview')!.dataset.composing='true';});
  input.addEventListener('compositionend',()=>{delete input.closest<HTMLElement>('#preview')!.dataset.composing;});
  input.addEventListener(commit,event=>{if(!(event instanceof InputEvent) || !event.isComposing)edit(input.value);});
  if(commit==='input')input.addEventListener('compositionend',()=>edit(input.value));
}
