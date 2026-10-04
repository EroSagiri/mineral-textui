import {FrameReceiver} from '../../../../examples/worker-animation/frame-stream.ts';
import type {TextFrame} from '../../../../examples/worker-animation/frame-stream.ts';
import type {ScreenSnapshot} from '@mineral/textui';
export class FrameClient {
  private receiver=new FrameReceiver();
  received=0;dropped=0;
  accept(frame:TextFrame,snapshot:ScreenSnapshot|null,now=Date.now()):boolean {
    this.received++;
    try{if(snapshot && this.receiver.accept(frame,snapshot,now))return true;}catch{}
    this.dropped++;return false;
  }
}
