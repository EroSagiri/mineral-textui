import {ProtocolError} from './schema.js';
import type {FieldConstraints} from './schema.js';
export interface ValidationResult {valid:boolean; message?:string}
export interface FieldValidationError {target:string; code:string; message:string; start?:number; end?:number}
export class FieldValidationException extends ProtocolError implements FieldValidationError {
  constructor(public target:string,public code:string,message:string,public start?:number,public end?:number){super(message);this.name='FieldValidationException';}
}
export interface ValidationOptions<T> extends FieldConstraints {validate?:(value:T)=>ValidationResult}
/** Locale-independent decimal grammar; no partial parsing, whitespace, hex or infinities. */
export function parseNumberText(text:string):number|null {
  if(text==='')return null;
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text)))throw new ProtocolError('需要有限十进制数字，使用 . 作为小数分隔符。');
  return Number(text);
}
export function validateField<T extends string|number|boolean|null>(value:T,options:ValidationOptions<T>={},phase:'edit'|'submit'='submit'):ValidationResult {
  if(phase==='submit' && options.required && (value===null || value===false || (typeof value==='string' && !value.trim())))return {valid:false,message:'字段为必填项。'};
  if(typeof value==='number') {
    if(!Number.isFinite(value))return {valid:false,message:'数字必须有限。'};
    if(options.min!==undefined && value<options.min)return {valid:false,message:`数字不能小于 ${options.min}。`};
    if(options.max!==undefined && value>options.max)return {valid:false,message:`数字不能大于 ${options.max}。`};
    if(options.step!==undefined){const base=options.min??0,q=(value-base)/options.step;
      const tolerance=Math.min(1e-7,Number.EPSILON*16*Math.max(1,Math.abs(q)));
      if(!Number.isFinite(q)||Math.abs(q-Math.round(q))>tolerance)return {valid:false,message:`数字必须符合 step=${options.step}。`};}
  }
  return options.validate?.(value)??{valid:true};
}
const names=['disabled','readOnly','required','min','max','step'] as const;
export function constraintMetadata(props:Record<string,unknown>):string {
  const parts:string[]=[];
  for(const name of names){const value=props[name];if(value===undefined)continue;
    if(['disabled','readOnly','required'].includes(name)){if(typeof value!=='boolean')throw new ProtocolError(`${name} 必须为布尔值。`);}
    else if(typeof value!=='number'||!Number.isFinite(value)||(name==='step'&&value<=0))throw new ProtocolError(`${name} 需要有限数值，step 必须大于零。`);
    parts.push(`${name}=${value}`);
  }
  if(typeof props.min==='number'&&typeof props.max==='number'&&props.min>props.max)throw new ProtocolError('min 不能大于 max。');
  return parts.length?' '+parts.join(' '):'';
}
export function parseConstraints(attrs:Map<string,string>):FieldConstraints {
  const result:Record<string,unknown>={};
  for(const name of names){const raw=attrs.get(name);if(raw===undefined)continue;
    if(['disabled','readOnly','required'].includes(name)){if(raw!=='true'&&raw!=='false')throw new ProtocolError(`${name} 需要 true/false。`);result[name]=raw==='true';}
    else {const n=parseNumberText(raw);if(n===null)throw new ProtocolError(`${name} 不能为空。`);result[name]=n;}
  }
  constraintMetadata(result);return result;
}
export function assertEditable(target:string,old:FieldConstraints,after:FieldConstraints,start?:number,end?:number,changed=true):void {
  for(const name of names)if(old[name]!==after[name])throw new FieldValidationException(target,'metadata','外部编辑不能改变控件约束。',start,end);
  if(changed&&(old.disabled||old.readOnly))throw new FieldValidationException(target,old.disabled?'disabled':'readOnly','字段不允许外部修改。',start,end);
}
