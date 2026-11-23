---
task: 243
title: Send to my computer: user scenarios
feature: send-to-computer
---

# Send to my computer

Xomoni runs on a computer, so on a phone or a tablet xomoni.com offers to send its install guide there (#243): through the phone's share sheet, else by copying the link, else by an email the person writes to themselves. Each way is tried only when the one before failed, never after the person closed the share sheet. The link goes as it is, `/install`: nothing is added to it, and nothing is sent to Xomoni's servers, counted or stored. Xomoni's dialog on a phone (#251) does the same with the page the person is on, with its own scenarios. Written for #345, the features shipped before the scenarios gate.

The tests run xomoni.com in a real browser, told it is a phone by its user agent and its screen, with the share sheet and the clipboard played at the page where a scenario needs them: one that shares, one the person closes, one the browser refuses, or none at all. No account is needed. Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-243
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S243-01 · happy

- Given an iPhone with a share sheet, on the home page
- When the person presses Send to my computer, which stands where the install button would be
- Then the share sheet gets Xomoni, "Open Xomoni on my computer" and the install guide's link, and the page says Sent.
  Open the link on your computer.
- And no request went to any server, no Get the extension shows, and the page fits the screen
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-02 · happy

- Given an iPhone with a share sheet, on /install
- When the person presses Send to my computer in the notice that Xomoni runs on a computer
- Then the install guide's link goes to the share sheet, and the notice says it was sent
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-03 · happy

- Given an Android phone with no share sheet, but a clipboard
- When the person presses Send to my computer
- Then the install guide's address is copied, and the page says Link copied, and to open it on the computer
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-04 · happy

- Given an Android phone that can neither share nor copy
- When the person looks at the home page
- Then Send to my computer is an email to oneself, with the subject Open Xomoni on my computer and the install
  guide's link in it
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-05 · invalid

- Given a store that lists Xomoni, and an iPhone
- When the person opens the home page
- Then no store's button shows, nor Get the extension: a phone can't install it, so both calls to action are Send to
  my computer
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-06 · empty

- Given a computer, even with a window as narrow as a phone's
- When the person opens the home page and /install
- Then nothing is offered to send: the home page keeps Get the extension, and /install its download
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-07 · cancel

- Given an iPhone whose share sheet the person closes
- When they press Send to my computer and close the sheet
- Then the page says nothing, nothing is copied instead, and the button is there to press again
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-08 · error

- Given an iPhone whose share sheet the browser refuses
- When the person presses Send to my computer
- Then the link is copied instead, and the page says so
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-09 · error

- Given an iPhone whose share sheet and clipboard both refuse
- When the person presses Send to my computer
- Then the page says it couldn't share or copy the link here, and offers the email to oneself
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-10 · error

- Given an Android phone with no share sheet, whose clipboard refuses
- When the person presses Send to my computer
- Then the page says it couldn't share or copy, and offers the email to oneself
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-11 · security

- Given an iPhone, on the home page opened with ?utm_source=newsletter&ref=friend#how
- When the person sends the link
- Then the share sheet gets the install guide's address exactly, with nothing of the page's own address added
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-12 · security

- Given an Android phone that copies
- When the person sends the link
- Then no request goes to any server
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-13 · security

- Given an Android phone that can neither share nor copy
- When the person looks at the email Send to my computer would open
- Then it names no recipient, so they write to themselves, and holds only the subject and a body with the link: no
  address of ours, nothing to track
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-14 · a11y

- Given an iPhone with a share sheet, on the home page
- When the person uses only the keyboard: Tab to Send to my computer, then Enter
- Then the link is shared, and the result is a status that screen readers read out
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-15 · a11y

- Given an iPhone
- When the home page and /install are checked with axe
- Then there is no serious or critical violation
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-16 · browser

- Given an iPad
- When the person opens the home page
- Then it offers Send to my computer, and no install button: a tablet can't run Xomoni either (and CI's e2e-edge
  runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-17 · persistence

- Given a link just sent from an iPhone
- When the person reloads the home page
- Then the page starts afresh, saying nothing, and nothing of the send was kept in the browser's storage
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-18 · invalid

- Given an iPhone whose share sheet says it can't take the link
- When the person presses Send to my computer
- Then the share sheet isn't used, and the link is copied instead
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-19 · invalid

- Given a phone that asks for the desktop site, so its browser reads as a Mac's
- When the person opens the home page
- Then xomoni.com takes it for a computer: it offers Get the extension, and nothing to send
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-20 · browser

- Given an iPhone with JavaScript off
- When the person opens the home page, as the server sends it, and follows Get the extension
- Then the page is the general one, a computer's, since the device is read only once the script runs: Get the
  extension is a plain link to /install
- And there, Can I use Firefox, Safari or a phone? is a plain link too, to the answer that phones and tablets can't run
  Xomoni
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-21 · empty

- Given an iPhone
- When the person opens /install
- Then instead of the steps, the page says Xomoni runs on a computer and phones and tablets can't run it, with
  nothing to download, and Send to my computer
- Test: apps/web/e2e/send-to-computer.spec.ts

## S243-22 · cancel

- Given an iPhone whose share sheet the person closed once
- When they press Send to my computer again, and share this time
- Then the share sheet opens again, and the link is sent once
- Test: apps/web/e2e/send-to-computer.spec.ts
