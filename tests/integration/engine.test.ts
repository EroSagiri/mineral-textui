import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {parseTextUI, patchValues, semanticDiff, startApplication} from '@mineral/textui';
import {createNodeHost} from '@mineral/textui-host-node';
import type {NodeHost} from '@mineral/textui-host-node';
import type {RunningApplication} from '@mineral/textui';
const protocol={allowEscapedNewlines:true,allowEmptySelection:true};
const parse=(text:string)=>parseTextUI(text,protocol);
const serialize=(doc:ReturnType<typeof parse>,updates:Record<string,string|boolean>={})=>patchValues(doc,new Map(Object.entries(updates)),protocol);
const deriveEvents=(before:ReturnType<typeof parse>,after:ReturnType<typeof parse>)=>semanticDiff(before,after,protocol);
import type { Application, UIEvent } from '@mineral/textui';
import { counter } from '../../examples/counter/app.ts';
import { form } from '../../examples/text-form/app.ts';

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('等待文件响应超时');
    await delay(10);
  }
}

async function fixture(application: Application, initial = application.initialContent) {
  const dir = mkdtempSync(join(tmpdir(), 'textui-engine-'));
  const path = join(dir, 'screen.md');
  writeFileSync(path, initial);
  const errors: Error[] = [];
  const batches: UIEvent[][] = [];
  let host:NodeHost;
  let app:RunningApplication;
  const open=async()=>{
    host=createNodeHost(dir,{onError:error=>errors.push(error as Error)});
    app=await startApplication({...application,handle(events,document){batches.push([...events]);return application.handle(events,document);}},{host,screen:'screen',onError:error=>errors.push(error)});
  };
  await open();
  return {
    path, dir, errors, batches,
    read: () => readFileSync(path, 'utf8'),
    value: (id: string) => parse(readFileSync(path, 'utf8')).controls.get(id)?.value,
    edit: (updates: Record<string, string | boolean>) => {
      const next = serialize(parse(readFileSync(path, 'utf8')), updates);
      writeFileSync(path, next);
      return next;
    },
    restart: async () => { await app.close(); await host.close(); await open(); },
    close: async () => { await app.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('M2.1 同一核心运行计数器和表单，支持同行多个控件', async () => {
  const inline = 'Count: 12 <!-- textui:id=count type=output -->  [ ] Increment <!-- textui:id=increment type=action --> [ ] Reset <!-- textui:id=reset type=action -->\n';
  const a = await fixture(counter, inline);
  const b = await fixture(form);
  try {
    a.edit({ increment: true });
    b.edit({ name: 'Alice', 'submit-main': true });
    await until(() => a.value('count') === '13' && b.value('main-count') === '1');
    assert.equal(b.value('name'), 'Alice');
    assert.match(String(b.value('result')), /Name=Alice/);
    assert.equal(a.value('increment'), false);
    assert.deepEqual([...a.errors, ...b.errors], []);
  } finally { await a.close(); await b.close(); }
});

test('M2.2 同名 Submit 使用独立 ID，移动行和修改标签不改变身份', async () => {
  const f = await fixture(form);
  try {
    const reordered = f.read().replace('- [ ] Submit <!-- textui:id=submit-preview type=action -->', '')
      + '\n- [ ] 新标签 <!-- textui:id=submit-preview type=action -->\n';
    writeFileSync(f.path, reordered);
    await delay(100);
    f.edit({ 'submit-preview': true });
    await until(() => f.value('preview-count') === '1');
    assert.equal(f.value('main-count'), '0');
    f.edit({ 'submit-main': true });
    await until(() => f.value('main-count') === '1');
    assert.equal(f.value('preview-count'), '1');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('M2.3 单次保存派发多个控件事件，选择归一，提交读取最新字段', async () => {
  const f = await fixture(form);
  try {
    f.edit({ name: 'Ada', sound: false, light: true, 'submit-main': true, 'submit-preview': true });
    await until(() => f.value('main-count') === '1' && f.value('preview-count') === '1');
    assert.deepEqual(f.batches[0].map(event => [event.type, event.target]), [
      ['change', 'name'], ['change', 'sound'], ['select', 'light'], ['trigger', 'submit-main'], ['trigger', 'submit-preview'],
    ]);
    assert.equal(f.value('dark'), false);
    assert.match(String(f.value('result')), /Name=Ada；sound=off；theme=light/);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('M2.4 重复保存确认文件和原请求快照都不重复执行，新的点击可执行', async () => {
  const f = await fixture(counter);
  try {
    const request = f.edit({ increment: true });
    await until(() => f.value('count') === '1');
    for (let i = 0; i < 3; i++) { writeFileSync(f.path, f.read()); await delay(80); }
    assert.equal(f.batches.length, 1);
    writeFileSync(f.path, request);
    await until(() => f.value('increment') === false);
    assert.equal(f.value('count'), '1');
    assert.equal(f.batches.length, 1);
    f.edit({ increment: true });
    await until(() => f.value('count') === '2');
    assert.equal(f.batches.length, 2);
  } finally { await f.close(); }
});

test('M2.5 相同 epoch 的外部修改会处理，自身回写不产生事件回环', async () => {
  const f = await fixture(counter, counter.initialContent + '\n<!-- textui:epoch=77 -->\n');
  try {
    f.edit({ increment: true });
    await until(() => f.value('count') === '1');
    await delay(150);
    assert.equal(f.batches.length, 1);
    assert.match(f.read(), /textui:epoch=78/);
    f.edit({ reset: true });
    await until(() => f.value('count') === '0');
    await delay(150);
    assert.equal(f.batches.length, 2);
  } finally { await f.close(); }
});

test('M2.6 局部替换保留普通文本、未知控件、CRLF 与结尾空白', async () => {
  const note = '## 我的备注\r\n  不受管理的 [x] 文本，保留缩进。  \r\n\r\n';
  const initial = note + counter.initialContent.replace(/\n/g, '\r\n') + '\r\n> Extra: [hello] <!-- textui:id=extra type=input -->\r\n\t \r\n';
  const f = await fixture(counter, initial);
  try {
    const document = parse(initial);
    assert.equal(serialize(document), initial, '无更新逐字往返');
    f.edit({ increment: true, extra: 'a]b\\c\nnext' });
    await until(() => f.value('count') === '1');
    assert.ok(f.read().startsWith(note));
    assert.ok(f.read().includes('\r\n\t \r\n'));
    assert.equal(f.value('extra'), 'a]b\\c\nnext');
    assert.equal(f.read().replace(/\r\n/g, '').includes('\n'), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('M2.7 重启恢复持久状态，启动不重放遗留一次性操作', async () => {
  const f = await fixture(form);
  try {
    f.edit({ name: 'Saved', sound: false, light: true, 'submit-main': true });
    await until(() => f.value('main-count') === '1');
    await f.restart();
    assert.equal(f.value('name'), 'Saved');
    assert.equal(f.value('sound'), false);
    assert.equal(f.value('light'), true);
    assert.equal(f.value('dark'), false);
    assert.equal(f.value('main-count'), '1');
    const pending = serialize(parse(f.read()), { 'submit-main': true });
    // 用新的独立实例证明启动时不执行已有勾选。
    const g = await fixture(form, pending);
    try {
      assert.equal(g.value('submit-main'), false);
      assert.equal(g.value('main-count'), '1');
      assert.equal(g.batches.length, 0);
    } finally { await g.close(); }
  } finally { await f.close(); }
});

test('M2.8 外部普通保存与原子替换后继续处理后续修改', async () => {
  const f = await fixture(counter);
  try {
    const replacement = join(f.dir, 'replacement.md');
    writeFileSync(replacement, serialize(parse(f.read()), { increment: true }));
    renameSync(replacement, f.path);
    await until(() => f.value('count') === '1');
    f.edit({ increment: true });
    await until(() => f.value('count') === '2');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('协议损坏不执行业务，修复后从上次有效基线继续处理', async () => {
  const f = await fixture(counter);
  try {
    const valid = f.read();
    writeFileSync(f.path, valid + '\n- [x] Bad <!-- textui:id=increment type=action -->\n');
    await until(() => f.errors.length === 1);
    assert.equal(f.batches.length, 0);
    writeFileSync(f.path, serialize(parse(valid), { increment: true }));
    await until(() => f.value('count') === '1');
  } finally { await f.close(); }
  assert.throws(() => parse('- [ ] A <!-- textui:id=a type=unknown -->'), /有效 type/);
  const before = parse('( ) A <!-- textui:id=a type=select group=t --> ( ) B <!-- textui:id=b type=select group=t -->');
  const after = parse(serialize(before, { a: true, b: true }));
  assert.throws(() => deriveEvents(before, after), /同时新选多个/);
  const selected = parse(serialize(before, { a: true }));
  assert.deepEqual(deriveEvents(selected, before).filter(event => event.type==='select').map(event => [event.type, event.target, event.after]), [['select', 'a', null]]);
});

test('真实 CLI 默认同时创建并驱动计数器与表单', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'textui-cli-m2-'));
  const cliPath = fileURLToPath(new URL('../../examples/cli/cli.ts', import.meta.url));
  const child = spawn(process.execPath, [cliPath], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await until(() => output.includes('form.md'));
    const counterPath = join(dir, 'screens', 'counter.md');
    const formPath = join(dir, 'screens', 'form.md');
    writeFileSync(counterPath, serialize(parse(readFileSync(counterPath, 'utf8')), { increment: true }));
    writeFileSync(formPath, serialize(parse(readFileSync(formPath, 'utf8')), { name: 'CLI', 'submit-main': true }));
    await until(() => parse(readFileSync(counterPath, 'utf8')).controls.get('count')?.value === '1'
      && parse(readFileSync(formPath, 'utf8')).controls.get('main-count')?.value === '1');
    assert.match(readFileSync(formPath, 'utf8'), /Name=CLI/);
    assert.equal(child.exitCode, null);
    assert.equal(errors, '');
  } finally {
    child.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
