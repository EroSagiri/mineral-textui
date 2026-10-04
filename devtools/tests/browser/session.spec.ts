import {test,expect} from '@playwright/test';
import {startDevtools} from '../../server.js';
import {resolve} from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';

test('custom port, multiple Screens, draft preservation, text actions and runtime inspection',async({page})=>{
  await mkdir('.artifacts',{recursive:true});const fixture=await mkdtemp(resolve('.artifacts/multi-screen-'));
  const appPath=resolve(fixture,'app.tsx'),configPath=resolve(fixture,'textui.dev.tsx');
  const originalApp=await readFile('../examples/devtools/app.tsx','utf8');await writeFile(appPath,originalApp);
  await writeFile(configPath,(await readFile('../examples/devtools/textui.dev.tsx','utf8')).replace("'examples/devtools/app.tsx'",JSON.stringify(appPath)));
  const server=await startDevtools({port:0,projectRoot:resolve('..'),config:configPath});
  try{
    await page.goto(server.url);
    await expect(page.locator('#status')).toHaveText('Saved');
    const config=await (await fetch(server.url+'/api/config')).json();
    expect(config.screens.map((screen:{id:string})=>screen.id)).toContain('settings/nested');
    expect(config.screens.some((screen:{id:string})=>screen.id==='manual only')).toBe(false);
    expect(config.screens.some((screen:{id:string})=>screen.id==='build')).toBe(false);
    await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
    await page.locator('#preview [data-control="name"]').fill('Home draft');
    await page.locator('#screen').selectOption('settings/nested');
    await expect(page.locator('#preview [data-control="name"]')).toHaveValue('June');
    await page.locator('#preview [data-control="name"]').fill('Settings draft');
    await page.locator('#screen').selectOption('home');
    await expect(page.locator('#preview [data-control="name"]')).toHaveValue('Home draft');
    await page.locator('#save').click();await expect(page.locator('#status')).toHaveText('Saved');
    await page.locator('#preview [data-preview-id="deploy"]').click();await page.locator('#save').click();
    await expect(page.locator('#preview output')).toHaveText('Deploys: 1');
    await page.locator('#preview [data-control="name"]').fill('HMR draft');
    await writeFile(appPath,originalApp.replace('label="Deploys"','label="Hot deploys"'));
    await expect(page.locator('#preview output')).toHaveText('Hot deploys: 1');
    await expect(page.locator('#preview [data-control="name"]')).toHaveValue('HMR draft');
    expect((await(await fetch(server.url+'/api/config')).json()).session.id).toBe(config.session.id);
    await page.locator('#inspect').click();await expect(page.locator('#inspection')).toContainText('application');
    await page.locator('#screen-id').fill('manual only');await page.locator('#open-screen').click();
    await expect(page.locator('#preview')).toContainText('Manual Screen');
    await page.locator('#screen').selectOption('settings/nested');
    await expect(page.locator('#preview [data-control="name"]')).toHaveValue('Settings draft');
    await page.locator('#layout').selectOption('preview');await expect(page.locator('.editor-panel')).toBeHidden();
  }finally{await server.close();}
});

test('replacement Host with same Screen ID does not receive old drafts',async({page})=>{
  await mkdir('.artifacts',{recursive:true});const fixture=await mkdtemp(resolve('.artifacts/session-'));
  const configPath=resolve(fixture,'textui.dev.ts');
  const key=JSON.stringify(fixture);
  const config=(label:string)=>`import {MemoryScreen} from '@mineral/textui';export default {async createSession(){const state=globalThis[${key}]??={active:false};if(state.active)throw new Error('Previous Host still active');state.active=true;const port=new MemoryScreen();await port.setScreen('home','# ${label}',{expectedRevision:null});return {port,label:'${label}',screens:[{id:'home'}],async close(){state.active=false;}};}};`;
  await writeFile(configPath,config('First'));
  const server=await startDevtools({port:0,projectRoot:fixture,config:configPath});
  try{
    await page.goto(server.url);await expect(page.locator('#status')).toHaveText('Saved');
    await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
    await page.locator('.cm-content').fill('# old unsaved draft');
    const before=await (await fetch(server.url+'/api/config')).json();
    await writeFile(configPath,config('Second'));
    await expect(page.locator('#preview')).toContainText('Second');
    const after=await (await fetch(server.url+'/api/config')).json();expect(after.session.id).not.toBe(before.session.id);
    const stored=await (await fetch(server.url+'/api/runtime/screens/home')).json();expect(stored.screen.text).toBe('# Second');
    const stale=await fetch(server.url+'/api/runtime/screens/home',{method:'PUT',headers:{'X-TextUI-Session':before.session.id},body:JSON.stringify({text:'old host edit',expectedRevision:stored.screen.revision})});expect(stale.status).toBe(412);
    const factory=await fetch(server.url+'/@fs/'+configPath.replaceAll('\\','/'));expect(factory.status).toBe(403);
    await expect(page.locator('#drafts textarea')).toHaveValue('# old unsaved draft');
    await writeFile(configPath,config('Broken').replace("return {port,label:","return {port:null,label:"));
    await expect(page.locator('#dev-status')).toContainText('Reload failed');
    expect((await fetch(server.url+'/api/config')).status).toBe(503);
    await writeFile(configPath,config('Recovered'));
    await expect.poll(async()=> (await fetch(server.url+'/api/config')).status).toBe(200);
    await expect(page.locator('#preview')).toContainText('Recovered');
    await expect(page.locator('#drafts textarea')).toHaveValue('# old unsaved draft');
  }finally{await server.close();}
});
