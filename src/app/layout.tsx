// === Root layout ===
// Wraps every page. The App Router requires this file; it owns the <html> and
// <body> tags. Metadata lives here so it applies site-wide unless a page
// overrides it.

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'BestUpgrade',
  description: 'OSRS time-efficient gear upgrade finder',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
