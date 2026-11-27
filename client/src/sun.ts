// Where the sun stands, from the game's date and time: used to keep night-time
// views (the night lights map) on the side of the planet where it is night.

const D = Math.PI / 180;

/** The sun's direction as a unit vector (x toward 0°N 90°E, y north, z toward 0°N 0°E). */
export function sunDir(t: number): [number, number, number] {
  const now = new Date(t);
  const doy = (t - Date.UTC(now.getUTCFullYear(), 0, 1)) / 864e5;
  const dec = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365) * D;
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const lon = -(hours - 12) * 15 * D;
  return [Math.cos(dec) * Math.sin(lon), Math.sin(dec), Math.cos(dec) * Math.cos(lon)];
}

/** A place as a unit vector, in the same frame as sunDir. */
export function unit(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D), Math.cos(lat * D) * Math.cos(lon * D)];
}

/** The sun's height in the sky at a place, -1 (midnight below) to 1 (overhead). */
export function sunHeight(sun: [number, number, number], lat: number, lon: number) {
  const u = unit(lat, lon);
  return u[0] * sun[0] + u[1] * sun[1] + u[2] * sun[2];
}

/** How much it is night, 0 (day) to 1 (full night), with twilight between. */
export const nightness = (h: number) => Math.min(1, Math.max(0, (0.05 - h) / 0.2));

/** A web-mercator night mask: dark where it is night, clear by day. */
export function paintNight(canvas: HTMLCanvasElement, sun: [number, number, number], rgb: [number, number, number] = [3, 7, 16]) {
  const N = 256;
  if (canvas.width !== N) { canvas.width = N; canvas.height = N; }
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / N))) / D;
    for (let x = 0; x < N; x++) {
      const lon = ((x + 0.5) / N) * 360 - 180, o = (y * N + x) * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2];
      d[o + 3] = Math.round(nightness(sunHeight(sun, lat, lon)) * 255);
    }
  }
  g.putImageData(img, 0, 0);
}
