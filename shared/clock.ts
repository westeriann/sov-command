import type { ClockInfo } from './protocol';

/** Game time (ms since epoch, UTC) for a real moment, given the world clock. */
export function gameTimeAt(clock: Pick<ClockInfo, 'openedReal' | 'openedGame' | 'speed'>, realMs: number) {
  return clock.openedGame + (realMs - clock.openedReal) * clock.speed;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
