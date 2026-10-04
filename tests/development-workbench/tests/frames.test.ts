import {expect,it} from 'vitest';
import {FrameClient} from '../src/transport/frame-client.ts';
import {initialState} from '../../../examples/animation-demo/animation.ts';
import type {TextFrame} from '../../../examples/worker-animation/frame-stream.ts';
const text=(id:string,status='running')=>`Progress: 20% <!-- textui:id=progress type=output -->\n\n\`\`\`json type=animation id=animation\n${JSON.stringify({...initialState(id),status})}\n\`\`\`\n`;
it('accepts 40 frames, fences order, identity, revision and expiry',()=>{
  const client=new FrameClient(),now=Date.now(),snapshot={id:'build',text:text('one'),revision:'opaque'};
  const frame:TextFrame={screenId:'build',targetId:'progress',animationId:'one',sequence:0,baseRevision:'opaque',generatedAt:now,markdown:'temporary'};
  for(let sequence=0;sequence<40;sequence++)expect(client.accept({...frame,sequence},snapshot,now)).toBe(true);
  expect(client.accept({...frame,sequence:39},snapshot,now)).toBe(false);
  expect(client.accept({...frame,sequence:42,baseRevision:'old'},snapshot,now)).toBe(false);
  expect(client.accept({...frame,sequence:43,generatedAt:now-3000},snapshot,now)).toBe(false);
  expect(client.accept({...frame,sequence:44,animationId:'old'},snapshot,now)).toBe(false);
  const next={...snapshot,text:text('two')};expect(client.accept({...frame,animationId:'two',sequence:0},next,now)).toBe(true);
  expect(client.accept({...frame,sequence:45},next,now)).toBe(false);
  expect(client.accept({...frame,sequence:46}, {...snapshot,text:text('one','paused')},now)).toBe(false);
  expect(client.accept({...frame,sequence:47}, {...snapshot,text:'target deleted'},now)).toBe(false);
  expect(client.received).toBe(48);expect(client.dropped).toBe(7);
});
