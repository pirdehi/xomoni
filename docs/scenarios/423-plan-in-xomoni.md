---
task: 423
title: R1 · CB.4 · The plan in Xomoni, with the offline grace and the Plus parts gated
feature: plan-in-xomoni
---

# The plan in Xomoni

The plan of the xomoni.com account a browser is connected to (#423, [ADR-0042](../adr/0042-payments-and-entitlements-with-polar.md)): heard only from xomoni.com's answer to the status report, kept on this computer with 7 days of grace offline, named in *Your plan* in Settings, and opening Reach's Plus parts, its longer periods and its comparisons, through one gate. Before sales open every part is open as a preview. A closed part deletes nothing. xomoni.com is played at the extension; x.com is served from synthetic fixtures (ADR-0040).

## S423-01 · happy

- Given a person signed in to xomoni.com before sales open, with posts Xomoni saw on X
- When they open Settings, then Reach
- Then *Your plan* says every Plus part is open, free, while Xomoni is in preview
- And Reach's comparisons are open, marked *Plus · preview*
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-02 · happy

- Given a person on Plus once sales are open
- When they open Settings, then Reach
- Then *Your plan* says *Plus*, when it renews and when Xomoni last checked
- And Reach's comparisons are open, marked *Plus*
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-03 · happy

- Given a person on Free whose Reach comparisons are closed
- When they buy Plus on xomoni.com and press *Check now* in *Your plan*
- Then *Your plan* says *Plus* and the comparisons open, with nothing imported again
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-04 · happy

- Given a person on Pro
- When they open Settings, then Reach
- Then *Your plan* says *Pro*, and every Plus part is open
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-05 · invalid

- Given a person on Plus
- When xomoni.com then answers with a plan Xomoni can't read, such as a tier it doesn't know
- Then the plan heard before stays: *Plus*, and the comparisons open
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-06 · invalid

- Given an older xomoni.com that answers the report with no plan at all
- When the person opens Settings, then Reach
- Then nothing changes: *Plus · preview*, and every part open
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-07 · invalid

- Given a plan kept with a check time still to come, as after the computer's clock went back
- When the person opens Reach while xomoni.com can't be reached
- Then the plan counts as Free, and the closed part says to set the clock
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-08 · error

- Given a person on Plus
- When xomoni.com is down and they press *Check now*
- Then the plan heard stays: *Plus*, and Reach's Plus parts open
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-09 · error

- Given a person on Plus whose plan was last heard two days ago, with xomoni.com down since
- When they open Reach
- Then the comparisons stay open, saying *We couldn't check your plan* and until when Plus stays on
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-10 · error

- Given a person on Plus whose plan was last heard 8 days ago, with xomoni.com down since
- When they open Reach, then Settings
- Then the comparisons close, saying nothing was deleted, while the last 30 days still list every post
- And *Your plan* says it counts as Free until Xomoni can check, and that nothing was deleted
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-11 · security

- Given a person on Free
- When a page on x.com posts messages that claim a Pro plan
- Then nothing changes: *Your plan* says *Free*, and the comparisons stay closed
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-12 · security

- Given a person signed in to xomoni.com
- When Xomoni hears the plan, they press *Check now* and open Reach
- Then the only request that leaves Xomoni is xomoni.com's `device_report`
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-13 · security

- Given a person on Free, with a closed part
- When they look at its way to plans, and at *Manage on xomoni.com*
- Then both lead to xomoni.com only (`/pricing`, `/account/billing`), in a new tab that can't reach back
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-14 · empty

- Given a browser never connected to xomoni.com, before sales open
- When the person opens Settings, then Reach
- Then *Your plan* says *Plus · preview*, *Check now* can't be pressed, and every part is open
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-15 · empty

- Given a browser that isn't connected, once sales are open
- When the person opens Settings, then Reach
- Then *Your plan* says *Free* and to connect this browser to use a plan bought on xomoni.com
- And the comparisons are closed
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-16 · cancel

- Given a person who canceled Plus, still within the period paid for
- When they open Settings, then Reach
- Then *Your plan* says when it ends, and the comparisons stay open until then
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-17 · cancel

- Given a person on Plus
- When they sign out of xomoni.com in Settings
- Then Xomoni forgets the plan: *Your plan* says *Free* and the comparisons close
- And Reach's last 30 days still list every post
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-18 · a11y

- Given a person on Free once sales are open
- When axe checks *Your plan* in Settings and Reach with a closed part, in light mode and in dark mode
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-19 · a11y

- Given a person on Plus using the keyboard alone
- When they press Tab through Settings
- Then they reach *Check now* and *Manage on xomoni.com* in *Your plan*
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-20 · browser

- Given a person on Free with the computer in dark mode
- When they open Reach
- Then the closed part reads *This is part of Plus. Your data stays here either way.*, with its way to plans
- Test: apps/web/e2e/extension/plan.spec.ts

## S423-21 · persistence

- Given a person on Plus
- When the dashboard reloads while xomoni.com is down
- Then the plan heard stays: *Plus*, and the comparisons open
- Test: apps/web/e2e/extension/plan.spec.ts
