import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const names=['textui','textui-react','textui-host-node'];
const packages=new Map(names.map(name=>{const directory=resolve(root,'packages',name);const manifest=JSON.parse(readFileSync(resolve(directory,'package.json'),'utf8'));return [manifest.name,{directory,manifest}];}));
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(resolve(directory,entry.name)):[resolve(directory,entry.name)]);}
for(const [name,{directory,manifest}] of packages){
  assert(!manifest.private,`${name} is not publishable`);
  assert.equal(manifest.exports['.'].import,'./dist/index.js');assert(existsSync(resolve(directory,'dist/index.js')));
  const dependencies={...manifest.dependencies,...manifest.peerDependencies};
  for(const file of files(resolve(directory,'src'))){
    if(!/\.tsx?$/.test(file))continue;
    const source=readFileSync(file,'utf8');
    for(const match of source.matchAll(/\b(?:import|export)(\s+type)?\s+(?:\{[^}]*\}|[^\n;]*?)\s+from\s*['"]([^'"]+)['"]/g)){
        const specifier=match[2];
        if(specifier.startsWith('.'))assert(!relative(resolve(directory,'src'),resolve(dirname(file),specifier)).startsWith('..'),`${file} imports another package's source`);
        else {
          const packageName=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
          const typeOnly=Boolean(match[1]);
          if(!specifier.startsWith('node:'))assert(packageName in dependencies || (name==='@mineral/textui' && packageName in (manifest.devDependencies??{})) || (typeOnly && `@types/${packageName}` in (manifest.devDependencies??{})),`${file} has undeclared dependency ${specifier}`);
          if(name==='@mineral/textui')assert(!/^(node:|react|chokidar|cloudflare|@cloudflare)/.test(specifier),`${file} has a platform dependency`);
          if(name==='@mineral/textui-react')assert(!/^(node:|chokidar|cloudflare|@cloudflare|@mineral\/textui-host)/.test(specifier),`${file} has a Host dependency`);
          if(name==='@mineral/textui-host-node')assert(!/^(react|@mineral\/textui-react)/.test(specifier),`${file} depends on React`);
          if(specifier.startsWith('@mineral/'))assert(packages.has(specifier),`${file} bypasses a package entry`);
        }
    }
  }
}
// Resolve the complete runtime dependency graph without any Node or DOM shims.
for(const name of ['textui','textui-react']){
  const result=await build({entryPoints:[resolve(root,'packages',name,'dist/index.js')],bundle:true,write:false,format:'esm',platform:'neutral',conditions:['workerd','worker','import'],mainFields:['module','main'],define:{'process.env.NODE_ENV':'"production"'},metafile:true});
  for(const input of Object.keys(result.metafile.inputs))assert(!input.endsWith('index.dom.js'),`${name} transitively requires DOM`);
  assert(!/\b(?:window\.(?:document|addEventListener)|document\.(?:createElement|querySelector|getElementById))\b/.test(result.outputFiles[0].text),`${name} requires DOM globals`);
}
const visited=new Set(),visiting=new Set();
function visit(name){if(visited.has(name))return;assert(!visiting.has(name),`dependency cycle at ${name}`);visiting.add(name);for(const dep of Object.keys(packages.get(name).manifest.dependencies??{}))if(packages.has(dep))visit(dep);visiting.delete(name);visited.add(name);}
for(const name of packages.keys())visit(name);
assert(!existsSync(resolve(root,'src')),'obsolete root src remains');assert(!existsSync(resolve(root,'package-lock.json')),'obsolete npm lock remains');
console.log('Package entries, dependency boundaries and platform-neutral dependency graphs passed.');
