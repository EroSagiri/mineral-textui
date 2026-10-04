import type {Clock} from '../animation-demo/clock.js';
/** One disposable demand timer. Generation fences invalidate callbacks already queued. */
export class AnimationSession {
  private cancel:(()=>void)|undefined;
  private generation=0;
  constructor(private clock:Clock,private pulse:()=>Promise<void>,private fail:(error:unknown)=>void){}
  get scheduled(){return !!this.cancel;}
  refresh(active:boolean){
    this.cancel?.();this.cancel=undefined;
    const generation=++this.generation;
    if(active)this.cancel=this.clock.schedule(()=>{
      this.cancel=undefined;
      if(generation!==this.generation)return;
      void this.pulse().catch(this.fail);
    },250);
  }
  close(){this.refresh(false);}
}
