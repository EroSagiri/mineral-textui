import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeHost} from '@mineral/textui-host-node';
import {parseTextUI,patchValues} from '@mineral/textui';
import {createAnimationApp} from './app.js';
import {ManualClock} from './clock.js';
import {renderFrame} from './animation.js';
import {LocalFrameStream} from '../worker-animation/frame-stream.js';

async function measure(streamMode:boolean){
  const directory=await mkdtemp(join(tmpdir(),'animation-measure-')),host=createNodeHost(directory),clock=new ManualClock(1000);
  const app=await createAnimationApp(host,clock,{stream:streamMode,newId:()=> 'measurement'});
  let writes=0,frames=0,messages=0,bytes=0;
  const stopWrites=await host.onScreenChange('build',change=>{if(change.origin?.startsWith('textui:'))writes++;});
  const stream=new LocalFrameStream();const receive=(frame:unknown)=>{messages++;bytes+=Buffer.byteLength(JSON.stringify(frame));};
  const stops=[stream.onFrame('build',frame=>receive(frame)),stream.onFrame('build',frame=>receive(frame))];
  try{
    const before=(await host.getScreen('build'))!;
    await host.setScreen('build',patchValues(parseTextUI(before.text),new Map([['start',true]])),{expectedRevision:before.revision});await app.idle();writes=0;
    const start=performance.now();
    for(let i=0;i<=40;i++){
      if(i)clock.advance(250);
      if(i%4===0)await app.tick();
      if(streamMode && app.state().status==='running'){
        const saved=(await host.getScreen('build'))!;frames++;
        stream.publishFrame({screenId:'build',targetId:'progress',animationId:app.state().id,sequence:frames,baseRevision:saved.revision,generatedAt:clock.now(),markdown:renderFrame(app.state(),clock.now())});
      }
    }
    return {mode:streamMode?'temporary-4fps':'markdown-1fps',simulatedMs:10000,writes,frames,subscribers:streamMode?2:0,messages,frameBytes:bytes,wallMs:Number((performance.now()-start).toFixed(2))};
  }finally{stops.forEach(stop=>stop());stopWrites();await app.close();await host.close();await rm(directory,{recursive:true,force:true});}
}
console.log(JSON.stringify({runtime:process.version,results:[await measure(false),await measure(true)]},null,2));
