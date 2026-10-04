import {applyPatches,textDiff} from './diff.ts';
import type {Patch} from './diff.ts';
function touches(a:Patch,b:Patch):boolean {
  if(a.from===a.to && b.from===b.to)return a.from===b.from;
  // Insertions on replacement boundaries are ambiguous; preserve both for review.
  if(a.from===a.to)return a.from>=b.from && a.from<=b.to;
  if(b.from===b.to)return b.from>=a.from && b.from<=a.to;
  return a.from<b.to && b.from<a.to;
}
export function mergeText(base:string,local:string,remote:string):{text:string;conflict:boolean} {
  if(local===remote)return {text:local,conflict:false};
  const mine=textDiff(base,local), theirs=textDiff(base,remote), combined=[...mine];
  for(const patch of theirs){
    const overlapping=mine.filter(p=>touches(p,patch));
    if(overlapping.some(p=>p.from!==patch.from || p.to!==patch.to || p.insert!==patch.insert))return {text:local,conflict:true};
    if(!overlapping.length)combined.push(patch);
  }
  combined.sort((a,b)=>a.from-b.from);
  return {text:applyPatches(base,combined),conflict:false};
}
