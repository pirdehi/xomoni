import type { ReactNode } from 'react';
import { Download, ExternalLink, ShieldCheck } from 'lucide-react';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';

/** One numbered step of the install guide. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold tabular">
        {n}
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <div className="mt-1 leading-relaxed text-ink-2">{children}</div>
      </div>
    </li>
  );
}

/**
 * How to install the extension from a GitHub release (#44): download the latest zip, check it, load it in Chrome
 * with Developer mode, then connect it to xomoni.com with a code. Until the Chrome Web Store listing exists (#43),
 * this is the way to install.
 */
export function InstallGuide() {
  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <a href={DOWNLOAD_URL} className="btn btn-primary px-5 py-3">
          <Download className="size-4" aria-hidden />
          Download the latest version
        </a>
        <a href={RELEASES_URL} className="btn btn-secondary px-5 py-3">
          <ExternalLink className="size-4" aria-hidden />
          All versions and checksums
        </a>
      </div>
      <p className="mt-3 text-sm text-muted">
        Free and open source. Each release is built from a tagged commit by GitHub Actions, with a SHA-256 checksum.
      </p>

      <ol className="mt-10 space-y-8">
        <Step n={1} title="Read what can go wrong">
          Automating actions on X is against X’s rules, and an account can be limited. Read{' '}
          <a href="/risks" className="text-accent underline underline-offset-2">
            the risks
          </a>{' '}
          and download your X archive first.
        </Step>
        <Step n={2} title="Download and unzip">
          Download <code>xomoni-extension.zip</code> and unzip it into a folder you keep, such as Documents/Xomoni.
          Chrome loads the extension from that folder, so don’t delete it.
        </Step>
        <Step n={3} title="Load it in Chrome, Edge or Brave">
          Open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong> (top right), choose{' '}
          <strong>Load unpacked</strong> and select the unzipped folder. Pin Xomoni to the toolbar.
        </Step>
        <Step n={4} title="Follow it here (optional)">
          Sign in on xomoni.com, get a one-time code on your dashboard, and type it in the extension under{' '}
          <strong>Settings → xomoni.com</strong>. Only job status is sent; your posts and likes stay on your computer.
        </Step>
      </ol>

      <p className="mt-10 inline-flex items-start gap-2 text-sm text-ink-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
        To update, download the new version, replace the folder’s contents and press the reload button on Xomoni’s card
        in <code>chrome://extensions</code>. Your data stays.
      </p>
    </div>
  );
}
