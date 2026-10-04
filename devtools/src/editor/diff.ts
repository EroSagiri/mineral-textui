import {diffChars} from 'diff';
export interface Patch {from:number; to:number; insert:string}
export function textDiff(before:string, after:string):Patch[] {
  const patches:Patch[]=[];
  let offset=0, pending:Patch|undefined;
  for(const part of diffChars(before,after)) {
    if(!part.added && !part.removed) {
      if(pending){patches.push(pending);pending=undefined;}
      offset+=part.value.length;
    } else {
      pending??={from:offset,to:offset,insert:''};
      if(part.removed){offset+=part.value.length;pending.to=offset;}
      else pending.insert+=part.value;
    }
  }
  if(pending)patches.push(pending);
  return patches;
}
export function applyPatches(text:string,patches:readonly Patch[]):string {
  for(const p of [...patches].reverse())text=text.slice(0,p.from)+p.insert+text.slice(p.to);
  return text;
}
