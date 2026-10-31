import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/shared/ui/legal-page';
import { CONTACT_EMAIL, GITHUB_URL } from '@/shared/config/site';

export const metadata: Metadata = { title: 'Terms of Use' };

/** `/terms`: the terms of use. */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="November 1, 2026">
      <p>
        These terms cover the Xomoni browser extension and the xomoni.com website (together, “Xomoni”). By using Xomoni
        you agree to them. If you don’t agree, please don’t use it.
      </p>

      <h2>What Xomoni is</h2>
      <p>
        Xomoni is a free, open-source tool that helps you delete posts, replies, reposts and likes on your own X
        account. The software is licensed under the <a href={`${GITHUB_URL}/blob/main/LICENSE`}>MIT license</a>; these
        terms add the rules for using the website and the optional Xomoni account.
      </p>

      <h2>A research project</h2>
      <p>
        Xomoni is a research project. It explores ways to clean up your own X account through X’s website while staying
        well within the limits X announces, and it changes as we learn. It is not a commercial service, and it comes
        with no guarantee of any result.
      </p>

      <h2>Use it on your own account</h2>
      <ul>
        <li>Use Xomoni only on X accounts you own or are authorized to manage.</li>
        <li>Don’t use Xomoni to break the law, to harm others, or to attack or overload X or this website.</li>
        <li>
          Don’t modify Xomoni to get around X’s security checks, to run many accounts, or to hide automated activity.
        </li>
      </ul>

      <h2>Your X account is your responsibility</h2>
      <p>
        Xomoni is not affiliated with, endorsed by or sponsored by X Corp. Automating actions on X’s website may be
        against <a href="https://help.x.com/en/rules-and-policies/x-automation">X’s automation rules</a>, and X can
        limit, lock or suspend accounts at its discretion. Xomoni is designed to keep this risk low, but it cannot
        remove it, and nobody guarantees that no problem will occur. You use Xomoni at your own risk: you decide what to
        delete and when, and the consequences for your X account, including any action X takes against it, are your
        responsibility.
      </p>
      <p>
        <strong>Deletions on X are permanent.</strong> Download your X archive before you start. Xomoni cannot restore
        anything that has been deleted.
      </p>

      <h2>Your Xomoni account</h2>
      <p>
        An account is optional. Keep your password private and use an email address you control; you are responsible for
        activity under your account. You can delete your Xomoni account at any time from your account page. We may
        suspend accounts that misuse the service, and we may change or discontinue the website; the open-source
        extension keeps working without it.
      </p>

      <h2>No warranty</h2>
      <p>
        Xomoni is provided “as is”, without warranty of any kind. X changes its website often, and a feature may stop
        working at any time.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, the author of Xomoni is not liable for any indirect, incidental or
        consequential damages, or for any loss of data, content or account access, arising from your use of Xomoni.
      </p>

      <h2>Privacy</h2>
      <p>
        How Xomoni handles data is described in the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If these terms change, the new version will be posted here with a new date. Questions:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
