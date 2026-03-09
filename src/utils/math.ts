/**
 * Returns a random index between 0 and length-1.
 */
export function pickRandomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}

/**
 * Returns a random member from a standard Javascript Array.
 */
export function pickRandomMember<T>(list: T[]): T | null {
  if (list.length === 0) return null;
  return list[pickRandomIndex(list.length)] as T;
}