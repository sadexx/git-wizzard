import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Test-only: a local HTTP server standing in for a model provider's API.

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: unknown;
}

export interface FakeReply {
  readonly status?: number;
  readonly body?: unknown;
}

export interface FakeServer {
  readonly url: string;
  readonly requests: FakeRequest[];
  close(): Promise<void>;
}

/** Answer every request with `handle`'s JSON. Errors say "don't retry", so SDKs fail fast. */
export async function fakeHttp(handle: (request: FakeRequest) => FakeReply): Promise<FakeServer> {
  const requests: FakeRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      const request = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body: raw === '' ? undefined : JSON.parse(raw) };
      requests.push(request);
      const reply = handle(request);
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', 'x-should-retry': 'false' });
      res.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((resolve: () => void) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve: () => void) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** An OpenAI-compatible API: lists `models`, and answers each chat with `reply(system prompt)`. */
export function openAiCompatible(models: readonly string[], reply: (system: string) => string): (request: FakeRequest) => FakeReply {
  return (request: FakeRequest) => {
    if (request.method === 'GET' && request.path.endsWith('/models')) {
      return { body: { object: 'list', data: models.map((id: string) => ({ id, object: 'model', created: 0, owned_by: 'test' })) } };
    }
    const { model, messages } = request.body as { model: string; messages: Array<{ role: string; content: string }> };
    const system = messages.find((message: { role: string }) => message.role === 'system')?.content ?? '';
    return {
      body: {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 0,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply(system) }, finish_reason: 'stop' }],
      },
    };
  };
}
