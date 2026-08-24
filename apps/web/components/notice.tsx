export function Notice({
  message,
  tone = 'error',
}: {
  message: string;
  tone?: 'error' | 'success';
}) {
  if (!message) return null;
  return (
    <p className={`notice ${tone === 'error' ? 'notice-error' : 'notice-success'}`}>{message}</p>
  );
}
