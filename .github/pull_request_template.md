## What and why

<!-- What changes, and why. Link the issue: "Closes #123". -->

## How it was tested

<!-- Commands run, screenshots for UI changes, manual steps. -->

## Checklist

- [ ] `npm run verify` passes (the pre-push hook runs it)
- [ ] Doc comments on new exports; unit README updated if responsibility, files or dependencies changed
- [ ] `docs/ARCHITECTURE.md` and an ADR updated if structure, rules or decisions changed
- [ ] Tests cover new behavior, including failure and security cases
- [ ] New environment variables documented in `apps/web/.env.example` and set in Vercel
- [ ] The finished task is ticked in `docs/ROADMAP.md`

## Safety (see [docs/PLAYBOOK.md](https://github.com/pirdehi/xomoni/blob/main/docs/PLAYBOOK.md))

- [ ] Pacing, stop rules and item verification are unchanged, or the change is explained above
- [ ] No new extension permissions, or they are justified above
- [ ] No X content, credentials or cookies leave the browser
- [ ] No header forging, captcha solving, proxies, fingerprint spoofing or hidden automation
- [ ] The website still cannot start, resume or approve work on X
