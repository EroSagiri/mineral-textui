#!/usr/bin/env node
import { registeredApps } from './registry.ts';
import { helpText, parseArguments } from './cli-options.ts';
import { launchFileApplication } from './launch.ts';
import type { RunningFileApplication } from './launch.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if ((args.length === 1 || (args.length === 2 && registeredApps.some(app => app.id === args[0])))
      && ['--help', '-h'].includes(args.at(-1)!)) {
    console.log(helpText(registeredApps));
    return;
  }
  const requests = parseArguments(args, registeredApps);
  const running: RunningFileApplication[] = [];
  const close = async () => {
    await Promise.all(running.map(app => app.close()));
  };
  try {
    for (const { registration, filePath } of requests) {
      const app = await launchFileApplication(registration.application, filePath, error => {
        console.error(`${registration.id}：${error.message}`);
      });
      running.push(app);
      console.log(`正在监听：${app.filePath}`);
    }
  } catch (error) {
    await close();
    throw error;
  }
  console.log('修改控件并保存；操作完成后自动复位，普通字段保持状态。Ctrl+C 退出。');
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    close().then(() => console.log('CLI 已退出，应用已停止。')).catch(fail);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function fail(error: unknown): void {
  console.error(`运行失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

main().catch(fail);
