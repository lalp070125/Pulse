/* ULIDs made in the browser: 26 characters, sortable by creation time, unique.
 * The engine never makes IDs (it has no clock and no randomness); the Studio does. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i]! % 32];
  return time + rand;
}
