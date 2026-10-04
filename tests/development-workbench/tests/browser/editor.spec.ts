import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const directory=process.env.TEXTUI_DEVTOOLS_TEST_DIRECTORY??resolve('../.artifacts/devtools-browser');
async function saved(page:Page){await expect(page.locator('#status')).toHaveText('Saved');}
async function open(page:Page,id='user'){await page.goto(`/?screen=${id}`);await saved(page);}
async function documentText(page:Page){return page.evaluate(async()=>{
  // Read the actual CodeMirror document, rather than the decorated visible DOM.
  const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');
  return EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!.state.doc.toString();
});}
async function edit(page:Page,before:string,after:string){
  await page.evaluate(async({before,after})=>{
    const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');
    const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
    const text=view.state.doc.toString(),from=text.indexOf(before);
    if(from<0)throw new Error(`Missing text: ${before}`);
    view.dispatch({changes:{from,to:from+before.length,insert:after},userEvent:'input.type'});
  },{before,after});
}
async function append(page:Page,text:string){await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(text);}
test('default launch opens the single Screen task application',async({page})=>{
  await page.goto('/');await saved(page);
  await expect(page.locator('#screen')).toHaveValue('task-app');await expect(page.locator('.cm-content')).toBeFocused();
  expect(await documentText(page)).toContain('type=task-state');
  await expect(page.locator('#screen option')).toHaveCount(5);
});
test('opens directly in focused editor and autosaves real keyboard input',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);await expect(page.locator('.cm-content')).toBeFocused();
  const note=`\nBrowser edit ${Date.now()}\n`;await append(page,note);await saved(page);
  await expect.poll(()=>readFile(resolve(directory,'user.md'),'utf8')).toContain(note.trim());expect(errors).toEqual([]);
});
test('merges external file writes while preserving local input and selection',async({page})=>{
  await open(page);await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
  const original=await documentText(page),note=`LOCAL-${Date.now()}`;await append(page,`\n${note}\n`);
  const oldName=/Name: \[[^\]]*\]/.exec(original)![0];
  await writeFile(resolve(directory,'user.md'),original.replace(oldName,'Name: [Remote]'),'utf8');
  await expect.poll(()=>documentText(page)).toContain('Name: [Remote]');expect(await documentText(page)).toContain(note);
  await expect(page.locator('#status')).toHaveText('Modified');await page.locator('#save').click();await saved(page);
});
test('same-region conflict keeps input, blocks screen switch and supports manual merge',async({page})=>{
  await open(page);await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
  const original=await documentText(page),name=/Name: \[([^\]]*)\]/.exec(original)![1];
  await edit(page,`Name: [${name}]`,'Name: [AAA]');
  await writeFile(resolve(directory,'user.md'),original.replace(`Name: [${name}]`,'Name: [ZZZ]'),'utf8');
  await expect(page.locator('#status')).toHaveText('Conflict');expect(await documentText(page)).toContain('Name: [AAA]');
  await page.locator('#screen').selectOption('task-app');await expect(page.locator('#screen')).toHaveValue('user');
  await page.locator('#manual').fill(original.replace(`Name: [${name}]`,'Name: [Resolved]'));await page.locator('#use-manual').click();await page.locator('#save').click();await saved(page);
  expect(await readFile(resolve(directory,'user.md'),'utf8')).toContain('Resolved');
});
test('multiple remote patches map cursor and retain local undo/redo',async({page})=>{
  const token=`UNDO-${Date.now()}`;
  await open(page);await append(page,`\n${token}\n`);await saved(page);
  const original=await documentText(page);
  await page.evaluate(async()=>{const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;view.dispatch({selection:{anchor:view.state.doc.toString().indexOf('## 主表单')}});view.focus();});
  const updated=original.replace(/^# .+$/m,'# User remote title').replace('修改字段并保存','外部修改字段并保存');
  await writeFile(resolve(directory,'user.md'),updated,'utf8');await expect.poll(()=>documentText(page)).toBe(updated);
  await page.evaluate(async()=>{const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;if(view.state.selection.main.head!==view.state.doc.toString().indexOf('## 主表单'))throw new Error('Cursor mapping failed');});
  await page.keyboard.press('Control+z');await expect.poll(()=>documentText(page)).not.toContain(token);expect(await documentText(page)).toContain('remote title');
  await page.keyboard.press('Control+y');await expect.poll(()=>documentText(page)).toContain(token);await saved(page);
});
test('IME defers remote patches until composition ends',async({page})=>{
  await open(page);const original=await documentText(page);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');
  await page.locator('.cm-content').dispatchEvent('compositionstart');
  // insertText starts a new browser input and can end synthetic composition.
  // Dispatch the composed transaction while keeping the explicit IME lifecycle active.
  await page.evaluate(async()=>{const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;view.dispatch({changes:{from:view.state.doc.length,insert:'\n中文组合输入\n'},userEvent:'input.type.compose'});});
  await writeFile(resolve(directory,'user.md'),original.replace(/^# .+$/m,'# User IME'),'utf8');
  await expect.poll(()=>page.locator('[data-metric="组合输入"]').textContent()).toBe('输入中');
  expect(await documentText(page)).not.toContain('# User IME');
  await page.locator('.cm-content').dispatchEvent('compositionend');
  await expect.poll(()=>documentText(page)).toContain('# User IME');expect(await documentText(page)).toContain('中文组合输入');await saved(page);
});
test('10-second temporary animation projects frames without frame writes; user can edit',async({page})=>{
  await open(page,'build');await page.locator('[data-action="reset"]').click();await saved(page);
  await page.locator('[data-action="start"]').click();await expect(page.locator('.animation-frame')).toBeVisible();
  const baseline=await readFile(resolve(directory,'stream/build.md'),'utf8');
  const before=(await (await page.request.get('/api/metrics')).json()).build;
  const samples:string[]=[];for(let i=0;i<10;i++){samples.push(await readFile(resolve(directory,'stream/build.md'),'utf8'));await page.waitForTimeout(250);}
  expect(samples.every(sample=>sample===baseline)).toBe(true);
  const during=(await (await page.request.get('/api/metrics')).json()).build;expect(during.writes).toBe(before.writes);expect(during.frames).toBeGreaterThan(before.frames);
  const note=`During animation ${Date.now()}`,oldNote=/Note: \[([^\]]*)\]/.exec(await documentText(page))![1];await edit(page,oldNote,note);await saved(page);
  expect(await documentText(page)).toContain(note);expect(await documentText(page)).not.toContain('◐');
  await expect.poll(()=>page.locator('[data-metric="帧接收数"]').textContent(),{timeout:15000}).not.toBe('0');
  await expect.poll(()=>readFile(resolve(directory,'stream/build.md'),'utf8'),{timeout:15000}).toContain('"status":"completed"');
  await expect(page.locator('.animation-frame')).toHaveCount(0);
  const after=(await (await page.request.get('/api/metrics')).json()).build;
  const metrics={mode:'temporary',received:Number(await page.locator('[data-metric="帧接收数"]').textContent()),dropped:Number(await page.locator('[data-metric="帧丢弃数"]').textContent()),saves:Number(await page.locator('[data-metric="保存次数"]').textContent()),stableSamples:samples.length,writesDuringFrameOnlyWindow:during.writes-before.writes,writesAfterStart:after.writes-before.writes};
  await mkdir(resolve('../.artifacts'),{recursive:true});await writeFile(resolve('../.artifacts/devtools-frame-metrics.json'),JSON.stringify(metrics,null,2));
});
test('persistent animation incrementally updates once a second',async({page})=>{
  await open(page,'low-build');await page.locator('[data-action="reset"]').click();await saved(page);
  await page.locator('[data-action="start"]').click();await saved(page);
  await expect.poll(()=>documentText(page),{timeout:6000}).toMatch(/Progress: [1-9][0-9]?%/);
  await expect(page.locator('.animation-frame')).toHaveCount(0);
  const before=(await (await page.request.get('/api/metrics')).json())['low-build'];
  const token=`Low frequency ${Date.now()}`,oldNote=/Note: \[([^\]]*)\]/.exec(await documentText(page))![1];await edit(page,oldNote,token);await saved(page);
  await expect.poll(()=>readFile(resolve(directory,'persistent/build.md'),'utf8'),{timeout:15000}).toContain('"status":"completed"');
  expect(await documentText(page)).toContain(token);
  const after=(await (await page.request.get('/api/metrics')).json())['low-build'];
  await writeFile(resolve('../.artifacts/devtools-persistent-metrics.json'),JSON.stringify({mode:'persistent',writesAfterFirstTick:after.writes-before.writes,patches:Number(await page.locator('[data-metric="补丁数量"]').textContent()),frames:Number(await page.locator('[data-metric="帧接收数"]').textContent())},null,2));
});
test('a new screen has isolated undo history',async({page})=>{
  await open(page);await append(page,'\nISOLATED-UNDO\n');await saved(page);await page.locator('#screen').selectOption('task-app');await saved(page);
  const tasks=await documentText(page);await page.locator('.cm-content').click();await page.keyboard.press('Control+z');expect(await documentText(page)).toBe(tasks);expect(tasks).not.toContain('ISOLATED-UNDO');
});
test('Worker task saves via HTTP and rereads current snapshot after WebSocket reconnect',async({page})=>{
  await page.addInitScript(()=>{
    const Native=window.WebSocket;
    const sockets:WebSocket[]=[];
    Object.assign(window,{__testSockets:sockets});
    window.WebSocket=class extends Native {constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);sockets.push(this);}};
  });
  await page.goto('/?host=worker-task&screen=task-app');await saved(page);
  const original=await documentText(page),oldName=/称呼: \[([^\]]*)\]/.exec(original)![1];
  await edit(page,`称呼: [${oldName}]`,'称呼: [Browser Worker]');await saved(page);
  const endpoint='/api/worker-task/screens/task-app';let remote=(await (await page.request.get(endpoint)).json()).screen;expect(remote.text).toContain('Browser Worker');
  await page.evaluate(()=>{for(const socket of (window as unknown as {__testSockets:WebSocket[]}).__testSockets)if(socket.url.includes('/api/worker-task/'))socket.close();});
  await expect(page.locator('#connection')).toHaveText('○ 未连接');
  const response=await page.request.put(endpoint,{data:{text:remote.text.replace('Browser Worker','After reconnect'),expectedRevision:remote.revision}});expect(response.ok()).toBe(true);
  await expect(page.locator('#connection')).toHaveText('● 已连接');await expect.poll(()=>documentText(page)).toContain('After reconnect');await saved(page);
});
test('Worker frames project while concurrent input persists, reset clears projection',async({page})=>{
  await page.goto('/?host=worker-animation&screen=build');await saved(page);
  await page.locator('[data-action="reset"]').click();await saved(page);await page.locator('[data-action="start"]').click();await expect(page.locator('.animation-frame')).toBeVisible();
  const note=/Note: \[([^\]]*)\]/.exec(await documentText(page))![1],token=`Worker note ${Date.now()}`;await edit(page,note,token);await saved(page);
  expect(await documentText(page)).not.toContain('◐');expect((await (await page.request.get('/api/worker-animation/screens/build')).json()).screen.text).toContain(token);
  await page.locator('[data-action="reset"]').click();await saved(page);await expect(page.locator('.animation-frame')).toHaveCount(0);
});
test('remote changes preserve multiline selection and scroll; deleting selected content maps safely',async({page})=>{
  await open(page);const token=`Selection-${Date.now()}`;
  await append(page,`\n${Array.from({length:160},(_,i)=>`${token} row ${i}`).join('\n')}\n`);await saved(page);
  const original=await documentText(page);
  const before=await page.evaluate(async token=>{
    const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
    const text=view.state.doc.toString(),anchor=text.indexOf(`${token} row 80`),head=text.indexOf(`${token} row 83`);
    view.dispatch({selection:{anchor,head},effects:EditorView.scrollIntoView(anchor,{y:'center'})});view.focus();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {selected:view.state.sliceDoc(anchor,head),scroll:view.scrollDOM.scrollTop};
  },token);
  const updated=original.replace(/^# .+$/m,'# Selection remote header')+`\nExternal tail ${Date.now()}\n`;
  await writeFile(resolve(directory,'user.md'),updated,'utf8');await expect.poll(()=>documentText(page)).toBe(updated);
  const after=await page.evaluate(async()=>{const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;return {selected:view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to),scroll:view.scrollDOM.scrollTop,focused:view.hasFocus};});
  expect(after.selected).toBe(before.selected);expect(Math.abs(after.scroll-before.scroll)).toBeLessThan(60);expect(after.focused).toBe(true);
  await writeFile(resolve(directory,'user.md'),updated.replace(before.selected,''),'utf8');await expect.poll(()=>documentText(page)).not.toContain(before.selected);
  await page.evaluate(async()=>{const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;if(view.state.selection.main.head>view.state.doc.length)throw new Error('Deleted cursor outside document');});
});
test('Textarea remains editable in a second screen while an animation is running',async({page,context})=>{
  await open(page,'build');await page.locator('[data-action="reset"]').click();await saved(page);await page.locator('[data-action="start"]').click();await expect(page.locator('.animation-frame')).toBeVisible();
  const second=await context.newPage();await open(second,'advanced-form');
  const current=await documentText(second),body=/```text[^\n]*type=textarea[^\n]*\n([\s\S]*?)\n```/.exec(current);
  expect(body).not.toBeNull();const token=`长文本-${Date.now()}\n第二行描述`;await edit(second,body![1],token);await saved(second);
  expect(await readFile(resolve(directory,'advanced-form.md'),'utf8')).toContain(token);await expect(page.locator('.animation-frame')).toBeVisible();
  await page.locator('[data-action="reset"]').click();await saved(page);await second.close();
});
test('plain text Action routes within the same Screen and persists pending fields',async({page})=>{
  await open(page,'task-app');await page.locator('[data-action="nav-home"]').click();await saved(page);
  await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
  const name=/称呼: \[([^\]]*)\]/.exec(await documentText(page))![1],token=`导航测试${Date.now()}`;
  await edit(page,`称呼: [${name}]`,`称呼: [${token}]`);
  await edit(page,'- [ ] 任务列表','- [x] 任务列表');
  expect(await documentText(page)).toContain('称呼:');
  await page.locator('#save').click();await saved(page);
  await expect.poll(()=>documentText(page)).toContain('完成原型');
  await expect(page.locator('#screen')).toHaveValue('task-app');await expect(page).toHaveURL(/screen=task-app/);
  expect(await readFile(resolve(directory,'app.md'),'utf8')).toContain(token);
  await page.locator('[data-action="nav-home"]').click();await page.locator('#save').click();await saved(page);
  await expect.poll(()=>documentText(page)).toContain(`称呼: [${token}]`);
});

