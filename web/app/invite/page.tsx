import { Suspense } from 'react';
import InviteClient from './InviteClient';

export default function InvitePage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center text-zinc-500">Loading…</main>}>
      <InviteClient />
    </Suspense>
  );
}
