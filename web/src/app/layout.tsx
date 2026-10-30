import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://xomoni.com'),
  title: {
    default: 'Xomoni: clean up your X account',
    template: '%s · Xomoni',
  },
  description:
    'Delete old posts, replies, reposts and likes on X from your own browser. No API keys, no password, paced to stay within X’s limits. Free and open source.',
  applicationName: 'Xomoni',
  authors: [{ name: 'Omid Pirdehi', url: 'https://github.com/pirdehi' }],
  openGraph: {
    type: 'website',
    siteName: 'Xomoni',
    url: 'https://xomoni.com',
    images: [{ url: '/screens/overview.png', width: 1440, height: 1000, alt: 'The Xomoni dashboard' }],
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
