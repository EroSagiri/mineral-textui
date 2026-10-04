import {basename,dirname,extname,resolve} from 'node:path';
import {createNodeHost} from '@mineral/textui-host-node';
import {render} from '@mineral/textui-react';
import {InlineMarkdownShowcase} from './inline-markdown-showcase.tsx';
import {AdvancedForm} from './advanced-form.tsx';

async function main() {
  const [name='advanced-form',path,...extra]=process.argv.slice(2);
  if(name==='--help'){console.log('用法：pnpm phase6 <advanced-form|inline-markdown-showcase> [文件.md]');return;}
  if(extra.length || !['advanced-form','inline-markdown-showcase'].includes(name))throw new Error('无效参数，使用 pnpm phase6 --help 查看用法。');
  const file=resolve(path??`screens/${name}.md`);
  if(extname(file)!=='.md')throw new Error('屏幕文件必须使用 .md 后缀。');
  const report=(error:unknown)=>console.error(error instanceof Error?error.message:String(error));
  const host=createNodeHost(dirname(file),{onError:report});
  let root;
  try{root=await render(name==='advanced-form'?<AdvancedForm/>:<InlineMarkdownShowcase/>,{host,screen:basename(file,'.md'),onError:report});}
  catch(error){await host.close();throw error;}
  console.log(`正在监听：${file}\n使用任意编辑器修改 Markdown 并保存；Ctrl+C 保存并退出。`);
  let closing=false;
  const shutdown=()=>{if(closing)return;closing=true;void (async()=>{try{await root.unmount();}finally{await host.close();}})().catch(error=>{report(error);process.exitCode=1;});};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
