import type { Metadata } from 'next';
import { LegalPage } from '@/shared/ui/legal-page';
import { CONTACT_EMAIL, GITHUB_URL } from '@/shared/config/site';

export const metadata: Metadata = { title: 'Privacy Policy' };

/** `/privacy`: the privacy policy. */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 31, 2026">
      <p>
        Xomoni is a free, open-source tool made by Omid Pirdehi. It has two parts: a browser extension that cleans up
        your own X account on your computer, and this website, where you can follow that work from any device. This
        policy explains what each part stores and why. The source code for both is public on{' '}
        <a href={GITHUB_URL}>GitHub</a>, so you can check every claim below.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>
          <strong>
            Your X password, session cookies, posts, replies, likes, archive and activity log never leave your computer.
          </strong>
        </li>
        <li>An account is optional. Without one, nothing is sent to us at all.</li>
        <li>
          If you create an account, we store your email address (and name, if you give one), the browsers you connect
          and summaries of your jobs.
        </li>
        <li>No ads, no selling of data, no tracking or analytics cookies.</li>
        <li>You can delete your account and everything we hold at any time from your account page.</li>
      </ul>

      <h2>What stays on your computer</h2>
      <p>
        The extension works inside your own logged-in X tab. It keeps its inventory of your posts and likes, the
        activity log, your settings and any archive you import in your browser’s local storage (IndexedDB). It reads the
        responses X sends to your browser to confirm each action and to respect X’s rate limits. None of this is sent to
        Xomoni or anyone else. Xomoni never asks for, reads or stores your X password, and it does not read your X
        session cookies.
      </p>

      <h2>What we store if you sign in</h2>
      <p>You can create a Xomoni account with your email address and a password, or with Google. We then store:</p>
      <ul>
        <li>
          <strong>Your sign-in details:</strong> your email address, the name you entered (optional) and your password
          as a one-way hash, never the password itself. If you use Google, we receive your name, email address, profile
          picture and Google account ID instead. We use them to sign you in and to show who is signed in.
        </li>
        <li>
          <strong>Security records:</strong> when your account was created, confirmed and last signed in, and whether
          your email address is confirmed.
        </li>
        <li>
          <strong>Connected browsers:</strong> a name such as “Chrome on macOS”, the extension version and when it last
          checked in.
        </li>
        <li>
          <strong>Job summaries:</strong> the job’s title (for example “Delete posts before Jan 2024”), its type and
          state, counts (matched, deleted, skipped, failed, scanned), timestamps, and the X handle the job ran on.
        </li>
      </ul>
      <p>
        We use this data only to show you your dashboard. Job summaries contain counts, not the content or IDs of your
        posts.
      </p>

      <h2>Emails we send</h2>
      <p>
        We only send emails about your account: confirming your address, resetting your password, confirming an email
        change, and security notices when your password, email or sign-in methods change. No newsletters or marketing.
      </p>
      <h2>Cookies</h2>
      <p>
        This website sets only the cookies it needs to keep you signed in. There are no advertising, analytics or
        third-party tracking cookies. The sign-in, sign-up and password forms use Cloudflare Turnstile to block
        automated abuse; it checks your browser without tracking you across sites.
      </p>

      <h2>Service providers</h2>
      <ul>
        <li>
          <strong>Supabase</strong> hosts the database and sign-in service (servers in the United States).
        </li>
        <li>
          <strong>Vercel</strong> hosts this website and keeps short-lived request logs to operate it.
        </li>
        <li>
          <strong>Google</strong> handles “Sign in with Google”. Xomoni requests only your basic profile and email.
        </li>
        <li>
          <strong>Resend</strong> delivers our account emails (servers in the United States). It receives your email
          address and the message.
        </li>
        <li>
          <strong>Cloudflare</strong> runs Turnstile on the sign-in, sign-up and password forms, and hosts our domain’s
          DNS and email forwarding.
        </li>
      </ul>
      <p>
        Xomoni’s use of information received from Google APIs adheres to the Google API Services User Data Policy,
        including the Limited Use requirements. We do not sell or share your data with anyone else, and we do not use it
        for advertising.
      </p>

      <h2>Keeping and deleting your data</h2>
      <p>
        We keep account data until you delete it. Disconnecting a browser in the dashboard removes that browser and its
        job summaries. <strong>Delete my Xomoni account</strong> on your account page removes your account, browsers and
        job summaries immediately; copies may remain in our providers’ backups for a short period before they expire.
        Removing the extension deletes the data it stored in your browser.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and delete your data yourself from the dashboard and your account page. For any other request,
        including a copy of your data, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Children</h2>
      <p>Xomoni is not intended for anyone under 13, or under the minimum age to use X where you live.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date. Significant changes will also be
        noted in the project’s release notes on GitHub.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
