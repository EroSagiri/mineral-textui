import {build,context} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('.',import.meta.url));
const watching=process.argv.includes('--watch');
await build({entryPoints:[root+'extension.ts'],outfile:root+'dist/extension.cjs',bundle:true,platform:'node',format:'cjs',external:['vscode']});
const notify={name:'reload-marker',setup(builder){builder.onEnd(async result=>{if(!result.errors.length)await writeFile(root+'dist/reload.json',JSON.stringify({version:Date.now(),build:Math.random()}));});}};
const runtime={entryPoints:[root+'runtime.ts'],outfile:root+'dist/runtime.cjs',bundle:true,platform:'node',format:'cjs',external:['vscode'],plugins:[notify]};
const webview={entryPoints:[root+'webview.ts'],outfile:root+'dist/webview.js',bundle:true,platform:'browser',format:'iife',plugins:[{
  name:'textui-project-preview',setup(builder){
    builder.onResolve({filter:/^virtual:textui-preview$/},()=>process.env.TEXTUI_DEVTOOLS_PREVIEW?{path:resolve(process.env.TEXTUI_DEVTOOLS_PREVIEW)}:{path:'preview',namespace:'empty-preview'});
    builder.onLoad({filter:/.*/,namespace:'empty-preview'},()=>({contents:'export default undefined;',loader:'js'}));
  },
},notify]};
if(watching){
  console.log('[textui-watch] starting');
  const contexts=await Promise.all([context(runtime),context(webview)]);
  await Promise.all(contexts.map(ctx=>ctx.rebuild()));
  await Promise.all(contexts.map(ctx=>ctx.watch()));
  console.log('[textui-watch] ready');
  const close=()=>{void Promise.all(contexts.map(ctx=>ctx.dispose())).then(()=>process.exit());};
  process.once('SIGINT',close);process.once('SIGTERM',close);
}else{await build(runtime);await build(webview);}
