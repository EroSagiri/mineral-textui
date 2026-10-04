import {parseTextUI,patchValues} from '@mineral/textui';
import type {ScreenSnapshot} from '@mineral/textui';
import {FrameReceiver} from '../worker-animation/frame-stream.js';
import type {TextFrame} from '../worker-animation/frame-stream.js';

const url=process.env.TEXTUI_ANIMATION_URL??'http://localhost:8788/apps/demo/screens/build';
const [command='watch',...args]=process.argv.slice(2);
if(['start','pause','reset','note'].includes(command)){
  const read=await fetch(url);if(!read.ok)throw new Error(await read.text());
  const {screen}=await read.json() as {screen:ScreenSnapshot};
  const values=new Map<string,string|boolean>([[command,command==='note'?args.join(' '):true]]);
  const response=await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({text:patchValues(parseTextUI(screen.text),values),expectedRevision:screen.revision})});
  const result=await response.json() as {screen?:ScreenSnapshot;error?:string};
  if(!response.ok)throw new Error(JSON.stringify(result));
  console.log(result.screen!.text);
}else if(command==='watch'){
  let closed=false,socket:WebSocket|undefined,retry:ReturnType<typeof setTimeout>|undefined;
  const connect=()=>{
    if(closed)return;
    let snapshot:ScreenSnapshot|undefined;
    const receiver=new FrameReceiver();
    socket=new WebSocket(url.replace(/^http/,'ws')+'/subscribe');
    socket.addEventListener('open',()=>{socket!.send('snapshot');});
    socket.addEventListener('message',event=>{
      const message=JSON.parse(String(event.data)) as {type:string;screen?:ScreenSnapshot;frame?:TextFrame};
      if((message.type==='snapshot'||message.type==='change') && message.screen){snapshot=message.screen;console.log(snapshot.text);}
      if(message.type==='frame' && snapshot && message.frame){
        if(receiver.accept(message.frame,snapshot,Date.now()))console.log(message.frame.markdown);
        else if(message.frame.baseRevision!==snapshot.revision)socket!.send('snapshot');
      }
    });
    socket.addEventListener('error',()=>{console.error('Connection interrupted; waiting to reconnect.');});
    socket.addEventListener('close',()=>{if(!closed)retry=setTimeout(connect,1000);});
  };
  const stop=()=>{closed=true;if(retry)clearTimeout(retry);socket?.close(1000,'Client shutdown');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);connect();
}else throw new Error('Use watch, start, pause, reset or note <text>');
