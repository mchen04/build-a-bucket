import { existsSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { createServer as createViteServer, type Plugin, type ViteDevServer } from 'vite';
import { loadLocalEnv } from './lib.ts';

const argv = process.argv.slice(2);

function argValue(name: string): string | null {
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

const root = process.cwd();
const port = Number(argValue('--port') ?? process.env.PORT ?? 5173);
const host = argValue('--host') ?? 'localhost';
const strictPort = argv.includes('--strictPort');

loadLocalEnv(root);

function dynamicChild(dir: string, segment: string): string | null {
  const literal = path.join(dir, segment);
  if (existsSync(literal) && statSync(literal).isDirectory()) return literal;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('[') && entry.name.endsWith(']')) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function resolveApiFile(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 2 || segments[0] !== 'api') return null;
  const rest = segments.slice(1);
  let dir = path.join(root, 'api');
  for (let index = 0; index < rest.length; index++) {
    const segment = rest[index] as string;
    const last = index === rest.length - 1;
    if (last) {
      const file = path.join(dir, `${segment}.ts`);
      if (existsSync(file)) return file;
      const indexFile = path.join(dir, segment, 'index.ts');
      if (existsSync(indexFile)) return indexFile;
      const dynamic = dynamicChild(dir, segment);
      if (!dynamic) return null;
      const dynamicIndex = path.join(dynamic, 'index.ts');
      return existsSync(dynamicIndex) ? dynamicIndex : null;
    }
    const next = dynamicChild(dir, segment);
    if (!next) return null;
    dir = next;
  }
  const indexFile = path.join(dir, 'index.ts');
  return existsSync(indexFile) ? indexFile : null;
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks);
  return new Request(url, { method, headers, body });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function apiMiddleware(vite: ViteDevServer) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (!req.url || !req.url.startsWith('/api/')) return next();
    void (async () => {
      try {
        const request = await toRequest(req);
        const file = resolveApiFile(new URL(request.url).pathname);
        if (!file) {
          await send(res, new Response(JSON.stringify({ error: 'Unknown endpoint', reason: 'not_found' }), { status: 404 }));
          return;
        }
        const module = (await vite.ssrLoadModule(file)) as Record<string, unknown>;
        const handler = module[request.method.toUpperCase()];
        if (typeof handler !== 'function') {
          await send(res, new Response(JSON.stringify({ error: 'Method not allowed', reason: 'invalid' }), { status: 405 }));
          return;
        }
        const response = await (handler as (request: Request) => Promise<Response>)(request);
        await send(res, response);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'dev server error';
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: message, reason: 'server' }));
      }
    })();
  };
}

function apiPlugin(): Plugin {
  return {
    name: 'bab-api',
    configureServer(server) {
      server.middlewares.use(apiMiddleware(server));
    },
  };
}

const vite = await createViteServer({
  root,
  plugins: [apiPlugin()],
  server: { port, host, strictPort },
  appType: 'spa',
});

if (process.env.BAB_DB_RUNNER) {
  const dbModule = (await vite.ssrLoadModule(path.join(root, 'src/server/db.ts'))) as {
    setRunner: (runner: unknown) => void;
  };
  const runnerModule = (await vite.ssrLoadModule(path.resolve(process.env.BAB_DB_RUNNER))) as {
    createRunner: () => Promise<unknown>;
  };
  dbModule.setRunner(await runnerModule.createRunner());
}

await vite.listen();
vite.printUrls();