test('Action toolbar only edits text; application navigates after saving',async({page})=>{
  await open(page,'task-app');await page.locator('[data-action="nav-home"]').click();await saved(page);
  await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
  await page.locator('[data-action="nav-settings"]').click();
  expect(await documentText(page)).toContain('- [x] 设置');expect(await documentText(page)).toContain('称呼:');
  await expect(page.locator('#screen')).toHaveValue('task-app');
  await page.locator('#save').click();await saved(page);
  await expect.poll(()=>documentText(page)).toContain('启用通知');
  await page.reload();await saved(page);expect(await documentText(page)).toContain('启用通知');
});

test('clicking original Action marker changes text and keeps Screen identity',async({page})=>{
  await open(page,'task-app');await page.locator('[data-action="nav-home"]').click();await saved(page);
  const point=await page.evaluate(async()=>{const modulePath='/node_modules/@codemirror/view/dist/index.js';const {EditorView}=await import(modulePath) as typeof import('@codemirror/view');const view=EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;const coords=view.coordsAtPos(view.state.doc.toString().indexOf('- [ ] 任务列表')+3)!;return {x:coords.left+1,y:(coords.top+coords.bottom)/2};});
  await page.mouse.click(point.x,point.y);await saved(page);
  await expect.poll(()=>documentText(page)).toContain('完成原型');await expect(page.locator('#screen')).toHaveValue('task-app');
});

