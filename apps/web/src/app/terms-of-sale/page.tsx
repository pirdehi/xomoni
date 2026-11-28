import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { billingPagesOn } from '@/shared/config/billing-pages';
import { CONTACT_EMAIL } from '@/shared/config/site';
import { LegalPage } from '@/shared/ui/legal-page';

export const metadata: Metadata = { title: 'Terms of Sale' };

/**
 * `/terms-of-sale`: the terms of a paid plan (#420, ADR-0042). A draft until the maintainer approves it: the page
 * answers 404 unless the server shows the pages for paid plans (`BILLING_PAGES=1`), and says it is a draft when it does.
 */
export default function TermsOfSalePage() {
  if (!billingPagesOn()) notFound();
  return (
    <LegalPage
      title="Terms of Sale"
      updated="November 23, 2026"
      draft="Waiting for the maintainer’s approval. Nothing on this page is in force yet, and paid plans aren’t on sale."
    >
      <p>
        These terms apply when you buy a paid Xomoni plan. They add to the <Link href="/terms">Terms of Use</Link>,
        which still apply. Xomoni stays free and open source: a paid plan opens extra features, and everything else
        keeps working without one.
      </p>

      <h2>Who sells to you</h2>
      <p>
        Paid plans are sold by <a href="https://polar.sh">Polar</a>, our reseller and merchant of record. You pay on
        Polar’s checkout. Polar processes the payment, keeps your card and billing details, charges any sales tax or VAT
        that applies where you live, issues your receipt, and handles refunds and chargebacks. Polar’s own terms apply
        to the payment itself. Xomoni never sees or stores your card details.
      </p>

      <h2>What you buy</h2>
      <ul>
        <li>
          A subscription to Plus or Pro, billed monthly or yearly, or a one-time pass that opens a plan for a fixed time
          and doesn’t renew.
        </li>
        <li>
          A plan opens features of Xomoni, in the extension and on xomoni.com, as the plan’s description says when you
          buy it. Pro includes everything in Plus.
        </li>
        <li>
          Some things are free on every plan and never need one: exporting your data, deleting it, moving it to another
          copy of Xomoni, and every safety limit Xomoni keeps on X.
        </li>
      </ul>

      <h2>Price and taxes</h2>
      <p>
        The price, and any tax added to it, is shown on Polar’s checkout before you pay. If a plan’s price changes, the
        new price applies to your subscription only from a renewal after we have told you, and you can cancel before
        then.
      </p>
      <p>
        If you bought a plan at a founding price, you keep that price for as long as your subscription stays active. If
        it ends, a new subscription is at the price of the day.
      </p>

      <h2>Renewal and cancelling</h2>
      <ul>
        <li>A subscription renews automatically at the end of each period, monthly or yearly, until you cancel it.</li>
        <li>
          You can cancel at any time from Polar’s customer portal, which your account page on xomoni.com opens. Your
          plan stays until the end of the period you have paid for, and you aren’t charged again.
        </li>
        <li>A one-time pass ends by itself: there is nothing to cancel.</li>
        <li>Deleting your Xomoni account cancels your subscription first.</li>
      </ul>

      <h2>When a plan ends</h2>
      <p>
        When a plan ends, its features close. Nothing is deleted: your data stays in your browser, and you can still
        export it. If Xomoni can’t check your plan, for example while you are offline, the extension keeps the plan it
        last saw for up to 7 days.
      </p>

      <h2>Refunds</h2>
      <p>
        How to get your money back is set out in the <Link href="/refunds">Refund Policy</Link>.
      </p>

      <h2>No promise about X</h2>
      <p>
        A plan gives you access to features of Xomoni. It changes nothing about how X treats your account. Xomoni
        doesn’t promise any result on X: not more reach or followers, not fewer limits, and not that a limited, locked
        or suspended X account will be unlocked or restored. Anything Xomoni shows about how far your posts reach is an
        estimate, and a suspicion is labelled as a guess.
      </p>
      <p>
        The risks of using Xomoni on X are the same on every plan. They are set out in the{' '}
        <Link href="/terms">Terms of Use</Link> and on the <Link href="/risks">risks page</Link>.
      </p>

      <h2>If we stop offering a plan</h2>
      <p>If we stop offering a plan, it won’t renew, and you keep it until the end of the period you have paid for.</p>

      <h2>Your rights</h2>
      <p>These terms don’t take away any right you have under the consumer law of the country where you live.</p>

      <h2>Changes and contact</h2>
      <p>
        If these terms change, the new version will be posted here with a new date, and a change that matters to an
        active subscription will be told to you before it applies to it. Questions:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
