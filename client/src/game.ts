// Client-side copy of what the server has told us. The server is the
// authority; this store only applies its messages and notifies the HUD.
import { gameTimeAt } from '../../shared/clock';
import type { SeasonInfo, WorldState } from '../../shared/protocol';
import type { EconomyPublic, MarketSnapshot  } from '../../shared/economy';
import type { UnitView } from '../../shared/military';
import type {
  ChatLine, ClockInfo, EconomyUpdate, Me, NationPrivate, NationPublic, ServerMsg, WarState, WorldEvent,
} from '../../shared/protocol';
import { GAME_SPEED, gameNow as offlineNow } from './config';

export type Status = 'offline' | 'connecting' | 'online';
export type Change = 'status' | 'me' | 'nations' | 'mine' | 'events' | 'chat' | 'online' | 'error' | 'economy' | 'units' | 'war';
type Listener = (changes: Set<Change>) => void;

export class Game {
  status: Status = 'offline';
  me: Me | null = null;
  nations = new Map<number, NationPublic>();
  mine: NationPrivate | null = null;
  events: WorldEvent[] = [];
  chat: ChatLine[] = [];
  online = 0;
  clock: ClockInfo | null = null;
  offset = 0; // server clock minus local clock, ms
  unreadChat = 0;
  lastError: string | null = null;
  economy = new Map<number, EconomyPublic>();
  market: MarketSnapshot | null = null;
  season: SeasonInfo | null = null;
  world: WorldState | null = null;
  units: UnitView[] = [];
  war: WarState = { wars: [], occupied: {}, battles: [], treaties: [], owners: {}, buildings: {}, nuked: [], embargoes: [], unrest: {}, blocs: [], council: [], vassals: {} };

  treaty(kind: 'alliance' | 'trade', a: number | undefined, b: number | undefined) {
    return !!a && !!b && this.war.treaties.some((t) => t.kind === kind && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  }

  atWar(a: number | undefined, b: number | undefined) {
    return !!a && !!b && this.war.wars.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }
  private listeners = new Set<Listener>();

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(...changes: Change[]) {
    const set = new Set(changes);
    for (const fn of this.listeners) fn(set);
  }

  setStatus(s: Status) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status');
  }

  reset() {
    this.me = null;
    this.mine = null;
    this.nations.clear();
    this.events = [];
    this.chat = [];
    this.online = 0;
    this.clock = null;
    this.economy.clear();
    this.units = [];
    this.war = { wars: [], occupied: {}, battles: [], treaties: [], owners: {}, buildings: {}, nuked: [], embargoes: [], unrest: {}, blocs: [], council: [], vassals: {} };
    this.market = null;
    this.emit('me', 'mine', 'nations', 'events', 'chat', 'online', 'economy');
  }

  get speed() {
    return this.clock?.speed ?? GAME_SPEED;
  }

  gameNow() {
    return this.clock ? new Date(gameTimeAt(this.clock, Date.now() + this.offset)) : offlineNow();
  }

  apply(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':
        this.me = msg.you;
        this.clock = msg.clock;
        this.offset = msg.clock.serverNow - Date.now();
        this.nations = new Map(msg.nations.map((n) => [n.id, n]));
        this.mine = msg.mine;
        this.events = msg.events;
        this.chat = msg.chat;
        this.online = msg.online;
        this.applyEconomy(msg.economy);
        this.units = msg.units;
        this.war = msg.war;
        this.setStatus('online');
        this.emit('me', 'nations', 'mine', 'events', 'chat', 'online', 'economy', 'units', 'war');
        break;
      case 'units':
        this.units = msg.units;
        this.emit('units');
        break;
      case 'war':
        this.war = msg.war;
        this.emit('war');
        break;
      case 'economy':
        this.applyEconomy(msg.economy);
        this.emit('economy');
        break;
      case 'you':
        this.me = msg.you;
        this.emit('me');
        break;
      case 'nation':
        this.nations.set(msg.nation.id, msg.nation);
        this.emit('nations');
        break;
      case 'mine':
        this.mine = msg.nation;
        this.emit('mine');
        break;
      case 'event':
        this.events.push(msg.event);
        if (this.events.length > 200) this.events.splice(0, 100);
        this.emit('events');
        break;
      case 'chat':
        this.chat.push(msg.line);
        if (this.chat.length > 200) this.chat.splice(0, 100);
        this.unreadChat++;
        this.emit('chat');
        break;
      case 'online':
        this.online = msg.count;
        this.emit('online');
        break;
      case 'pong': {
        const rtt = Date.now() - msg.at;
        this.offset = msg.serverNow + rtt / 2 - Date.now();
        break;
      }
      case 'error':
        this.lastError = msg.message;
        this.emit('error');
        break;
    }
  }

  private applyEconomy(u: EconomyUpdate) {
    // weekly broadcasts carry only the newest price point: append it to what we have
    const prev = this.market;
    if (prev && u.market.history.length <= 1) {
      const history = [...prev.history];
      for (const h of u.market.history) if (!history.length || history[history.length - 1].d < h.d) history.push(h);
      this.market = { ...u.market, history: history.slice(-260) };
    } else {
      this.market = u.market;
    }
    this.economy = new Map(u.nations.map((n) => [n.id, n]));
    if (u.season) this.season = u.season;
    if (u.world) this.world = u.world;
  }

  humanNations() {
    return [...this.nations.values()].filter((n) => n.controller === 'human');
  }
}
