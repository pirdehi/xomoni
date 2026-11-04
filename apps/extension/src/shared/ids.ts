// X's identifiers, checked before Xomoni puts one in a URL or acts on it (#144). Pure.

/** An X id (a post's or an account's): digits only, at most 20, the length of a 64-bit number. */
const X_ID = /^\d{1,20}$/;
/** An X handle: letters, digits and underscores, 1–15 characters. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** Whether `value` is an X id. Anything else, the empty string included, never reaches X's page. */
export const isXId = (value: string) => X_ID.test(value);

/** Whether `value` is a handle X allows. */
export const isHandle = (value: string) => X_HANDLE.test(value);

/** Whether two handles name the same account. X ignores case in handles; an empty one matches nothing. */
export const sameHandle = (a: string, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
