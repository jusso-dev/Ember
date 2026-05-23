import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SessionInfo } from '@/lib/types/SessionInfo';

const CONTROL_PLANE = process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:8080';

export async function serverGet<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const res = await fetch(`${CONTROL_PLANE}${path}`, {
    headers: {
      accept: 'application/json',
      cookie: cookieStore.toString(),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as T;
}

export async function getServerSession() {
  return serverGet<SessionInfo>('/api/auth/session');
}

export async function requireServerSession() {
  const session = await getServerSession();
  if (!session.authenticated) {
    redirect('/login');
  }
  return session;
}
