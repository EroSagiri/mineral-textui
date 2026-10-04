import {it,expect} from 'vitest';
import {FrameClient} from '../src/transport/frame-client.js';
import type {DevtoolsFrame} from '../src/api.js';
const screen={id:'arbitrary',revision:'opaque',text:'Progress: 20% <!-- textui:id=progress type=output -->'};
const frame:DevtoolsFrame={screenId:screen.id,baseRevision:screen.revision,targetId:'progress',animationId:'a',sequence:1,generatedAt:1000,markdown:'64%'};
it('projects only fresh ordered Output frames without modifying snapshots',()=>{
  const receiver=new FrameClient();expect(receiver.accept(frame,screen,1000)).toBe(true);
  expect(receiver.accept(frame,screen,1000)).toBe(false);
  expect(receiver.accept({...frame,sequence:2,baseRevision:'other'},screen,1000)).toBe(false);
  expect(receiver.accept({...frame,sequence:2},screen,4000)).toBe(false);
  expect(receiver.accept({...frame,sequence:2,targetId:'missing'},screen,1000)).toBe(false);
  expect(receiver.accept({...frame,sequence:1,animationId:'b',generatedAt:1200},screen,1200)).toBe(true);
  expect(receiver.accept({...frame,sequence:3,generatedAt:1250},screen,1250)).toBe(false);
  expect(screen.text).toContain('20%');expect(screen.revision).toBe('opaque');
});
