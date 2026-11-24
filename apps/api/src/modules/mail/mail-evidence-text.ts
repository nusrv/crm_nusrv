/** Reject ASCII control bytes in evidence identities and individual MIME header lines. */
export function hasAsciiControl(value: string, allowTab = false): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && !(allowTab && code === 9)) || code === 127) return true;
  }
  return false;
}
