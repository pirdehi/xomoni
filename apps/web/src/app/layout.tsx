import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ExtensionSessionSync } from '@/modules/extension/ui/extension-session-sync';
import { billingPagesOn } from '@/shared/config/billing-pages';
import { BillingPagesProvider } from '@/shared/ui/billing-pages';
import { SiteFluentProvider } from '@/shared/ui/fluent-provider';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

// Xomoni, digital footprint manager (#313): X today, the person's email next. Open Graph and Twitter take each page's
// own title and description (Next.js fills them in when `openGraph` has none), so they are not repeated here.
export const metadata: Metadata = {
  metadataBase: new URL('https://xomoni.com'),
  title: {
    default: 'Xomoni — Digital footprint manager',
    template: '%s · Xomoni',
  },
  description:
    'Manage your digital footprint from your own computer, starting with X: find, understand and clean up old posts and likes. No X password. Free and open source.',
  applicationName: 'Xomoni',
  authors: [{ name: 'Omid Pirdehi', url: 'https://github.com/pirdehi' }],
  openGraph: {
    type: 'website',
    siteName: 'Xomoni',
    url: 'https://xomoni.com',
    images: [
      {
        url: '/screens/overview.png',
        width: 1440,
        height: 1000,
        alt: 'Xomoni’s dashboard for an X account: what is still on it, what Xomoni removed, and recent activity',
      },
    ],
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
};

/**
 * Root layout: fonts, theme color, Fluent UI with server-rendered styles (ADR-0019) and the page shell, and one sign-in
 * with the Xomoni extension in this browser on every page (#232, ADR-0025). The sync comes first, so it keeps an
 * `#ext=` fragment before a page clears it. The footer learns from here whether the pages for paid plans are shown
 * (`BILLING_PAGES`, #420).
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ExtensionSessionSync />
        <BillingPagesProvider on={billingPagesOn()}>
          <SiteFluentProvider>{children}</SiteFluentProvider>
        </BillingPagesProvider>
      </body>
    </html>
  );
}
