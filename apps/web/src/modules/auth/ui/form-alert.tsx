/** An inline message under a form: an error (`role="alert"`) or a neutral notice (`role="status"`). */
export function FormAlert({ message, tone = 'error' }: { message: string; tone?: 'error' | 'info' }) {
  const toneClass = tone === 'error' ? 'border-critical/30 bg-critical/10' : 'border-accent/30 bg-accent-soft';
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mt-4 rounded-lg border px-3 py-2 text-sm text-ink ${toneClass}`}
    >
      {message}
    </p>
  );
}
