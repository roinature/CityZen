/** Random UUID that works in both Node 19+ and browsers, without a dependency. */
export function newId(): string {
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}
