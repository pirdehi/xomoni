'use client';
// Who is signed in on this browser, as its session cookie says (`watchSessionEmail`): for what a page shows, never for
// what it allows. Shared by the header's account corner and the getting-started checklist (#244).
import { useEffect, useState } from 'react';
import { watchSessionEmail } from '@/shared/supabase/browser-session';

/** The signed-in person on this browser. */
export interface SessionPerson {
  email: string;
  /** The display name; empty when none was given. */
  name: string;
}

/** The signed-in person, null for a visitor, or undefined until the cookie is read. Follows sign-ins and sign-outs. */
export function useSession(): SessionPerson | null | undefined {
  const [person, setPerson] = useState<SessionPerson | null | undefined>(undefined);
  useEffect(() => watchSessionEmail((email, name = '') => setPerson(email === null ? null : { email, name })), []);
  return person;
}
