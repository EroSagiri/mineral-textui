import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { counter } from '../../examples/counter/app.ts';
import { registeredApps } from '../../examples/cli/registry.ts';
import { helpText, parseArguments } from '../../examples/cli/cli-options.ts';
import { launchFileApplication } from '../../examples/cli/launch.ts';

test('新增注册应用自动参与默认启动、应用选择和帮助信息', async () => {
  const extra = { id: 'extra', application: counter };
  const registry = [...registeredApps, extra];
  const all = parseArguments([], registry);
  assert.deepEqual(all.map(request => request.registration.id), ['counter', 'form', 'extra']);
  assert.ok(all.every(request => request.filePath.endsWith(`${request.registration.id}.md`)));
  assert.match(helpText(registry), /extra/);
  const dir = mkdtempSync(join(tmpdir(), 'textui-registration-'));
  try {
    const [request] = parseArguments(['extra', join(dir, 'custom.md')], registry);
    const errors: Error[] = [];
    const app = await launchFileApplication(request.registration.application, request.filePath, error => errors.push(error));
    try {
      assert.match(readFileSync(request.filePath, 'utf8'), /Count: 0/);
      assert.deepEqual(errors, []);
    } finally { await app.close(); await app.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI 拒绝旧启动应用、未注册名称、非 Markdown 路径和多余参数', async () => {
  assert.throws(() => parseArguments(['start'], registeredApps), /未知应用/);
  assert.throws(() => parseArguments(['missing'], registeredApps), /未知应用/);
  assert.throws(() => parseArguments(['counter', 'counter.txt'], registeredApps), /\.md 后缀/);
  assert.throws(() => parseArguments(['counter', 'a.md', 'extra'], registeredApps), /参数过多/);
  const run = promisify(execFile);
  const path = fileURLToPath(new URL('../../examples/cli/cli.ts', import.meta.url));
  await assert.rejects(run(process.execPath, ['--import','tsx',path, 'start'], { timeout: 4000 }), error => {
    const failure = error as Error & { code: number; stderr: string };
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /未知应用：start/);
    return true;
  });
  const { stdout } = await run(process.execPath, [path, '--help'], { timeout: 4000 });
  assert.match(stdout, /counter\.md/);
  assert.match(stdout, /form\.md/);
  const { stdout: counterHelp } = await run(process.execPath, [path, 'counter', '--help'], { timeout: 4000 });
  assert.match(counterHelp, /pnpm text-app/);
});
