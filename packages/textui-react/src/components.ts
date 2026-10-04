import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { FieldConstraints, ValidationResult, UIEvent } from '@mineral/textui';

export interface BaseProps { id?: string; stateKey?: string }
export interface InteractionProps extends BaseProps, Pick<FieldConstraints,'disabled'|'readOnly'|'required'> {}
export interface InputProps extends InteractionProps { validate?:(value:string)=>ValidationResult; label: string; value: string; onChange?: (event: Extract<UIEvent, {type:'change'}>) => void }
export interface CheckProps extends InteractionProps { label: string; checked?: boolean; onChange?: InputProps['onChange'] }
export interface SelectProps extends InteractionProps {
  group: string; value: string | null;
  options: readonly {label: string; value: string; id?: string}[];
  onSelect?: (event: Extract<UIEvent, {type:'select'}>) => void;
}
export interface ActionProps extends InteractionProps { label: string; onTrigger?: (event: Extract<UIEvent, {type:'trigger'}>) => void }
export interface OutputProps extends BaseProps { label: string; value: string | number | boolean }
function host<P extends object>(type: string, props: P) { return createElement(type, props); }
export const Screen = (props: {id?: string; children?: ReactNode}) => host('screen', props);
export const Heading = (props: {level?: 1|2|3|4|5|6; children?: ReactNode}) => host('heading', props);
export const Text = (props: {children?: ReactNode}) => host('text', props);
export const Input = (props: InputProps) => host('input', props);
export const Check = (props: CheckProps) => host('check', props);
export const Select = (props: SelectProps) => host('select', props);
export const Action = (props: ActionProps) => host('action', props);
export const Output = (props: OutputProps) => host('output', props);
export const Divider = () => host('divider', {});
export const Link = (props: {href:string; title?:string; children?:ReactNode}) => host('link', props);
export const Image = (props: {src:string; alt?:string; title?:string}) => host('image', props);
export const Code = (props: {children?:ReactNode}) => host('code', props);
export const CodeBlock = (props: {lang?:string; meta?:string; children:string}) => host('code-block', props);
export const Quote = (props: {children?:ReactNode}) => host('quote', props);
export const Section = (props: {title:string; level?:1|2|3|4|5|6; children?:ReactNode}) => host('section', props);
export const List = (props: {children?:ReactNode}) => host('list', props);
export const OrderedList = (props: {start?:number; children?:ReactNode}) => host('ordered-list', props);
export const ListItem = (props: {children?:ReactNode}) => host('list-item', props);
export interface TableColumn {key:string; title:string; align?:'left'|'center'|'right'}
export interface TableProps {columns:readonly TableColumn[]; rows:readonly Record<string,string|number|boolean|null|undefined>[]}
export const Table = (props:TableProps) => host('table', props);
export interface BlockProps extends InteractionProps {
  lang?:string; type:string; value:string;
  onTextChange?:(event:Extract<UIEvent,{type:'textChange'}>)=>void;
  onEvent?:(event:Extract<UIEvent,{type:'blockEvent'}>)=>void;
}
export const Block = (props:BlockProps) => host('block', props);

export interface TextareaProps extends InteractionProps {
  label?:string; value:string; validate?:(value:string)=>ValidationResult;
  onChange?:(event:Extract<UIEvent,{type:'textChange'}>)=>void;
}
export interface NumberInputProps extends InteractionProps {
  label:string; value:number|null; min?:number; max?:number; step?:number;
  validate?:(value:number|null)=>ValidationResult;
  onValueChange?:(value:number|null)=>void;
}
export const Textarea=(props:TextareaProps)=>host('textarea',props);
export const NumberInput=(props:NumberInputProps)=>host('number',props);
export const Strong=(props:{children?:ReactNode})=>host('strong',props);
export const Emphasis=(props:{children?:ReactNode})=>host('emphasis',props);
export const Strike=(props:{children?:ReactNode})=>host('strike',props);
