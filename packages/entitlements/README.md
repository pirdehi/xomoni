# `packages/entitlements`: plans, paid features and `hasPlan()`

Xomoni's plans and the one check of a paid feature ([ADR-0042](../../docs/adr/0042-payments-and-entitlements-with-polar.md)). The extension and xomoni.com import it as `@xomoni/entitlements`, so both decide the same way. Pure: no I/O, no clock and no globals, so every input, the time included, is an argument.

| Export | What it is |
| --- | --- |
| `Tier`, `TIERS` | The plans, from the lowest: `free`, `plus`, `pro`. Pro has everything Plus has. |
| `FEATURES`, `Feature` | Every paid feature, with the plan it needs. R1's are Reach's: `reach-history`, `reach-compare`, `reach-suspects`, `reach-alerts` and `reach-website`, all Plus. Each release adds its own. |
| `ALWAYS_FREE` | What may never be a feature: exporting, deleting and moving one's data, and every safety rail (decision 6 of the ADR). A test checks `FEATURES` against it. |
| `hasPlan(entitlement, feature, now, { live, paywall })` | The one check: whether a paid feature opens. Every paid part asks it, through `PlanGate`. |
| `planAccess(…)`, `tierAccess(…)`, `Access`, `AccessReason` | The same check, with why: `paywall-off`, `preview`, `plan`, `free`, `lower-plan`, `clock` or `unknown-feature`, the plan that counts, the plan needed, and when the plan heard stops counting offline. `tierAccess` asks about a whole plan instead of a feature. |
| `effectiveTier(entitlement, now)` | The plan that counts at `now`: the one heard, until `GRACE_DAYS` (7) after `checkedAt`; then Free. |
| `Entitlement`, `EntitlementStatus`, `entitlementFromAnswer(answer, checkedAt)` | The plan an app heard, and the strict parser of `device_report`'s and `my_entitlement()`'s `entitlement` (`{tier, status, valid_until}`): anything else is null, so the plan the app had stays. |
| `Paywall`, `PAYWALL_VARIABLE`, `paywallFrom(raw)` | The build variable `XOMONI_PAYWALL`: `off` opens every feature, anything else leaves the paywall on. Each app reads it at build time and passes it in. |
| `CatalogEntry`, `CATALOG` | The plans as people see them: a name, a sentence and the features each opens. No price: Polar shows and takes it. |

## The rules `hasPlan` follows, in order

1. A build with `XOMONI_PAYWALL=off` opens every feature, with no badge.
2. Until sales open (`billing_live` is false), every feature opens as a preview, with a *Plus · preview* badge.
3. A feature `FEATURES` doesn't list stays closed.
4. Otherwise the plan that counts must be at least the one the feature needs. It is Free when no plan was heard (a browser not connected, or signed out), when the plan was heard 7 days ago or more, when it was heard at a time still to come (the clock went back), and for a plan this build doesn't know.

Falling back to Free deletes nothing: a plan opens views and never locks data a person already has.

## Used by

- The extension's Reach page (#429): `ui/components/reach/PlusBadge.tsx` says each paid part's plan from `FEATURES` and `planAccess`, *Plus · preview* while sales aren't open. It locks nothing; `PlanGate` (#423) will check `hasPlan` once the plan comes from xomoni.com.

## Rules

- `packages-do-not-import-apps`: this package depends on nothing in `apps/`.
- A paid check anywhere but `hasPlan`, and a safety rail or a way to take one's data out in `FEATURES`, are refused in review (ADR-0042).
- No obfuscation, no hidden check, no licence key: a fork that removes the paywall is accepted.

## Tests

`npm test -w @xomoni/entitlements`, with 100% coverage required: every plan and feature, the preview, the grace on day 6 and day 8, a clock that went back, `XOMONI_PAYWALL=off`, an unknown plan or feature, and the parser's refusals.