test('conflict disables Action enhancement and preserves local text',async({page})=>{
  await open(page,'task-app');await page.locator('[data-action="nav-home"]').click();await saved(page);
  await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
  const original=await documentText(page),name=/称呼: \[[^\]]*\]/.exec(original)![0];
  await edit(page,name,'称呼: [Local conflict]');
  await writeFile(resolve(directory,'app.md'),original.replace(name,'称呼: [Remote conflict]'),'utf8');
  await expect(page.locator('#status')).toHaveText('Conflict');
  await expect(page.locator('[data-action="nav-tasks"]')).toBeDisabled();
  expect(await documentText(page)).toContain('称呼: [Local conflict]');await expect(page.locator('#screen')).toHaveValue('task-app');
  await page.locator('#use-remote').click();await saved(page);
});

test('Preview input patches local buffer; Runtime stays confirmed until save',async({page})=>{
  await open(page);await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
  const input=page.locator('#preview').getByRole('textbox',{name:'Name',exact:true});
  await input.fill('Preview buffer');
  expect(await documentText(page)).toContain('Name: [Preview buffer]');await expect(page.locator('#status')).toHaveText('Modified');
  await expect(input).toHaveValue('Preview buffer');
  await page.locator('#preview-mode').selectOption('runtime');await expect(input).toBeDisabled();await expect(input).not.toHaveValue('Preview buffer');
  await page.locator('#save').click();await saved(page);await expect(input).toHaveValue('Preview buffer');
  await page.locator('#preview-mode').selectOption('preview');await expect(input).toBeEnabled();
});

