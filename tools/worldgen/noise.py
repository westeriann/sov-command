"""Vectorised 3D Perlin noise for sampling on a sphere (no seams, no pole pinch)."""
import numpy as np

_GRAD = np.array(
    [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
     [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
     [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
     [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1]],
    dtype=np.float32,
)


class Perlin3:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256).astype(np.int32)
        self.perm = np.concatenate([p, p])

    def _grad(self, h, x, y, z):
        g = _GRAD[h & 15]
        return g[..., 0] * x + g[..., 1] * y + g[..., 2] * z

    def __call__(self, x, y, z):
        perm = self.perm
        xf, yf, zf = np.floor(x), np.floor(y), np.floor(z)
        xi = xf.astype(np.int32) & 255
        yi = yf.astype(np.int32) & 255
        zi = zf.astype(np.int32) & 255
        x, y, z = (x - xf).astype(np.float32), (y - yf).astype(np.float32), (z - zf).astype(np.float32)
        u = x * x * x * (x * (x * 6 - 15) + 10)
        v = y * y * y * (y * (y * 6 - 15) + 10)
        w = z * z * z * (z * (z * 6 - 15) + 10)
        a, b = perm[xi] + yi, perm[xi + 1] + yi
        aa, ab, ba, bb = perm[a] + zi, perm[a + 1] + zi, perm[b] + zi, perm[b + 1] + zi
        g = self._grad
        x1 = g(perm[aa], x, y, z) + u * (g(perm[ba], x - 1, y, z) - g(perm[aa], x, y, z))
        x2 = g(perm[ab], x, y - 1, z) + u * (g(perm[bb], x - 1, y - 1, z) - g(perm[ab], x, y - 1, z))
        y1 = x1 + v * (x2 - x1)
        x3 = g(perm[aa + 1], x, y, z - 1) + u * (g(perm[ba + 1], x - 1, y, z - 1) - g(perm[aa + 1], x, y, z - 1))
        x4 = g(perm[ab + 1], x, y - 1, z - 1) + u * (g(perm[bb + 1], x - 1, y - 1, z - 1) - g(perm[ab + 1], x, y - 1, z - 1))
        y2 = x3 + v * (x4 - x3)
        return y1 + w * (y2 - y1)


def fbm(noise, p, octaves, freq=1.0, gain=0.5, lacunarity=2.0, offset=(0.0, 0.0, 0.0)):
    """Fractal sum. p is a (3, ...) array of unit-sphere points."""
    total = np.zeros(p.shape[1:], dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        f = freq * lacunarity ** o
        total += amp * noise(p[0] * f + offset[0] + o * 17.1,
                             p[1] * f + offset[1] - o * 9.7,
                             p[2] * f + offset[2] + o * 3.3)
        norm += amp
        amp *= gain
    return total / norm


def ridged(noise, p, octaves, freq=1.0, gain=0.5, lacunarity=2.0, offset=(0.0, 0.0, 0.0)):
    """Ridged multifractal: sharp crests, used for mountain ranges. Range ~0..1."""
    total = np.zeros(p.shape[1:], dtype=np.float32)
    amp, norm, weight = 1.0, 0.0, np.ones(p.shape[1:], dtype=np.float32)
    for o in range(octaves):
        f = freq * lacunarity ** o
        n = noise(p[0] * f + offset[0] + o * 5.3, p[1] * f + offset[1] + o * 2.9, p[2] * f + offset[2] - o * 7.7)
        n = (1.0 - np.abs(n)) ** 2
        n *= weight
        weight = np.clip(n * 2.0, 0, 1)
        total += amp * n
        norm += amp
        amp *= gain
    return total / norm


def sphere_points(lat_deg, lon_deg):
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    lat, lon = np.broadcast_arrays(lat, lon)
    cl = np.cos(lat)
    return np.stack([cl * np.cos(lon), cl * np.sin(lon), np.sin(lat)]).astype(np.float32)
