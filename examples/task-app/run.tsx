import {resolve} from 'node:path';
import {createNodeHost} from '@mineral/textui-host-node';
import {createTaskApp} from './app.js';

const host = createNodeHost(resolve('screens/task-app'));
const app = await createTaskApp(host, {onEvent:event => console.log(event), onError:console.error});
await app.idle();
console.log('任务应用已启动：screens/task-app/app.md。将导航 Action 的 [ ] 改为 [x] 并保存，在同一文件中切换页面。Ctrl+C 退出。');
const close = async () => {await app.close(); await host.close();};
process.once('SIGINT', () => {void close().then(() => process.exit(0));});
process.once('SIGTERM', () => {void close().then(() => process.exit(0));});
