import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'School Reliability Scorecard',
  description: 'MBTA bus reliability around schools',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
