# `modules/auth`: identity and sessions

Everything about who is signed in: reading the session, signing in with Google, signing out, and deleting the Xomoni account. Other modules and routes get the signed-in person only through `server/session.ts` (`currentViewer`, `requireViewer`).

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `domain/` | `viewer.ts`, `routes.ts`, `auth-error.ts` | The `Viewer` shape, which paths need a session, `safeNextPath` (open-redirect protection), error codes and the messages people see. Pure. |
| `application/` | `ports.ts`, `use-cases.ts` | The `AuthGateway` port and the use cases (`getViewer`, `startOAuthSignIn`, `completeOAuthSignIn`, `signOut`, `deleteAccount`). |
| `infrastructure/` | `supabase-auth-gateway.ts` | `AuthGateway` on Supabase Auth; maps Supabase error codes to domain codes. |
| `server/` | `deps.ts`, `session.ts`, `actions.ts`, `route-handlers.ts`, `proxy.ts` | Composition root per request; the Data Access Layer; Server Actions; `/auth/callback` and `/auth/signout`; session refresh and redirects in the proxy. |
| `ui/` | `google-button.tsx`, `delete-account.tsx`, `form-alert.tsx` | Sign-in button, account deletion section, inline form messages. |

## Security rules

- Sessions are verified with `getClaims()` (signature-checked JWT), never `getSession()`, on the server.
- Every Server Action re-checks the session; the proxy's redirects are only a convenience.
- `next` parameters pass through `safeNextPath`, so sign-in round trips can't redirect off-site.
- People see domain messages (`AUTH_ERROR_MESSAGES`), worded so they never reveal whether an account exists; provider errors go to server logs only.
- Sign-out is `POST` only.

## Used by

- `app/login`, `app/dashboard`, `app/auth/*` routes and `src/proxy.ts`.
