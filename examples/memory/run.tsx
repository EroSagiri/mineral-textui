import { MemoryScreen, parseTextUI, patchValues, ScreenConflictError } from '@mineral/textui';
import { render } from '@mineral/textui-react';
import { UserForm } from '../user-form/app.tsx';

// The same React component uses a memory host: no file or watcher is involved.
const host = new MemoryScreen();
const errors: Error[] = [];
const root = await render(<UserForm />, {
  host,
  screen: 'user',
  onError: error => errors.push(error),
});

try {
  const initial = (await host.getScreen('user'))!;
  console.log('① React 生成初始 Screen：\n');
  console.log(initial.text);

  // Simulate an editor saving a whole batch, using the revision it actually read.
  const document = parseTextUI(initial.text);
  const idOf = (label: string) => {
    const control = [...document.controls.values()].find(control => control.label === label);
    if (!control) throw new Error(`示例缺少控件：${label}`);
    return control.id;
  };
  const updates = new Map<string, string | boolean>([
    [idOf('Name'), 'Alex'],
    [idOf('Enable sound'), false],
    [idOf('Light'), true],
    ['submit-main', true],
    ['submit-preview', true],
  ]);
  await host.setScreen('user', patchValues(document, updates), {
    expectedRevision: initial.revision,
    origin: 'example-editor',
  });
  await root.idle();
  if (errors.length) throw errors[0];

  console.log('② 保存后：字段同步、两个 Submit 各执行一次，并自动复位：\n');
  console.log((await host.getScreen('user'))!.text);
  if (root.store.read('name') !== 'Alex'
      || root.store.read('sound') !== false
      || root.store.read('theme') !== 'light'
      || root.store.read('main-count') !== 1
      || root.store.read('preview-count') !== 1) {
    throw new Error('内存示例的双向状态同步未完成。');
  }

  // Demonstrate an application-side update flowing back into the same Screen.
  root.store.set('name', 'React update');
  await root.flush();
  if (errors.length) throw errors[0];
  console.log('③ 应用更新 Name：');
  console.log((await host.getScreen('user'))!.text.split('\n').find(line => line.includes('Name:')));

  try {
    await host.setScreen('user', initial.text, { expectedRevision: initial.revision });
    throw new Error('过期写入没有被拒绝。');
  } catch (error) {
    if (!(error instanceof ScreenConflictError)) throw error;
    console.log('④ 旧版本写入被 ScreenConflictError 拒绝。');
  }
} finally {
  await root.unmount();
}
