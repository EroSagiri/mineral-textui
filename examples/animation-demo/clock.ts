/** Time and scheduling are application inputs, never part of animation calculation. */
export interface Clock {now():number; schedule(task:()=>void, delayMs:number):()=>void}
export const systemClock:Clock={now:()=>Date.now(),schedule(task,delayMs){const timer=setTimeout(task,delayMs);return ()=>clearTimeout(timer);}};
export class ManualClock implements Clock {
  private tasks=new Map<number,{at:number;task:()=>void}>();
  private next=0;
  constructor(private time=0){}
  now=()=>this.time;
  schedule(task:()=>void,delayMs:number) {const id=++this.next;this.tasks.set(id,{at:this.time+delayMs,task});return ()=>{this.tasks.delete(id);};}
  get pending(){return this.tasks.size;}
  advance(ms:number){this.time+=ms;for(const [id,value] of [...this.tasks])if(value.at<=this.time){this.tasks.delete(id);value.task();}}
}
