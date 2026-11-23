import assert from 'node:assert/strict';
import test from 'node:test';

let moduleNumber = 0;

async function clientFor(t, handler) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    return handler(new URL(url).pathname, options);
  });
  return (await import(`./api.ts?test=${++moduleNumber}`)).apiRequest;
}

const unauthorized = () => new Response(null, { status: 401 });
const account = { user: { id: 'admin' } };
const endpoint = '/api/v1/auth/';

test('a restarted browser restores a dashboard bootstrap with only a valid refresh cookie', async (t) => {
  let access = false;
  const calls = [];
  const request = await clientFor(t, (path, options) => {
    calls.push(path);
    if (path === endpoint + 'refresh') {
      assert.equal(options.method, 'POST');
      access = true;
      return Response.json(account);
    }
    return access ? Response.json(account) : unauthorized();
  });
  assert.deepEqual(await request('/auth/me'), account);
  assert.deepEqual(calls, ['me', 'refresh', 'me'].map((name) => endpoint + name));
});

test('concurrent and late authorization failures share a single successful refresh', async (t) => {
  let access = false;
  let refreshes = 0;
  let oldRequests = 0;
  const lateResponse = Promise.withResolvers();
  const request = await clientFor(t, async (path) => {
    if (path === endpoint + 'refresh') {
      refreshes += 1;
      access = true;
      return Response.json(account);
    }
    if (access) return Response.json(account);
    oldRequests += 1;
    if (oldRequests === 2) return lateResponse.promise;
    return unauthorized();
  });
  const first = request('/auth/me');
  const second = request('/auth/me');
  assert.deepEqual(await first, account);
  lateResponse.resolve(unauthorized());
  assert.deepEqual(await second, account);
  assert.equal(refreshes, 1);
});

test('an expired or revoked refresh does not retry or load the dashboard', async (t) => {
  const calls = [];
  const request = await clientFor(t, (path) => {
    calls.push(path);
    return unauthorized();
  });
  await assert.rejects(request('/auth/me'), /Authentication required/);
  assert.deepEqual(calls, ['me', 'refresh'].map((name) => endpoint + name));
});

test('logout wins when a successful refresh response arrives after revocation', async (t) => {
  const startedRefresh = Promise.withResolvers();
  const releaseRefresh = Promise.withResolvers();
  let revoked = false;
  let accessCookie = false;
  let reads = 0;
  const request = await clientFor(t, async (path) => {
    if (path === endpoint + 'logout') {
      revoked = true;
      accessCookie = false;
      return new Response(null, { status: 204 });
    }
    if (path === endpoint + 'refresh') {
      if (revoked) return unauthorized();
      startedRefresh.resolve();
      await releaseRefresh.promise;
      accessCookie = true;
      return Response.json(account);
    }
    reads += 1;
    return accessCookie && !revoked ? Response.json(account) : unauthorized();
  });
  const bootstrap = request('/auth/me');
  const denied = assert.rejects(bootstrap, /Authentication required/);
  await startedRefresh.promise;
  await request('/auth/logout', { method: 'POST' });
  releaseRefresh.resolve();
  await denied;
  assert.equal(reads, 1, 'the stale response cannot retry the dashboard bootstrap');
  await assert.rejects(request('/auth/me'), /Authentication required/);
  assert.equal(revoked, true);
});
