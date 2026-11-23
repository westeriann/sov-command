// Political parties in nations with a parliament or a council. Each stands
// somewhere on liberty (authoritarian -1 .. liberal +1) and openness
// (nationalist -1 .. internationalist +1) and speaks for one group. Their vote
// follows how close they are to what the people believe, how that group feels,
// and, for the governing coalition, how well the country is doing.
import type { Faction } from './society';

export interface PartySpec { name: string; liberty: number; openness: number; base: Faction; colour: string }
export const PARTY_POOL: PartySpec[] = [
  { name: 'Liberal Union', liberty: 0.7, openness: 0.6, base: 'business', colour: '#e0b040' },
  { name: 'Social Democrats', liberty: 0.5, openness: 0.2, base: 'public', colour: '#d0504a' },
  { name: 'Conservative Party', liberty: 0, openness: -0.2, base: 'business', colour: '#4a78c0' },
  { name: 'National Front', liberty: -0.6, openness: -0.8, base: 'military', colour: '#6a4a30' },
  { name: 'Green Alliance', liberty: 0.7, openness: 0.7, base: 'public', colour: '#5aa050' },
  { name: 'Agrarian League', liberty: 0.1, openness: -0.4, base: 'public', colour: '#a0a040' },
  { name: 'Patriotic Bloc', liberty: -0.3, openness: -0.5, base: 'military', colour: '#7a3a5a' },
  { name: 'Reform Movement', liberty: 0.4, openness: 0.4, base: 'business', colour: '#40a0b0' },
  { name: 'Workers\' Party', liberty: 0.1, openness: 0, base: 'public', colour: '#b03030' },
  { name: 'Christian Democrats', liberty: 0.2, openness: 0.1, base: 'business', colour: '#3050a0' },
];

export interface Party { name: string; liberty: number; openness: number; base: Faction; colour: string; seats: number; poll: number; gov: boolean }

export const PARTIES_PER_NATION = 4;
export const COALITION_COST = 30; // political capital to bring a party into government
export const CAMPAIGN_COST = 25; // political capital for a campaign push
export const CAMPAIGN_DAYS = 90; // campaigning opens this long before an election
export const AUTONOMY_COST = 15; // political capital to grant a province autonomy
