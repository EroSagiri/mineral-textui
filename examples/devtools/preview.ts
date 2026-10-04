import {definePreview} from '@mineral/textui-devtools/preview';
export default definePreview({blocks:{
  'server-chart':block=>{
    const root=document.createElement('div');root.setAttribute('aria-label','Server chart');
    const values:unknown=JSON.parse(block.value);
    if(!Array.isArray(values))throw new Error('Chart expects an array');
    for(const value of values){
      if(typeof value!=='number' || !Number.isFinite(value))throw new Error('Chart expects finite numbers');
      const progress=document.createElement('progress');progress.max=100;progress.value=value;progress.textContent=String(value);root.append(progress,document.createElement('br'));
    }
    return root;
  },
}});
