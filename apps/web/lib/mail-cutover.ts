/** The cutover is an absolute instant. The form explicitly displays UTC,
 * never interprets a server UTC string in the operator's local timezone. */
export function cutoverInputUtc(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid stored mail cutover.');
  return date.toISOString().slice(0, 16);
}

export function cutoverUpdate(value: string, previous: string | null | undefined, editing: boolean): string | null | undefined {
  if (value === cutoverInputUtc(previous)) return undefined;
  if (!value) return editing ? null : undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid UTC cutover date and time.');
  const instant = new Date(value + ':00.000Z');
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 16) !== value) throw new Error('Enter a valid UTC cutover date and time.');
  return instant.toISOString();
}
