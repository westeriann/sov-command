// Events with choices: something happens to your nation and you decide how to
// answer. Each option lists its effects (good in green, bad in red, as tooltips
// show them); the server applies the same effects. Unanswered events take the
// first option after EVENT_DAYS. AI governments choose by their character.

export type EventKey =
  | 'strike' | 'scandal' | 'boom' | 'drought' | 'refugees' | 'breakthrough' | 'gold_rush' | 'boomtown'
  | 'oil_find' | 'famine' | 'coup_plot' | 'protests' | 'campaign' | 'investment' | 'storm_damage' | 'spy_caught';

export interface EventOption { text: string; effects: [string, 'good' | 'bad' | 'info'][] }
export interface EventDef { title: string; text: string; options: EventOption[]; image: string }

const G = (t: string): [string, 'good'] => [t, 'good'];
const B = (t: string): [string, 'bad'] => [t, 'bad'];
const I = (t: string): [string, 'info'] => [t, 'info'];

export const EVENTS: Record<EventKey, EventDef> = {
  strike: {
    title: 'General strike', image: '✊',
    text: 'The unions have called a general strike over wages. Ports are idle and factories silent.',
    options: [
      { text: 'Meet their demands', effects: [B('−0.3% of GDP from the treasury'), G('+5 stability'), G('the public is pleased'), B('business is not')] },
      { text: 'Break the strike', effects: [B('−4 stability'), B('the public is angry'), G('the military approves')] },
      { text: 'Wait them out', effects: [B('−0.3% growth for a year'), G('+1 stability')] },
    ],
  },
  scandal: {
    title: 'Corruption scandal', image: '🗞',
    text: 'Reporters have uncovered a minister taking bribes from a defence contractor.',
    options: [
      { text: 'Sack the minister', effects: [B('−20 political capital'), G('+2 stability')] },
      { text: 'Cover it up', effects: [I('half the time it stays buried'), B('otherwise −8 stability and −10 parliament support')] },
      { text: 'Blame the opposition', effects: [B('−8 parliament support'), B('the public sours'), G('+10 political capital')] },
    ],
  },
  boom: {
    title: 'Investment boom', image: '📈',
    text: 'Foreign money is pouring in and building cranes crowd the skyline.',
    options: [
      { text: 'Let it run', effects: [G('+0.6% GDP at once'), B('−2 stability from rising rents')] },
      { text: 'Tax the windfall', effects: [G('+0.5% of GDP to the treasury'), B('business is annoyed')] },
    ],
  },
  drought: {
    title: 'Severe drought', image: '🌵',
    text: 'The rains have failed across the farm belt and reservoirs are running dry.',
    options: [
      { text: 'Buy food abroad', effects: [B('−0.3% of GDP from the treasury'), G('the harvest loss is covered')] },
      { text: 'Tighten belts', effects: [B('food output −6%'), B('−2 stability')] },
    ],
  },
  refugees: {
    title: 'Refugees at the border', image: '⛺',
    text: 'Thousands fleeing the war next door are gathering at our border posts.',
    options: [
      { text: 'Take them in', effects: [G('+0.4% population'), B('−2 stability'), G('the world thinks better of us')] },
      { text: 'Close the border', effects: [G('+1 stability'), B('borders closed to refugees'), B('neighbours think less of us')] },
    ],
  },
  breakthrough: {
    title: 'Laboratory breakthrough', image: '🔬',
    text: 'A national laboratory reports a result that could change a whole field.',
    options: [
      { text: 'Pour it into current research', effects: [G('+500 research points on the current technology (or banked)')] },
      { text: 'Sell the patents', effects: [G('+0.25% of GDP to the treasury')] },
    ],
  },
  gold_rush: {
    title: 'Gold rush', image: '🪙',
    text: 'Prospectors have struck a rich seam. Fortune seekers are flooding into the gold fields.',
    options: [
      { text: 'Let the prospectors in', effects: [G('+0.4% of GDP to the treasury'), B('boom towns may turn lawless')] },
      { text: 'A state monopoly', effects: [G('+0.2% of GDP to the treasury'), B('business is annoyed')] },
    ],
  },
  boomtown: {
    title: 'Lawless boom towns', image: '🤠',
    text: 'The gold towns have no police, no courts and too much whisky.',
    options: [
      { text: 'Send in the police', effects: [B('−2 stability'), G('order restored')] },
      { text: 'Build proper towns', effects: [B('−0.15% of GDP from the treasury'), G('+3 stability')] },
    ],
  },
  oil_find: {
    title: 'Oil discovery', image: '🛢',
    text: 'Survey crews have found a large oil field.',
    options: [
      { text: 'Develop it ourselves', effects: [B('−0.2% of GDP from the treasury'), G('oil output +12%')] },
      { text: 'Sell drilling rights', effects: [G('+0.25% of GDP to the treasury'), G('oil output +4%')] },
    ],
  },
  famine: {
    title: 'Famine', image: '🥣',
    text: 'Food has run short and queues stretch round the block.',
    options: [
      { text: 'Food aid at any price', effects: [B('−0.4% of GDP from the treasury'), G('+3 stability')] },
      { text: 'Ration it', effects: [G('passes the Rationing law at no cost'), B('−2 stability')] },
      { text: 'Appeal to our friends', effects: [G('trade partners send aid'), B('−3 stability while we wait')] },
    ],
  },
  coup_plot: {
    title: 'Plot in the barracks', image: '🎖',
    text: 'Intelligence reports that senior officers are discussing a coup.',
    options: [
      { text: 'Purge the officers', effects: [B('the military is furious'), B('land forces fight 10% weaker for a while'), G('+3 stability')] },
      { text: 'Buy their loyalty', effects: [B('−0.3% of GDP from the treasury'), G('the military is pleased')] },
      { text: 'Ignore the rumours', effects: [B('a real chance of a coup')] },
    ],
  },
  protests: {
    title: 'Mass protests', image: '📢',
    text: 'Crowds fill the main squares demanding the government listen.',
    options: [
      { text: 'Listen and promise reform', effects: [B('−15 political capital'), G('the public is pleased'), G('+2 stability')] },
      { text: 'Disperse them', effects: [G('+2 stability now'), B('the public is angry'), B('liberties erode')] },
      { text: 'Let them march', effects: [B('−3 stability')] },
    ],
  },
  campaign: {
    title: 'Election campaign', image: '🗳',
    text: 'The election is near. What will the governing parties campaign on?',
    options: [
      { text: 'Tax cuts', effects: [G('the government gains in the polls'), B('voters will expect taxes cut by 3 points')] },
      { text: 'More for welfare', effects: [G('the government gains in the polls'), B('voters will expect 5 more points of welfare spending')] },
      { text: 'Our record', effects: [I('gains if stability is above 60, loses below')] },
    ],
  },
  investment: {
    title: 'Foreign investment offer', image: '🤝',
    text: 'A trade partner\'s companies want to build plants here, if we open our markets a little further.',
    options: [
      { text: 'Welcome them', effects: [G('+0.4% GDP'), G('the partner likes us more'), I('our people grow more open')] },
      { text: 'Keep our industry ours', effects: [B('business is annoyed'), G('+1 stability')] },
    ],
  },
  storm_damage: {
    title: 'Storm damage', image: '🌀',
    text: 'The hurricane has left buildings wrecked along the coast.',
    options: [
      { text: 'Rebuild at once', effects: [B('costs the full repair bill now'), G('every damaged building is repaired')] },
      { text: 'Repair them one by one', effects: [I('repair each from its province panel')] },
    ],
  },
  spy_caught: {
    title: 'Foreign agents caught', image: '🕵',
    text: 'Counter-intelligence has arrested a ring of foreign agents.',
    options: [
      { text: 'Expel their diplomats', effects: [B('they think much less of us'), G('their network here is wiped out')] },
      { text: 'Turn them into double agents', effects: [G('we learn about their forces for 60 days'), I('their network here survives, weakened')] },
    ],
  },
};

/** Unanswered events take the first option after this many game days. */
export const EVENT_DAYS = 30;

export interface PendingEvent { key: EventKey; day: number; about?: number }
