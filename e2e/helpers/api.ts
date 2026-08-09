import { OWNER, baseUrl, controlPlaneUrl } from './env.js';

export type SessionInfo = {
  authenticated: boolean;
  setup_required?: boolean;
  user?: { id: string; name: string; email: string; role: string };
  active_tenant?: { id: string; name: string; slug: string; role: string };
};

function cookieHeader(setCookie: string[] | null): string {
  if (!setCookie?.length) return '';
  return setCookie
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

export async function cpFetch(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  headers.set('accept', 'application/json');
  return fetch(`${controlPlaneUrl()}${path}`, {
    ...init,
    headers,
  });
}

export async function webFetch(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  headers.set('accept', 'application/json');
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
  });
}

export function extractSessionCookie(res: Response): string {
  // undici / node fetch
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];
  const header = cookieHeader(setCookies);
  const match = header.match(/ember_session=[^;]+/);
  return match ? match[0] : header;
}

export async function setupOwnerViaApi(): Promise<{ cookie: string; session: SessionInfo }> {
  const sessionRes = await cpFetch('/api/auth/session');
  const session = (await sessionRes.json()) as SessionInfo;

  if (session.setup_required) {
    const probe = await cpFetch('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: OWNER.name,
        email: OWNER.email,
        password: OWNER.password,
        tenant_name: OWNER.tenant,
      }),
    });
    if (!probe.ok) {
      throw new Error(`setup failed: ${probe.status} ${await probe.text()}`);
    }
    const cookie = extractSessionCookie(probe);
    const body = (await probe.json()) as SessionInfo;
    return { cookie, session: body };
  }

  const login = await cpFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
  });
  if (!login.ok) {
    throw new Error(`login failed: ${login.status} ${await login.text()}`);
  }
  const cookie = extractSessionCookie(login);
  const body = (await login.json()) as SessionInfo;
  return { cookie, session: body };
}

export async function ensureOwnerSession(): Promise<string> {
  const { cookie } = await setupOwnerViaApi();
  if (!cookie.includes('ember_session=')) {
    throw new Error(`missing session cookie: ${cookie}`);
  }
  return cookie;
}
