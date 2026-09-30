import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FRC Fantasy',
  description: 'Fantasy drafts for FIRST Robotics Competition events.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto w-full max-w-xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
