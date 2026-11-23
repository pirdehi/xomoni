---
task: 407
title: Email me when X warns my account: user scenarios
feature: health-alert
---

# An email when X warns an account

An email, only for those who ask, when an X account's risk level rises to Retreat (2) or above (#407, [ADR-0047](../adr/0047-an-email-when-x-warns-an-account.md)). It says that X warned @handle, that Xomoni stopped, and when Xomoni may go on, and that the person should rest the account. It is made only of what the server already has: the handle and the level each job report carries (0–4, ADR-0013), never X's notice or a post. It never asks for anything: its only links open the dashboard and stop the alerts. It is turned on and off in xomoni.com's Settings, and stopped from a link in the email without signing in. The database sends it, as the weekly email (ADR-0031): one per rise, at most one every six hours, never without the Resend key in Vault.

The tests run the website against the local stack. A job report is made as Xomoni's would land, by writing the job's `risk_level` with the admin key. The local stack has no Resend key, as production until it is set up, so the database sends nothing. The tests read what it queued, and the email it would send, with the admin key, as its scheduler would. The email itself is checked word by word in the database's own tests (`supabase/tests/database/health_alert.test.sql`). Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-407
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S407-01 · happy

- Given a person signed in, who never chose
- When they open Settings and turn on Email me when X warns my account
- Then it is off at first and on after, kept by xomoni.com
- And while sending isn't set up on xomoni.com, the card says nothing is sent until it is, and that their choice is kept
- Test: apps/web/e2e/health-alert.spec.ts

## S407-02 · happy

- Given the alert on, and a job of @ada_x at Normal
- When Xomoni's next report of the job raises the account to Retreat
- Then one alert is queued, of @ada_x at Retreat, and nothing else
- Test: apps/web/e2e/health-alert.spec.ts

## S407-03 · happy

- Given that alert queued
- When the email it makes is read
- Then its subject is X warned @ada_x, it says Xomoni stopped and won't resume before a time in UTC, then goes at half
  its pace for a week, and to rest the account
- And its only links open the dashboard's Account health and stop the alerts
- Test: apps/web/e2e/health-alert.spec.ts

## S407-04 · cancel

- Given the alert on, and an alert waiting
- When the person turns it off in Settings
- Then it stays off, the waiting alert is dropped, and no email is left to send
- Test: apps/web/e2e/health-alert.spec.ts

## S407-05 · happy

- Given the alert on, and the link in an email, opened where nobody is signed in
- When the person presses Stop the alerts
- Then the page asks first, then says the alerts are stopped and none still waiting is sent; the choice is off and
  nothing waits
- Test: apps/web/e2e/health-alert.spec.ts

## S407-06 · happy

- Given the alert on
- When a mail app's own Unsubscribe posts the link once, from its own origin and with no session
- Then the alert is stopped, and the answer says so
- Test: apps/web/e2e/health-alert.spec.ts

## S407-07 · invalid

- Given the alert on
- When a report raises the account to Caution, a single rate limit
- Then nothing is queued: only Retreat and above are told
- Test: apps/web/e2e/health-alert.spec.ts

## S407-08 · invalid

- Given the alert on
- When someone opens a stop link whose token isn't one, or a mail app posts it
- Then the page says the link isn't complete and offers no button, the post is refused, and the alert stays on
- Test: apps/web/e2e/health-alert.spec.ts

## S407-09 · invalid

- Given an alert queued for a rise to Retreat
- When later reports carry Retreat again, then Defensive, then Retreat and Defensive again within the day
- Then the same level queues nothing more, Defensive queues one more, and the same rise again within a day queues
  nothing
- Test: apps/web/e2e/health-alert.spec.ts

## S407-10 · error

- Given an alert waiting, and no Resend key in Vault
- When the scheduler's send runs
- Then it sends nothing, the alert keeps waiting, and nothing is recorded as sent
- Test: apps/web/e2e/health-alert.spec.ts

## S407-11 · error

- Given Settings, and a choice that can't be read
- When the card loads
- Then it says the choice couldn't be read and to reload, rather than showing it off, and holds the switch
- Test: apps/web/e2e/health-alert.spec.ts

## S407-12 · error

- Given Settings, and a change that can't reach xomoni.com
- When the person turns the alert on
- Then the card says it couldn't turn the alert on and to try again, and the switch stays off, as stored
- Test: apps/web/e2e/health-alert.spec.ts

## S407-13 · security

- Given one person's alert on, with an alert queued
- When another person signed in asks the Data API for alerts, tokens, levels and the queue, or to send
- Then they see no one else's choice, and are refused the stop token, the levels, the queue and the send; the first
  person's alert is untouched
- Test: apps/web/e2e/health-alert.spec.ts

## S407-14 · security

- Given the alert on
- When the person reloads Settings
- Then no answer the page gets, and nothing on it, holds the stop token: only the email carries it
- Test: apps/web/e2e/health-alert.spec.ts

## S407-15 · security

- Given a job titled with a word only the person wrote, and its account at a full stop
- When the email is read
- Then it says only the person can resume, in Xomoni, and holds neither the job's words nor anything that resumes,
  approves or starts work
- Test: apps/web/e2e/health-alert.spec.ts

## S407-16 · empty

- Given a person who never turned the alert on
- When a report raises their account to Defensive
- Then nothing is queued: the alert is off by default
- Test: apps/web/e2e/health-alert.spec.ts

## S407-17 · empty

- Given a person with no browser connected and no Xomoni
- When they open Settings
- Then Xomoni's own settings say where they live, and the alert's switch is there all the same: it is their account's
  choice
- Test: apps/web/e2e/health-alert.spec.ts

## S407-18 · cancel

- Given the alert on
- When the stop link is opened, as a mail scanner or a person does, and left without pressing anything
- Then the alert stays on
- Test: apps/web/e2e/health-alert.spec.ts

## S407-19 · cancel

- Given the alert turned on, then off again before anything happened
- When a report raises the account to Retreat
- Then nothing is queued
- Test: apps/web/e2e/health-alert.spec.ts

## S407-20 · a11y

- Given Settings
- When the person uses only the keyboard: Tab to the switch, then Space
- Then the alert is on, the switch saying so
- Test: apps/web/e2e/health-alert.spec.ts

## S407-21 · a11y

- Given Settings with the card, and the stop page
- When each is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/health-alert.spec.ts

## S407-22 · browser

- Given a phone's screen
- When the person turns the alert on, then opens the stop page
- Then both fit, with nothing to scroll sideways (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/health-alert.spec.ts

## S407-23 · persistence

- Given the alert turned on
- When the person reloads Settings, and signs in from another browser
- Then both show it on
- Test: apps/web/e2e/health-alert.spec.ts

## S407-24 · invalid

- Given an alert waiting for an account at Retreat
- When the account rests back to Normal before the send runs
- Then the send drops it: an account no longer warned isn't told
- Test: apps/web/e2e/health-alert.spec.ts
