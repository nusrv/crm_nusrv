import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash } from 'argon2';
import cookieParser from 'cookie-parser';
import { Controller, Post, type ExecutionContext } from '@nestjs/common';
import type { Express, Request, Response } from 'express';
import ts from 'typescript';
import { AuthController } from '../src/identity/auth.controller';
import { AuthService } from '../src/identity/auth.service';
import { JwtAuthGuard } from '../src/identity/jwt-auth.guard';
import { JwtStrategy } from '../src/identity/jwt.strategy';
import { OriginGuard } from '../src/identity/origin.guard';
import { RolesGuard } from '../src/identity/roles.guard';

type DevToolsResult = {
  exceptionDetails?: unknown;
  result?: { value?: unknown };
  cookies?: { name: string; httpOnly: boolean; session: boolean; sameSite: string; domain: string; path: string; secure: boolean; expires: number }[];
  processInfo?: { id: number }[];
};

class BrowserSession {
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: DevToolsResult) => void;
    reject: (reason: Error) => void;
  }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', async ({ data }) => {
      const body = data instanceof Blob ? await data.text() : String(data);
      const message = JSON.parse(body) as {
        id?: number;
        result?: DevToolsResult;
        error?: { message: string };
      };
      const waiting = message.id === undefined ? undefined : this.pending.get(message.id);
      if (message.id === undefined || !waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result ?? {});
    });
    socket.addEventListener('close', () => {
      for (const waiting of this.pending.values()) waiting.reject(new Error('The browser debug session closed.'));
      this.pending.clear();
    });
  }

  send(method: string, params: object = {}): Promise<DevToolsResult> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome did not answer ${method}.`));
      }, method === 'Page.navigate' ? 30_000 : 5_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(deadline); resolve(value); },
        reject: (error) => { clearTimeout(deadline); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }

  close() { this.socket.close(); }
}

const chrome = process.env.P0_TEST_CHROME;
const checkProfilePersistence = process.env.P0_TEST_PROCESS_RESTART === '1';
const useRealUi = process.env.P0_TEST_NEXT_UI === '1';
const browserTest = chrome ? it : it.skip;
const localProcessEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOMEDRIVE|HOMEPATH)$/i.test(key),
));

@Controller('fixture-sensitive')
class SensitiveFixtureController {
  @Post()
  write() { return { accepted: true }; }
}

function debuggerUrl(process: ChildProcess): Promise<URL> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Chrome did not start DevTools: ${stderr}`)), 10_000);
    process.once('error', (error) => { clearTimeout(timeout); reject(error); });
    process.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (${code}): ${stderr}`));
    });
    process.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4000);
      const endpoint = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(stderr)?.[1];
      if (!endpoint) return;
      clearTimeout(timeout);
      resolve(new URL(endpoint));
    });
  });
}

async function connectDebugSession(url: string): Promise<BrowserSession> {
  const socket = new WebSocket(url);
  await once(socket, 'open', { signal: AbortSignal.timeout(5_000) });
  return new BrowserSession(socket);
}

async function connectPage(browser: URL): Promise<BrowserSession> {
  const targets = await (await fetch(`http://${browser.host}/json/list`, { signal: AbortSignal.timeout(5_000) })).json() as
    { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((target) => target.type === 'page');
  assert.ok(page);
  const endpoint = new URL(page.webSocketDebuggerUrl);
  assert.equal(endpoint.protocol, 'ws:');
  assert.equal(endpoint.host, browser.host);
  return connectDebugSession(endpoint.href);
}

