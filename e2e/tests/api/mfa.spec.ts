import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { OWNER } from '../../helpers/env.js';
import { cpFetch, extractSessionCookie, setupOwnerViaApi } from '../../helpers/api.js';

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of cleaned) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) throw new Error('bad base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secretB32: string, unixSecs = Math.floor(Date.now() / 1000)): string {
  const key = base32Decode(secretB32);
  const counter = Math.floor(unixSecs / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', key).update(msg).digest();
  const offset = hash[19] & 0x0f;
  const bin =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

test.describe('P0 MFA TOTP', () => {
  test('setup → confirm → login requires TOTP', async () => {
    const { cookie } = await setupOwnerViaApi();

    const status0 = await cpFetch('/api/auth/mfa', { cookie });
    expect(status0.ok).toBeTruthy();

    const begin = await cpFetch('/api/auth/mfa/setup', { method: 'POST', cookie });
    expect(begin.ok).toBeTruthy();
    const setup = await begin.json();
    expect(setup.secret).toBeTruthy();
    expect(setup.recovery_codes?.length).toBe(8);

    const code = totp(setup.secret);
    const confirm = await cpFetch('/api/auth/mfa/confirm', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ totp_code: code }),
    });
    expect(confirm.ok).toBeTruthy();

    // Login without TOTP → mfa_required
    const bare = await cpFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
    });
    expect(bare.status).toBe(400);
    const bareBody = await bare.json();
    expect(bareBody.error).toBe('mfa_required');

    // Login with TOTP
    const withTotp = await cpFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: OWNER.email,
        password: OWNER.password,
        totp_code: totp(setup.secret),
      }),
    });
    expect(withTotp.ok).toBeTruthy();
    expect(extractSessionCookie(withTotp)).toContain('ember_session=');

    // Disable MFA
    const disable = await cpFetch('/api/auth/mfa/disable', {
      method: 'POST',
      cookie: extractSessionCookie(withTotp),
      body: JSON.stringify({ totp_code: totp(setup.secret) }),
    });
    expect(disable.ok).toBeTruthy();
  });
});
