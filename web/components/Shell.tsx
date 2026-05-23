import { requireServerSession } from '@/lib/server-api';
import { ShellClient } from '@/components/ShellClient';

export async function Shell({ children }: { children: React.ReactNode }) {
  const session = await requireServerSession();
  return <ShellClient session={session}>{children}</ShellClient>;
}
