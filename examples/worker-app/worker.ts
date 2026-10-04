import {DurableObject} from 'cloudflare:workers';
import {ScreenConflictError, ProtocolError, parseTextUI, semanticDiff} from '@mineral/textui';
import type {ScreenChange, UIEvent} from '@mineral/textui';
import {createTaskApp,taskScreenId,taskBlockTypes} from '../task-app/app.js';
import {DurableScreenPort} from './screen-port.js';

export class TaskApplication extends DurableObject<Env> {
  private port: DurableScreenPort;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly instance = crypto.randomUUID();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.port = new DurableScreenPort(ctx.storage, change => this.publish(change));
  }
  private publish(change: ScreenChange) {
    // The runtime retains sockets and their attachments when this object is evicted.
    for (const socket of this.ctx.getWebSockets(change.after.id)) {
      try {socket.send(JSON.stringify({type:'change', screen:change.after.id, revision:change.after.revision}));}
      catch {socket.close(1011, '订阅发送失败');}
    }
  }
  override fetch(request: Request): Promise<Response> {
    const result = this.tail.then(() => this.handle(request));
    // Retaining an upgrade Response also retains the client WebSocket, preventing eviction.
    this.tail = result.then(() => {}, () => {});
    return result;
  }
  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/apps\/[^/]+\/screen(\/subscribe)?$/.exec(url.pathname);
    if (!match) return new Response('Not found', {status:404});
    const id = taskScreenId;
    if (match[1]) {
      if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', {status:426});
    } else if (request.method !== 'GET' && request.method !== 'PUT') return new Response('Method not allowed', {status:405});
    const events: {screen:string; event:UIEvent}[] = [];
    const app = await createTaskApp(this.port, {onEvent:event => events.push({screen:id, event})});
    try {
      await app.idle();
      if (match[1]) {
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [id]);
        pair[1].serializeAttachment({screen:id});
        return new Response(null, {status:101, webSocket:pair[0]});
      }
      if (request.method === 'PUT') {
        const body: unknown = await request.json();
        if (!body || typeof body !== 'object' || !('text' in body) || typeof body.text !== 'string' || !('expectedRevision' in body) || typeof body.expectedRevision !== 'string') return Response.json({error:'text and expectedRevision are required'}, {status:400});
        const before = (await this.port.getScreen(id))!;
        if(body.expectedRevision!==before.revision)throw new ScreenConflictError(id,body.expectedRevision,before.revision);
        // Validate the complete control schema before persisting an editor's text.
        const parsed = parseTextUI(body.text), original = parseTextUI(before.text);
        semanticDiff(original, parsed,{},taskBlockTypes());
        if (parsed.controls.size !== original.controls.size || [...original.controls].some(([key, control]) => {const next = parsed.controls.get(key); return !next || next.type !== control.type || next.group !== control.group;})) return Response.json({error:'Control schema changed'}, {status:400});
        if(parsed.blocks.size!==original.blocks.size || [...original.blocks].some(([key,block])=>{const next=parsed.blocks.get(key);return !next || next.type!==block.type || next.lang!==block.lang;}))return Response.json({error:'Block schema changed'},{status:400});
        await this.port.setScreen(id, body.text, {expectedRevision:body.expectedRevision, origin:'http'});
        await app.idle();
      }
      return Response.json({screen:await this.port.getScreen(id), events, instance:this.instance});
    } catch (error) {
      if (error instanceof ScreenConflictError) return Response.json({error:error.name, actualRevision:error.actualRevision}, {status:409});
      if (error instanceof SyntaxError || error instanceof ProtocolError) return Response.json({error:error.message}, {status:400});
      throw error;
    } finally {await app.close();}
  }
  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === 'snapshot') {
      const {screen} = socket.deserializeAttachment() as {screen:string};
      return this.tail.then(async () => {socket.send(JSON.stringify({type:'snapshot', screen:await this.port.getScreen(screen), instance:this.instance}));});
    }
    socket.send(JSON.stringify({error:'Send snapshot to reread current text'}));
  }
  override webSocketClose(socket: WebSocket, code: number, reason: string) {socket.close(code===1005 || code===1006?1000:code, reason);}
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const match = /^\/apps\/([a-zA-Z0-9_-]{1,64})\//.exec(new URL(request.url).pathname);
    if (!match) return new Response('Use /apps/demo/screen', {status:404});
    // Application identity is a Host concern; this demonstration has no login/session layer.
    return env.TASK_APPS.getByName(match[1]).fetch(request);
  },
} satisfies ExportedHandler<Env>;
