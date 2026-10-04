// Compiled by pnpm check: public signatures and deliberate rejection of unserializable values.
import type {InputProps,CheckProps,SelectProps,ActionProps,BlockProps,TextareaProps,NumberInputProps} from '@mineral/textui-react';
import {CodeBlock,Input,NumberInput,Textarea,Strong,useTextState} from '@mineral/textui-react';
import type {UIEvent,ScreenPort,ValidationResult,FieldValidationError} from '@mineral/textui';
const change:InputProps['onChange']=(event:Extract<UIEvent,{type:'change'}>)=>{const value:string|boolean=event.after;void value;};
const oldCheck:CheckProps={label:'Check',onChange:change};
const oldSelect:SelectProps={group:'g',value:null,options:[{value:'a',label:'A'}],onSelect:e=>{const value:string|null=e.after;void value;}};
const oldAction:ActionProps={label:'Go',onTrigger:e=>{const type:'trigger'=e.type;void type;}};
const block:BlockProps={type:'custom',value:'raw',onTextChange:e=>{const after:string=e.after;void after;}};
const textarea:TextareaProps={value:'中文',onChange:e=>{const after:string=e.after;void after;}};
const number:NumberInputProps={label:'N',value:null,onValueChange:n=>{const after:number|null=n;void after;}};
export function TypeExample(){const [value,set]=useTextState<number|null>('n',null);return <><NumberInput label="N" value={value} onValueChange={set}/><Textarea {...textarea}/><Input label="I" value="x" onChange={change}/><CodeBlock>{'code'}</CodeBlock><Strong>Text</Strong></>;}
// @ts-expect-error CodeBlock cannot contain arbitrary React elements
const badCode=<CodeBlock><Strong>unsupported</Strong></CodeBlock>;
// @ts-expect-error NumberInput value must be a number or null
const badNumber=<NumberInput label="N" value="12"/>;
// @ts-expect-error Textarea value must be a string
const badTextarea=<Textarea value={{body:'text'}}/>;
const validation:ValidationResult={valid:true};const error:FieldValidationError={target:'n',code:'parse',message:'bad'};
const port:ScreenPort={async getScreen(){return null;},async setScreen(id,text,options){return {id,text,revision:String(options.expectedRevision)};},async onScreenChange(){return ()=>{};}};
void [oldCheck,oldSelect,oldAction,block,number,badCode,badNumber,badTextarea,validation,error,port];
