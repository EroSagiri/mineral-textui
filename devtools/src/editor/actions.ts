import {parseTextUI} from '@mineral/textui';
import type {Patch} from './diff.ts';
/** Editor enhancement only changes the existing generic Action token. */
export function actionPatch(text:string,id:string):Patch|null{
  try{const control=parseTextUI(text).controls.get(id);return control?.type==='action' && !control.value && !control.disabled && !control.readOnly?{from:control.start,to:control.end,insert:'[x]'}:null;}catch{return null;}
}
export function actionAt(text:string,position:number):string|null{
  try{return [...parseTextUI(text).controls.values()].find(control=>control.type==='action' && position>=control.start && position<control.end)?.id??null;}catch{return null;}
}
