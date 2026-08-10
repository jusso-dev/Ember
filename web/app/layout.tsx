import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ember',
  description: 'Homelab control plane — keep the fire lit',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-orange-50 antialiased">{children}</body>
    </html>
  );
}