test('Preview Action only edits text, then Runtime handles navigation after save',async({page})=>{
  await open(page,'task-app');await page.locator('[data-action="nav-home"]').click();await saved(page);
  await page.locator('#debounce').fill('10000');await page.locator('#debounce').dispatchEvent('change');
  await page.locator('#preview [data-preview-id="nav-settings"]').click();
  expect(await documentText(page)).toContain('- [x] 设置');expect(await documentText(page)).toContain('称呼:');
  await page.locator('#save').click();await saved(page);await expect.poll(()=>documentText(page)).toContain('启用通知');
});

test('Markdown renderer preserves structure and rejects raw HTML execution',async({page})=>{
  await open(page);await append(page,'\n## Preview heading\n\n| Name | State |\n|---|---|\n| A | Online |\n\n> Quote\n\n<script>window.previewPwned=true</script>\n');await saved(page);
  await expect(page.locator('#preview h2').filter({hasText:'Preview heading'}).last()).toBeVisible();
  await expect(page.locator('#preview table').last()).toBeVisible();await expect(page.locator('#preview blockquote').last()).toBeVisible();
  await expect(page.locator('#preview script')).toHaveCount(0);
  expect(await page.evaluate(()=>('previewPwned' in window))).toBe(false);
});

test('Preview textarea safely edits multiline fenced text and keeps focus',async({page})=>{
  await open(page,'advanced-form');const input=page.locator('#preview textarea');
  await expect(input).toHaveCount(1);await input.fill('Preview multiline\n```\n中文');
  await expect(input).toBeFocused();await expect(input).toHaveValue('Preview multiline\n```\n中文');
  await saved(page);expect(await readFile(resolve(directory,'advanced-form.md'),'utf8')).toContain('Preview multiline');
});
