import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { ValidationError } from './errors.js';
import { parseBooleanFlag, readFlagValue, readStringFlag, type FlagEnv, type FlagMap } from './flags.js';

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 8722;
export const MIN_HTTP_TOKEN_LENGTH = 16;
export const MAX_HTTP_BODY_BYTES = 1024 * 1024; // 1 MiB

export type HttpServerConfig = {
  host: string;
  port: number;
  token: string;
};

const parseHttpPort = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ValidationError(
      `Invalid --http-port/MINDWTR_MCP_HTTP_PORT: "${raw}" (must be an integer between 1 and 65535)`
    );
  }
  return parsed;
};

/**
 * Resolves opt-in HTTP transport settings from CLI flags/env. HTTP mode is enabled by
 * `--http`/`MINDWTR_MCP_HTTP`, or implicitly by setting any of --http-host/--http-port/--http-token.
 * Returns undefined when HTTP mode is off (the default), in which case the caller keeps the
 * existing stdio behavior untouched.
 */
export const resolveHttpConfig = (flags: FlagMap, env: FlagEnv = process.env): HttpServerConfig | undefined => {
  const explicitHttp = parseBooleanFlag(readFlagValue(flags, 'http') ?? env.MINDWTR_MCP_HTTP);
  const host = readStringFlag(flags, 'http-host', 'httpHost') ?? env.MINDWTR_MCP_HTTP_HOST;
  const portRaw = readStringFlag(flags, 'http-port', 'httpPort') ?? env.MINDWTR_MCP_HTTP_PORT;
  const token = readStringFlag(flags, 'http-token', 'httpToken') ?? env.MINDWTR_MCP_HTTP_TOKEN;

  const httpEnabled = explicitHttp ?? Boolean(host || portRaw || token);
  if (!httpEnabled) return undefined;

  if (!token || token.length < MIN_HTTP_TOKEN_LENGTH) {
    throw new ValidationError(
      `HTTP mode requires --http-token (or MINDWTR_MCP_HTTP_TOKEN) of at least ${MIN_HTTP_TOKEN_LENGTH} characters. ` +
      'Generate one with: openssl rand -hex 32'
    );
  }

  return {
    host: host || DEFAULT_HTTP_HOST,
    port: parseHttpPort(portRaw) ?? DEFAULT_HTTP_PORT,
    token,
  };
};

/**
 * Timing-safe bearer token check, mirroring the SHA-256-digest + timingSafeEqual pattern used
 * by apps/cloud/src/server-auth.ts (not imported directly to keep workspaces independent).
 */
export const isAuthorizedBearerToken = (
  authorizationHeader: string | undefined | null,
  expectedToken: string,
): boolean => {
  if (!authorizationHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  if (!match) return false;
  const provided = match[1]!.trim();
  if (!provided) return false;
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expectedToken).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
};

type BodyReadResult =
  | { status: 'ok'; body: Buffer }
  | { status: 'too-large' }
  | { status: 'error' };

const readRequestBody = (req: IncomingMessage, maxBytes: number): Promise<BodyReadResult> =>
  new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: BodyReadResult) => {
      if (settled) return;
      settled = true;
      resolveBody(result);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        // Don't req.destroy() here: that tears down the socket immediately and races
        // the 413 response we're about to send, which the client sees as ECONNRESET
        // instead of a clean status code. Just stop buffering and let the remaining
        // bytes drain (ignored by the early-return above) so the connection can be
        // reused for keep-alive once the response is written.
        finish({ status: 'too-large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish({ status: 'ok', body: Buffer.concat(chunks) }));
    req.on('error', () => finish({ status: 'error' }));
  });

const parseJsonBody = (buffer: Buffer): { ok: true; value: unknown } | { ok: false } => {
  if (buffer.length === 0) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(buffer.toString('utf8')) };
  } catch {
    return { ok: false };
  }
};

const sendJson = (res: ServerResponse, status: number, payload: Record<string, unknown>) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

export type HttpMcpDeps = {
  createServer: () => McpServer;
  token: string;
  maxBodyBytes?: number;
  logError?: (message: string, error?: unknown) => void;
};

const handleMcpPost = async (req: IncomingMessage, res: ServerResponse, deps: Required<HttpMcpDeps>) => {
  const authHeader = req.headers.authorization;
  const authHeaderValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!isAuthorizedBearerToken(authHeaderValue, deps.token)) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const bodyResult = await readRequestBody(req, deps.maxBodyBytes);
  if (bodyResult.status === 'too-large') {
    sendJson(res, 413, { error: 'payload_too_large' });
    return;
  }
  if (bodyResult.status === 'error') {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }

  const parsedBody = parseJsonBody(bodyResult.body);
  if (!parsedBody.ok) {
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }

  const mcpServer = deps.createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    void transport.close().catch(() => {});
    void mcpServer.close().catch(() => {});
  };
  res.on('close', cleanup);

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsedBody.value);
  } catch (error) {
    deps.logError('HTTP MCP request failed', error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal_error' });
    }
    cleanup();
  }
};

/** Builds the plain node:http request listener backing the MCP HTTP transport. */
export const createHttpRequestListener = (deps: HttpMcpDeps) => {
  const resolvedDeps: Required<HttpMcpDeps> = {
    createServer: deps.createServer,
    token: deps.token,
    maxBodyBytes: deps.maxBodyBytes ?? MAX_HTTP_BODY_BYTES,
    logError: deps.logError ?? (() => {}),
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET' });
        res.end('method not allowed');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (url.pathname === '/mcp') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      await handleMcpPost(req, res, resolvedDeps);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };
};

/** Creates (but does not start) the node:http server for the stateless MCP HTTP transport. */
export const createMindwtrHttpServer = (deps: HttpMcpDeps): Server => {
  const listener = createHttpRequestListener(deps);
  const logError = deps.logError ?? (() => {});
  return createServer((req, res) => {
    void listener(req, res).catch((error) => {
      logError('Unhandled HTTP MCP error', error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' });
      } else {
        res.end();
      }
    });
  });
};

/** Starts listening and resolves once bound, rejecting on bind errors (e.g. port in use). */
export const startHttpServer = (server: Server, config: HttpServerConfig): Promise<void> =>
  new Promise((resolveListen, reject) => {
    const onError = (error: unknown) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, config.host);
  });
