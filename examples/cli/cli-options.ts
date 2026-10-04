import { extname, resolve } from 'node:path';
import type { AppRegistration } from './registry.ts';

export interface LaunchRequest {
  registration: AppRegistration;
  filePath: string;
}

export function helpText(registry: readonly AppRegistration[]): string {
  return [
    `用法：pnpm text-app [${registry.map(app => app.id).join('|')}] [文件.md]`,
    '不带参数时运行所有已注册应用。已有文件加载持久状态。',
    ...registry.map(app => `  ${app.id}：${app.application.name}，默认 screens/${app.id}.md`),
    '文件必须使用 .md 后缀。Ctrl+C 退出。',
  ].join('\n');
}

export function parseArguments(args: readonly string[], registry: readonly AppRegistration[]): LaunchRequest[] {
  const ids = new Set<string>();
  for (const app of registry) {
    if (!/^[a-z][a-z0-9-]*$/.test(app.id) || ids.has(app.id)) throw new Error(`应用注册 ID 无效或重复：${app.id}`);
    ids.add(app.id);
  }
  if (args.length > 2) throw new Error('参数过多；使用 --help 查看用法。');
  const selected = args.length ? registry.filter(app => app.id === args[0]) : registry;
  if (!selected.length) throw new Error(args.length ? `未知应用：${args[0]}。使用 --help 查看已注册应用。` : '没有已注册应用。');
  return selected.map(registration => {
    const file = args[1] ?? `screens/${registration.id}.md`;
    if (extname(file) !== '.md') throw new Error('界面文件必须使用 .md 后缀。');
    return { registration, filePath: resolve(file) };
  });
}
