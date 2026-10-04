import {basicSetup} from 'codemirror';
import {markdown} from '@codemirror/lang-markdown';
import {EditorState,Transaction} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {textDiff} from './diff.ts';
import {projection} from './decorations.ts';
import {actionAt} from './actions.ts';
export function createEditor(parent:HTMLElement,onEdit:(text:string)=>void,onComposition:(active:boolean)=>void,onCursor:()=>void,onAction?:(id:string)=>boolean){
  return new EditorView({parent,state:EditorState.create({extensions:[
    basicSetup,markdown(),EditorView.lineWrapping,projection,
    EditorView.updateListener.of(update=>{
      if(update.docChanged && update.transactions.some(transaction=>!transaction.annotation(Transaction.remote)))onEdit(update.state.doc.toString());
      if(update.docChanged || update.selectionSet)onCursor();
    }),
    EditorView.domEventHandlers({
      click:(event,view)=>{
        if(event.button!==0 || event.ctrlKey || event.metaKey || event.altKey || view.compositionStarted || !onAction)return false;
        const position=view.posAtCoords({x:event.clientX,y:event.clientY});
        if(position===null)return false;
        const id=actionAt(view.state.doc.toString(),position);
        if(id && onAction(id)){event.preventDefault();return true;}
        return false;
      },
      compositionstart:()=>{onComposition(true);},
      compositionend:()=>{setTimeout(()=>onComposition(false),0);},
    }),
    EditorView.theme({'&':{height:'100%'},'.cm-scroller':{overflow:'auto',fontFamily:'Consolas, monospace',fontSize:'14px',lineHeight:'1.7'},'.cm-content':{padding:'20px 0'},'.cm-gutters':{backgroundColor:'#f5f7fa',border:'none'}}),
  ]})});
}
export function applyRemote(view:EditorView,text:string):{patches:number;characters:number}{
  const changes=textDiff(view.state.doc.toString(),text);
  if(changes.length)view.dispatch({changes,effects:view.scrollSnapshot(),annotations:[Transaction.remote.of(true),Transaction.addToHistory.of(false)]});
  return {patches:changes.length,characters:changes.reduce((sum,p)=>sum+p.to-p.from+p.insert.length,0)};
}
