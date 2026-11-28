import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { billingPagesOn } from '@/shared/config/billing-pages';
import { CONTACT_EMAIL } from '@/shared/config/site';
import { LegalPage } from '@/shared/ui/legal-page';

export const metadata: Metadata = { title: 'Refund Policy' };

/**
 * `/refunds`: how to get a payment for a paid plan back (#420, ADR-0042). A draft until the maintainer approves it:
 * the page answers 404 unless the server shows the pages for paid plans (`BILLING_PAGES=1`), and says it is a draft
 * when it does.
 */
export default function RefundsPage() {
  if (!billingPagesOn()) notFound();
  return (
    <LegalPage
      title="Refund Policy"
      updated="November 23, 2026"
      draft="Waiting for the maintainer’s approval. Nothing on this page is in force yet, and paid plans aren’t on sale."
    >
      <p>
        Xomoni’s paid plans are sold by Polar, our merchant of record (see the{' '}
        <Link href="/terms-of-sale">Terms of Sale</Link>), so a refund is paid by Polar, to the card or account you paid
        with.
      </p>

      <h2>Your first 14 days</h2>
      <p>
        If a plan isn’t for you, ask within 14 days of your first payment for it and you get all of it back, with no
        questions asked. The same goes for a one-time pass, within 14 days of buying it.
      </p>

      <h2>Renewals</h2>
      <p>
        Cancel before a renewal to avoid it: your plan stays until the end of the period you have paid for. If a renewal
        went through that you didn’t want, write to us within 14 days of it and we refund that renewal.
      </p>

      <h2>How to ask</h2>
      <ul>
        <li>
          Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address you paid with, or give the
          order number on Polar’s receipt.
        </li>
        <li>
          We ask Polar to refund the payment. Polar sends it back to your card or account; your bank may take a few days
          to show it.
        </li>
      </ul>

      <h2>After a refund</h2>
      <p>
        A refunded plan ends at once, and its features close. Nothing is deleted: your data stays in your browser, and
        you can still export it.
      </p>

      <h2>Chargebacks</h2>
      <p>
        Please write to us before you dispute a payment with your bank: a refund is quicker. Polar handles disputes as
        the merchant of record.
      </p>

      <h2>Refunds are about the plan, not about X</h2>
      <p>
        A refund doesn’t depend on anything that happens on X, and it can’t undo anything: Xomoni can’t restore deleted
        posts, and it can’t change what X does to an account.
      </p>

      <h2>Your rights</h2>
      <p>
        This policy adds to the rights you have under the consumer law of the country where you live; it doesn’t take
        any away.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date, and it applies only to payments
        made after that. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
