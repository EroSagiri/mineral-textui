import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {MemoryScreen} from '@mineral/textui';
import {createDevtoolsBridge} from '../../src/bridge.js';
import {startDevtools} from '../../server.js';
import {resolve} from 'node:path';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';

test('connects existing remote Bridge with server-side auth and subscription roundtrip',async({page})=>{
  const port=new MemoryScreen();await port.setScreen('remote/home','# Remote\n\nName: [June] <!-- textui:id=name type=input -->',{expectedRevision:null});
  const bridge=createDevtoolsBridge({port,screens:[{id:'remote/home'}],inspect:()=>({router:{path:'/provided-by-app'}})},{enabled:true,instanceId:'remote-1',token:'only-on-server'});
  const http=createServer((req,res)=>{void(async()=>{
    let body='';for await(const chunk of req)body+=chunk;
    const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers as Record<string,string>,body:req.method==='PUT'?body:undefined});
    const response=await bridge.handleRequest(request);res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());
  })();});
  const sockets=new WebSocketServer({server:http});sockets.on('connection',(socket,req)=>{void(async()=>{
    const request=new Request('http://'+req.headers.host+req.url,{headers:req.headers as Record<string,string>});
    if(!bridge.authorized(request)){socket.close(1008);return;}
    let closed=false,unsubscribe:(()=>void)|undefined;socket.on('close',()=>{closed=true;unsubscribe?.();});
    unsubscribe=await bridge.subscribeScreen(decodeURIComponent(new URL(request.url).pathname.split('/')[2]),message=>{if(!closed)socket.send(JSON.stringify(message));});if(closed)unsubscribe();
  })();});
  await new Promise<void>(done=>http.listen(0,'127.0.0.1',done));
  const remoteURL='http://127.0.0.1:'+(http.address() as import('node:net').AddressInfo).port;
  await mkdir('.artifacts',{recursive:true});const directory=await mkdtemp(resolve('.artifacts/remote-'));
  await writeFile(resolve(directory,'textui.dev.ts'),`export default {remote:{url:${JSON.stringify(remoteURL)},token:'only-on-server'}};`);
  const server=await startDevtools({port:0,projectRoot:directory});
  try{
    await page.goto(server.url);await expect(page.locator('#status')).toHaveText('Saved');
    const config=await(await fetch(server.url+'/api/config')).text();expect(config).not.toContain('only-on-server');
    await page.locator('#preview [data-control="name"]').fill('Remote edit');await page.locator('#save').click();await expect(page.locator('#status')).toHaveText('Saved');
    expect((await port.getScreen('remote/home'))!.text).toContain('[Remote edit]');
    const previous=(await port.getScreen('remote/home'))!;await port.setScreen(previous.id,previous.text.replace('Remote edit','External edit'),{expectedRevision:previous.revision});
    await expect(page.locator('#preview [data-control="name"]')).toHaveValue('External edit');
    await page.locator('#inspect').click();await expect(page.locator('#inspection')).toContainText('/provided-by-app');
  }finally{await server.close();for(const socket of sockets.clients)socket.terminate();sockets.close();await new Promise<void>(done=>http.close(()=>done()));}
});
