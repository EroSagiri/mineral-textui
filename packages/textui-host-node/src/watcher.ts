import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {dirname,resolve} from 'node:path';

/** Parent watching survives both editor and Host atomic replacements. */
export async function watchFile(file:string, refresh:()=>void, onError:(error:unknown)=>void):Promise<FSWatcher> {
  const target=resolve(file), directory=dirname(target);
  const watcher=watch(directory,{
    depth:0, ignoreInitial:true, atomic:30,
    ignored:path=>resolve(path)!==directory && resolve(path)!==target,
    awaitWriteFinish:{stabilityThreshold:20,pollInterval:5},
  });
  watcher.on('add',refresh).on('change',refresh).on('unlink',refresh).on('error',onError);
  try {
    await new Promise<void>((done,fail)=>{watcher.once('ready',done);watcher.once('error',fail);});
    refresh(); return watcher;
  } catch(error) {await watcher.close();throw error;}
}
