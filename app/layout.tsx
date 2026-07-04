import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QueryGuard — text-to-SQL that checks its own answer',
  description:
    'Ask a demand-planning database in plain English. Before returning anything, it verifies the query actually answers the question — the failure most text-to-SQL demos skip.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
