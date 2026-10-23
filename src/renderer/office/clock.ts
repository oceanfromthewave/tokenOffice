export interface ClockAngles { hour: number; minute: number; second: number }

/** Angles are in radians, measured clockwise from 12 o'clock. */
export function clockAngles(now: Date): ClockAngles {
  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  return {
    hour: hours * (Math.PI / 6),
    minute: minutes * (Math.PI / 30),
    second: now.getSeconds() * (Math.PI / 30),
  };
}
