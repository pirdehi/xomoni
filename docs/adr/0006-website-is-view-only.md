# ADR-0006: The website cannot start deletions

- Status: Accepted
- Date: 2026-10-30
- Amended: 2026-11-19, the extension's actions from the website in the same browser, approved in Xomoni ([ADR-0027](0027-extension-actions-from-the-website.md), #248)

## Context

A website that could trigger deletions would be a remote control for someone's X account: a stolen session or a cross-site bug could delete years of posts. It would also move the action away from the person's own browser, where X's protections and the person's attention are.

## Decision

The website only shows status (devices, job progress, "Needs you" prompts). It has no endpoint, action or table column that starts, resumes or approves work on X. Destructive actions on the website are limited to the person's own Xomoni data (disconnecting a device, deleting the account).

## Consequences

- The worst a compromised website session can do is read job counters or delete the Xomoni account; nothing on X.
- Remote control features would need a new ADR and a security review.
