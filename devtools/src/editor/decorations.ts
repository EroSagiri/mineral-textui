import {StateEffect,StateField,Transaction} from '@codemirror/state';
import {Decoration,EditorView,WidgetType} from '@codemirror/view';
import type {DecorationSet} from '@codemirror/view';
import {parseTextUI} from '@mineral/textui';
import type {DevtoolsFrame as TextFrame} from '../api.js';
export const projectFrame=StateEffect.define<TextFrame|null>();
class FrameWidget extends WidgetType {
  constructor(readonly text:string){super();}
  override eq(other:FrameWidget){return this.text===other.text;}
  toDOM(){const span=document.createElement('span');span.className='animation-frame';span.textContent=this.text;span.title='临时动画 · 不写入 Markdown';return span;}
}
function decorations(text:string,frame:TextFrame|null):DecorationSet {
  if(!frame)return Decoration.none;
  try {
    const target=parseTextUI(text).controls.get(frame.targetId);
    if(!target || target.type!=='output' || target.end<=target.start)return Decoration.none;
    return Decoration.set([Decoration.replace({widget:new FrameWidget(frame.markdown)}).range(target.start,target.end)]);
  } catch{return Decoration.none;}
}
export const projection=StateField.define<{frame:TextFrame|null;decorations:DecorationSet}>({
  create:()=>({frame:null,decorations:Decoration.none}),
  update(value,transaction){
    let frame=value.frame;
    for(const effect of transaction.effects)if(effect.is(projectFrame))frame=effect.value;
    if(transaction.docChanged || frame!==value.frame)return {frame,decorations:decorations(transaction.newDoc.toString(),frame)};
    return value;
  },
  provide:field=>EditorView.decorations.from(field,value=>value.decorations),
});
export function showFrame(view:EditorView,frame:TextFrame|null){
  view.dispatch({effects:projectFrame.of(frame),annotations:Transaction.addToHistory.of(false)});
}
