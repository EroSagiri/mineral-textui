import { basename, dirname, extname, resolve } from 'node:path';
import { createNodeHost } from '@mineral/textui-host-node';
import { render } from '@mineral/textui-react';
import { UserForm } from './app.tsx';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('用法：pnpm user-form [文件.md]\n默认文件：screens/user.md\n编辑生成的 Markdown 并保存；Ctrl+C 退出。');
    return;
  }
  if (args.length > 1) throw new Error('参数过多；使用 pnpm user-form --help 查看用法。');

  const file = resolve(args[0] ?? 'screens/user.md');
  if (extname(file) !== '.md') throw new Error('界面文件必须使用 .md 后缀。');

  const report = (error: unknown) => {
    console.error(`User 表单：${error instanceof Error ? error.message : String(error)}`);
  };
  const host = createNodeHost(dirname(file), { onError: report });
  let root;
  try {
    root = await render(<UserForm />, { host, screen: basename(file, '.md'), onError: report });
  } catch (error) {
    await host.close();
    throw error;
  }

  console.log(`正在监听：${file}`);
  console.log('修改 Name、Enable sound 或 Light/Dark 并保存；勾选任一 Submit 并保存后查看结果。');
  console.log('两个 Submit 独立计数，执行后自动取消勾选。Ctrl+C 保存并退出。');

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void (async () => {
      try {
        await root.unmount();
      } finally {
        await host.close();
      }
      console.log('User 表单已停止。');
    })().catch(error => {
      report(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => {
  console.error(`启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
