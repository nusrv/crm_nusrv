/**
 * Normalizes an email address for comparison/lookup (Slice C §18). Matches the exact convention
 * already used by customers.dto.ts's class-transformer `@Transform` for email fields
 * (`String(value).trim().toLowerCase()`) — inbound sender matching must use the same normalization
 * the rest of the application already applies when persisting a CustomerEmailAddress, or a
 * genuinely matching address could fail to correlate purely due to case/whitespace differences.
 */
export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}
