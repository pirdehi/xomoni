# ADR-0003: Never touch X credentials or session cookies, and never evade detection

- Status: Accepted
- Date: 2026-10-29

## Context

Tools in this space often store passwords to log in again, copy session cookies, solve captchas, rotate proxies, spoof fingerprints or hide that a browser is automated. Each of these puts the person's account and security at risk, and several break X's rules. Suggestions to adopt such techniques were reviewed and rejected ([issue #47](https://github.com/pirdehi/xomoni/issues/47)).

## Decision

- Xomoni never asks for, stores or types an X password, and never reads or writes X cookies (reading the `twid` account id is the only exception).
- When X needs the person (login, 2FA, captcha, account lock, wrong account), the job pauses in a "Needs you" state and notifies them; it resumes only after they act.
- Xomoni never forges headers, solves captchas, uses proxies, spoofs fingerprints, hides automation or synthesizes "trusted" input events.
- If Xomoni cannot verify an item, it leaves it alone.

The complete list, with the reason for each rule, is the [safety playbook](../PLAYBOOK.md) (§8 lists what Xomoni deliberately does not do).

## Consequences

- Some accounts will take longer to clean, and some jobs will wait for the person.
- Reviews reject any change that weakens these rules; the pull request template asks about them.
