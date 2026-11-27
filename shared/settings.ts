// The options a game is created with: which map, which mode, and the rest of
// the choices on the create-game screen. They are fixed when the world is
// made and kept with it, so a save or a hosted world always plays as it began.

export type GameMode = 'marathon' | 'dash';
export const GAME_MODES: GameMode[] = ['marathon', 'dash'];
export const MODE_INFO: Record<GameMode, { name: string; research: number; tagline: string; text: string }> = {
  marathon: {
    name: 'Marathon', research: 1, tagline: 'For matches that run over many days',
    text: 'The full pace: the technology tree takes a typical nation about a century of game time, a research-minded one a few decades.',
  },
  dash: {
    name: 'Dash', research: 0.5, tagline: 'For an afternoon',
    text: 'Research costs half as much, so the eras come twice as fast and the far end of the tree is within reach in one sitting.',
  },
};

export interface MapInfo { id: string; name: string; text: string }
/** Maps a game can be played on. Only the Earth for now; custom maps will join this list. */
export const MAPS: MapInfo[] = [
  { id: 'earth', name: 'Earth', text: 'The real planet from its satellite photographs: every nation, its provinces and its cities.' },
];

export interface GameSettings {
  map: string;
  mode: GameMode;
  /** Single player: whether 10× and 20× are offered (they run the world very fast). */
  fast: boolean;
}
export const DEFAULT_SETTINGS: GameSettings = { map: 'earth', mode: 'marathon', fast: false };
/** The fastest a world may run (multiples of 1x) under its settings. */
export const maxSpeed = (s: Pick<GameSettings, 'fast'>) => (s.fast ? 20 : 5);

/** Settings from anywhere (a save, the network, the environment), with anything unknown put back to the default. */
export function normalizeSettings(x: unknown): GameSettings {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<GameSettings>;
  return {
    map: MAPS.some((m) => m.id === o.map) ? o.map! : DEFAULT_SETTINGS.map,
    mode: GAME_MODES.includes(o.mode as GameMode) ? (o.mode as GameMode) : DEFAULT_SETTINGS.mode,
    // worlds made before the switch existed keep every speed they had
    fast: typeof o.fast === 'boolean' ? o.fast : !('mode' in o),
  };
}

/** What the create-game screen sends to start a world: the settings, and choices that only matter at the start. */
export interface NewGame extends GameSettings {
  /** Single player: one autosave, no loading. */
  ironman?: boolean;
  /** Game speed to start at, as a multiple of 1x (a game day every 10 real seconds). */
  speed?: number;
  /** Single player: lead this nation from the first moment (else choose on the map). */
  nation?: number;
  /** Hosting: real minutes a leader may be away before advisers take over (0: never). */
  autopilotMin?: number;
  /** Hosting: real days a leader may be away before the nation goes back to the AI (0: never). */
  releaseDays?: number;
}

/** Speeds offered at the start (multiples of 1x). */
export const START_SPEEDS = [1, 5, 10, 20];
export const HOST_SPEEDS = [1, 2, 5];
export const AUTOPILOT_CHOICES = [15, 60, 360, 0];
export const RELEASE_CHOICES = [1, 7, 30, 0];
