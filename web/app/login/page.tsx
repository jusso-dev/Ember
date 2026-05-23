import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/server-api';
import LoginClient from './LoginClient';

export default async function LoginPage() {
  const session = await getServerSession();
  if (session.authenticated) {
    redirect('/');
  }

  return <LoginClient initialMode={session.setup_required ? 'setup' : 'login'} />;
}
