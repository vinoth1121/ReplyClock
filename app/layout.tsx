import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '700', '800'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'ReplyClock \u2014 speed-to-lead console',
  description:
    'ReplyClock is a speed-to-lead console for WhatsApp sales leads, tracking live first-reply timers, SLA breaches, and source-ad attribution.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={jetbrains.variable}>
      <body>{children}</body>
    </html>
  );
}