function nextOrigin(process: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The loopback Next server did not become ready.')), 45_000);
    let output = '';
    let errorOutput = '';
    process.stderr?.on('data', (chunk) => { errorOutput = (errorOutput + String(chunk)).slice(-1_000); });
    process.once('error', (error) => { clearTimeout(timer); reject(error); });
    process.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The loopback Next server exited with code ${code}. ${errorOutput}`));
    });
    process.stdout?.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-2_000);
      const origin = /P0_NEXT_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
      if (!origin) return;
      clearTimeout(timer);
      resolve(origin);
    });
  });
}

const nextFixture = String.raw`
  const { createServer } = require('node:http');
  const next = require('next');
  (async () => {
    let handle;
    const server = createServer((req, res) => {
      if (handle) return handle(req, res);
      res.writeHead(503).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const app = next({
      dev: true, webpack: true, hostname: '127.0.0.1', port,
      conf: { reactStrictMode: true, transpilePackages: ['@cp/shared'], distDir: process.env.P0_NEXT_OUTPUT },
    });
    process.on('message', async message => {
      if (message !== 'shutdown') return;
      await app.close();
      server.closeAllConnections();
      server.close(() => process.exit(0));
    });
    await app.prepare();
    handle = app.getRequestHandler();
    console.log('P0_NEXT_READY http://127.0.0.1:' + port);
  })().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
`;

async function waitFor(tab: BrowserSession, expression: string, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  do {
    try {
      if (await tab.evaluate(expression)) return;
    } catch {
      // Navigation can replace the execution context while polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Browser did not reach ${label}.`);
}

browserTest('restores persistent cookies in Chrome and rejects a refresh response arriving after logout', async () => {
  assert.ok(chrome);
  const config = new ConfigService({
    NODE_ENV: 'test',
    CAPTCHA_PROVIDER: 'none',
    JWT_ACCESS_SECRET: 'standalone-browser-fixture-access-key',
    JWT_REFRESH_SECRET: 'standalone-browser-fixture-refresh-key',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '24h',
  });
  const user = {
    id: 'fixture-admin', email: 'fixture@example.test', displayName: 'Fixture',
    active: true, roles: [{ role: { code: 'ADMIN' } }],
    passwordHash: await hash('test-only-password'), lockedUntil: null, mfaEnabled: false,
  };
  type Session = { id: string; userId: string; refreshTokenHash: string; expiresAt: Date;
    createdAt: Date; revokedAt: Date | null; user: typeof user };
  let session: Session | undefined;
  const prisma = {
    user: { findUnique: () => Promise.resolve(user), update: () => Promise.resolve(user) },
    authSession: {
      create: ({ data }: { data: Omit<Session, 'createdAt' | 'revokedAt' | 'user'> }) => {
        session = { ...data, createdAt: new Date(), revokedAt: null, user };
        return Promise.resolve(session);
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(session?.id === where.id ? { ...session } : null),
      updateMany: ({ where, data }: { where: { id: string }; data: { revokedAt: Date } }) => {
        if (!session || session.id !== where.id || session.revokedAt) return Promise.resolve({ count: 0 });
        session.revokedAt = data.revokedAt;
        return Promise.resolve({ count: 1 });
      },
    },
  } as never;
  const auth = new AuthService(prisma, new JwtService(), config, {} as never, { record: () => Promise.resolve({}) } as never);
  const actualRefresh = auth.refresh.bind(auth);
  let markRefreshPrepared = () => {};
  const refreshPrepared = new Promise<void>((resolve) => { markRefreshPrepared = resolve; });
  let releaseResponse = () => {};
  const refreshRelease = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let holdRefresh = false;
  let refreshCalls = 0;
  auth.refresh = async (token) => {
    refreshCalls += 1;
    const refreshed = await actualRefresh(token);
    if (holdRefresh) {
      markRefreshPrepared();
      await refreshRelease;
    }
    return refreshed;
  };
  const module = await Test.createTestingModule({
    controllers: [AuthController, SensitiveFixtureController],
    providers: [{ provide: AuthService, useValue: auth }, { provide: ConfigService, useValue: config }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  const reflector = new Reflector();
  const strategy = new JwtStrategy(config, prisma);
  void strategy;
  let originGuard: OriginGuard;
  app.useGlobalGuards(
    { canActivate: (context: ExecutionContext) => originGuard.canActivate(context) },
    new JwtAuthGuard(reflector),
    new RolesGuard(reflector),
  );
  let clientScript = '';
  let webOrigin = '';
  app.enableCors({
    origin: (requestOrigin: string | undefined, callback: (error: null, origin: boolean) => void) =>
      callback(null, requestOrigin === webOrigin),
    credentials: true,
  });
  const http = app.getHttpAdapter().getInstance() as Express;
  http.get('/dashboard', (_request: Request, response: Response) => {
    response.type('html').send('<!doctype html><title>Isolated auth fixture</title>');
  });
  http.get('/browser-client.js', (_request: Request, response: Response) => {
    response.type('js').send(clientScript);
  });
  http.get('/api/v1/auth/persistence-control', (_request: Request, response: Response) => {
    response.cookie('p0_profile_control', 'public-test-marker', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 60 * 60 * 1000,
    });
    response.status(204).end();
  });
  let next: ChildProcess | undefined;
  let nextOutput: string | undefined;
  let transport: ChildProcess | undefined;
  let browserEndpoint: URL | undefined;
  let browser: BrowserSession | undefined;
  const tempRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(tempRoot, 'nusrv-p0-chrome-'));
  async function launch() {
    assert.ok(chrome);
    transport = spawn(chrome, [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-quic',
      '--disable-component-update', '--disable-sync', '--disable-default-apps',
      '--disable-session-crashed-bubble', '--profile-directory=Default',
      '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1', '--proxy-server=127.0.0.1:1',
      '--proxy-bypass-list=127.0.0.1', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, env: localProcessEnvironment, stdio: ['ignore', 'ignore', 'pipe'] });
    browserEndpoint = await debuggerUrl(transport);
    browser = await connectPage(browserEndpoint);
    await browser.send('Page.enable');
    return browser;
  }

  async function loadFixture(tab: BrowserSession, origin: string) {
    const navigation = await tab.send('Page.navigate', { url: `${origin}/dashboard` });
    assert.ok(!('errorText' in navigation), JSON.stringify(navigation));
    await waitFor(tab, 'document.title === "Isolated auth fixture"', 'the browser API fixture');
    await tab.evaluate('(async () => { window.fixtureApi = (await import("/browser-client.js")).apiRequest })()');
  }

  async function closeProfile() {
    assert.ok(transport?.pid && browserEndpoint);
    const control = await connectDebugSession(browserEndpoint.href);
    try {
      const profileProcesses = (await control.send('SystemInfo.getProcessInfo')).processInfo;
      assert.ok(profileProcesses);
      assert.ok(profileProcesses.some(({ id }) => id === transport?.pid));
      const exited = once(transport, 'exit', { signal: AbortSignal.timeout(8_000) });
      void control.send('Browser.close').catch(() => {});
      await exited;
      const probes = profileProcesses.map(({ id }) => id);
      const deadline = Date.now() + 5_000;
      function stillRunning(id: number) {
        try { process.kill(id, 0); return true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
          throw error;
        }
      }
      while (probes.some(stillRunning) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(!probes.some(stillRunning), 'A process from the dedicated browser profile did not exit.');
    } finally {
      control.close();
      browser?.close();
    }
  }
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    if (useRealUi) {
      const webRoot = resolve(process.cwd(), '../web');
      const nextCache = join(webRoot, '.next');
      await mkdir(nextCache, { recursive: true });
      nextOutput = await mkdtemp(join(nextCache, 'p0-browser-'));
      next = spawn(process.execPath, ['-e', nextFixture], {
        cwd: webRoot, windowsHide: true,
        env: {
          ...localProcessEnvironment,
          NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_API_URL: origin,
          NODE_ENV: 'development', P0_NEXT_OUTPUT: relative(webRoot, nextOutput).replaceAll('\\', '/'),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let compileError = '';
      next.stderr?.on('data', (chunk) => { compileError = (compileError + String(chunk)).slice(-1_500); });
      webOrigin = await nextOrigin(next);
      for (const route of ['/login', '/dashboard']) {
        const page = await fetch(`${webOrigin}${route}`, { signal: AbortSignal.timeout(35_000) });
        await page.text();
        assert.equal(page.status, 200, `Unable to load the actual Next route ${route}. ${compileError}`);
      }
    }
    config.set('WEB_URL', webOrigin || origin);
    originGuard = new OriginGuard(config);
    const source = await readFile(resolve(process.cwd(), '../web/lib/api.ts'), 'utf8');
    clientScript = ts.transpileModule(
      source.replace('process.env.NEXT_PUBLIC_API_URL', JSON.stringify(origin)),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    let tab = await launch();
    if (useRealUi) {
      await tab.send('Page.navigate', { url: `${webOrigin}/login` });
      await waitFor(tab, `Boolean(document.querySelector('form') &&
        Object.keys(document.querySelector('form')).some(key => key.startsWith('__reactProps$')))`, 'the CRM sign-in form');
      await tab.evaluate(`(() => {
        document.querySelector('[name=email]').value = 'fixture@example.test';
        document.querySelector('[name=password]').value = 'test-only-password';
        document.querySelector('form').requestSubmit();
      })()`);
      await waitFor(tab, `location.pathname === '/dashboard' &&
        [...document.querySelectorAll('p')].some(element => element.textContent === 'Fixture')`, 'the signed-in CRM dashboard');
    } else {
      await loadFixture(tab, origin);
      assert.equal(await tab.evaluate(`fixtureApi('/auth/login', {
        method: 'POST', body: JSON.stringify({email: 'fixture@example.test', password: 'test-only-password'})
      }).then(x => x.user.id)`), user.id);
    }
    assert.ok(session && !session.revokedAt, 'Login must create a valid server-side refresh session.');
    assert.equal(await tab.evaluate(`fetch(${JSON.stringify(`${origin}/api/v1/auth/persistence-control`)},
      {credentials:'include'}).then(response => response.status)`), 204);

    const cookiesBefore = await tab.send('Network.getCookies', { urls: [`${origin}/api/v1/auth/me`] });
    const now = Date.now() / 1000;
    assert.ok(cookiesBefore.cookies?.some((cookie) =>
      cookie.name === 'cp_refresh' && cookie.httpOnly && !cookie.session && cookie.sameSite === 'Lax' &&
      cookie.domain === '127.0.0.1' && cookie.path === '/api/v1/auth' && !cookie.secure &&
      cookie.expires > now && cookie.expires <= now + 24 * 60 * 60));
    assert.ok(cookiesBefore.cookies?.some((cookie) => cookie.name === 'cp_access' && cookie.httpOnly && cookie.session));
    assert.ok(cookiesBefore.cookies?.some((cookie) => cookie.name === 'p0_profile_control' && !cookie.session));
    assert.equal(await tab.evaluate('document.cookie.includes("cp_refresh=")'), false);
    await tab.send('Network.deleteCookies', { name: 'cp_access', url: `${origin}/` });
    const persisted = new Set<string>();
    if (checkProfilePersistence) {
      await closeProfile();
      const { DatabaseSync } = await import('node:sqlite');
      const store = new DatabaseSync(join(profile, 'Default', 'Network', 'Cookies'), { readOnly: true });
      try {
        for (const row of store.prepare(
          "SELECT name FROM cookies WHERE name IN ('cp_refresh', 'p0_profile_control') AND is_persistent = 1",
        ).all()) {
          if (typeof row.name === 'string') persisted.add(row.name);
        }
      } finally {
        store.close();
      }
      tab = await launch();
    } else {
      // A fresh document loses all client memory while retaining the actual browser's cookies.
      await tab.send('Page.navigate', { url: 'about:blank' });
      await waitFor(tab, 'location.href === "about:blank"', 'a fresh document');
      assert.equal(await tab.evaluate('typeof window.fixtureApi'), 'undefined');
    }
    const cookiesAfterRestart = await tab.send('Network.getCookies', { urls: [`${origin}/api/v1/auth/me`] });
    if (checkProfilePersistence && !persisted.has('p0_profile_control')) {
      assert.ok(!cookiesAfterRestart.cookies?.some(({ name }) => name === 'p0_profile_control'));
      if (useRealUi) {
        await tab.send('Page.navigate', { url: `${webOrigin}/dashboard` });
        await waitFor(tab, "location.pathname === '/login'", 'the unauthenticated CRM sign-in route');
      }
      assert.fail('The browser profile did not write or restore the independent persistent control cookie.');
    }
    if (checkProfilePersistence) {
      assert.ok(persisted.has('cp_refresh'), 'The browser profile wrote the control but did not write the CRM refresh cookie.');
    }
    assert.ok(cookiesAfterRestart.cookies?.some((cookie) => cookie.name === 'cp_refresh'));
    assert.ok(!cookiesAfterRestart.cookies?.some((cookie) => cookie.name === 'cp_access'));
    if (useRealUi) {
      await tab.send('Page.navigate', { url: `${webOrigin}/dashboard` });
      await waitFor(tab, `location.pathname === '/dashboard' &&
        [...document.querySelectorAll('p')].some(element => element.textContent === 'Fixture')`, 'the restored CRM dashboard');
      await tab.evaluate(`(async () => {
        window.fixtureApi = (await import(${JSON.stringify(`${origin}/browser-client.js`)})).apiRequest;
      })()`);
    } else {
      await loadFixture(tab, origin);
    }
    const rawStatus = (path: string, method = 'GET') =>
      `fetch(${JSON.stringify(`${origin}/api/v1${path}`)}, {
        method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store"
      }).then(response => response.status)`;
    assert.equal(await tab.evaluate('fixtureApi("/auth/me").then(x => x.user.id)'), user.id);
    assert.equal(await tab.evaluate(rawStatus('/fixture-sensitive', 'POST')), 201);
    user.roles = [{ role: { code: 'ACCOUNTANT' } }];
    assert.equal(await tab.evaluate(rawStatus('/fixture-sensitive', 'POST')), 403);
    user.roles = [{ role: { code: 'ADMIN' } }];
    user.active = false;
    assert.equal(await tab.evaluate(rawStatus('/auth/me')), 401);
    user.active = true;

    const refreshStatus = rawStatus('/auth/refresh', 'POST');
    const initialExpiry = session.expiresAt;
    session.expiresAt = new Date(Date.now() - 1);
    assert.equal(await tab.evaluate(refreshStatus), 401);
    session.expiresAt = initialExpiry;
    const initialCreation = session.createdAt;
    session.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000);
    assert.equal(await tab.evaluate(refreshStatus), 401);
    session.createdAt = initialCreation;
    session.revokedAt = new Date();
    assert.equal(await tab.evaluate(refreshStatus), 401);
    session.revokedAt = null;
    user.active = false;
    assert.equal(await tab.evaluate(refreshStatus), 401);
    assert.equal(Object.prototype.toString.call(session.revokedAt), '[object Date]');
    user.active = true;
    session.revokedAt = null; // Reset the synthetic fixture for its independent logout-race scenario.

    await tab.send('Network.deleteCookies', { name: 'cp_access', url: `${origin}/` });
    const beforeConcurrent = refreshCalls;
    assert.deepEqual(await tab.evaluate(`Promise.all([
      fixtureApi('/auth/me').then(result => result.user.id),
      fixtureApi('/auth/me').then(result => result.user.id)
    ])`), [user.id, user.id]);
    assert.equal(refreshCalls - beforeConcurrent, 1);
    await tab.send('Network.deleteCookies', { name: 'cp_access', url: `${origin}/` });
    holdRefresh = true;
    await tab.evaluate(`window.racingBootstrap = fixtureApi('/auth/me').then(
      () => 'unexpected success', (error) => error.message
    ); undefined`);
    const preparationTimeout = AbortSignal.timeout(5_000);
    await Promise.race([
      refreshPrepared,
      once(preparationTimeout, 'abort').then(() => { throw new Error('The racing refresh never reached the API.'); }),
    ]);
    await tab.evaluate('fixtureApi("/auth/logout", {method:"POST"})');
    const afterLogout = await tab.send('Network.getCookies', { urls: [`${origin}/api/v1/auth/me`] });
    assert.ok(!afterLogout.cookies?.some(({ name }) => ['cp_refresh', 'cp_access'].includes(name)));
    releaseResponse();
    assert.equal(await tab.evaluate('racingBootstrap'), 'Authentication required.');
    assert.equal(await tab.evaluate(rawStatus('/auth/me')), 401);
    assert.equal(await tab.evaluate(refreshStatus), 401);
    assert.equal(Object.prototype.toString.call(session.revokedAt), '[object Date]');
  } finally {
    releaseResponse();
    if (transport?.pid && transport.exitCode === null && transport.signalCode === null) {
      try {
        await closeProfile();
      } catch {
        const exited = once(transport, 'exit', { signal: AbortSignal.timeout(5_000) });
        transport.kill();
        await exited.catch(() => {});
      }
    }
    browser?.close();
    if (next?.pid && next.exitCode === null && next.signalCode === null) {
      const exited = once(next, 'exit', { signal: AbortSignal.timeout(5_000) });
      if (next.connected) next.send('shutdown');
      else next.kill();
      await exited.catch(() => { next?.kill(); });
    }
    if (nextOutput) {
      const nextCache = resolve(process.cwd(), '../web/.next');
      const withinCache = relative(nextCache, resolve(nextOutput));
      if (/^p0-browser-[A-Za-z0-9]+$/.test(withinCache)) {
        await rm(nextOutput, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      }
    }
    await app.close();
    const withinTemp = relative(tempRoot, resolve(profile));
    if (withinTemp.startsWith('nusrv-p0-chrome-') && !isAbsolute(withinTemp)) {
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    }
  }
}, 150_000);
