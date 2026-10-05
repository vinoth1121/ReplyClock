/**
 * ReplyClock deterministic seed data.
 *
 * Every number here comes from a seeded `mulberry32` stream plus the injected
 * `now`: no `Math.random`, no ambient clock read. The same `now` therefore always
 * produces an identical bundle, which is what makes the console testable.
 *
 * The dataset is shaped to tell the product's story rather than to look random:
 * the `CTWA-Loan-EMI-0` ad floods the queue with low-intent clicks, the referral
 * ad closes, and the leads past the 60 minute SLA line are exactly the ones that
 * were never assigned to anyone.
 */

import type {
  ChatMessage,
  Lead,
  LeadNote,
  ResponsePoint,
  SeedBundle,
  Stage,
  StageEvent,
  TeamMember,
} from '@/types';
import { STAGE_ORDER } from '@/types';
import { formatDay, formatINR } from '@/lib/format';

/** Base PRNG seed for the lead stream. */
export const SEED = 1_337_042;

/** Separate fixed stream for the response-time series, so the two never drift. */
const HISTORY_SEED = 6_061_888;

const MINUTE_MS = 60_000;
const LEAD_COUNT = 60;
const ID_BASE = 1001;

/** Leads newer than this are the "live ticking" ones. */
const LIVE_WINDOW_MINUTES = 180;
/** Nothing newer than this is ever picked as a closed lead. */
const OLD_LEAD_MINUTES = 210;
const CLOSED_TOTAL = 18;

/** Wait buckets, in the order the queue would escalate them. */
const BUCKET_FRESH = 0;
const BUCKET_WARN = 1;
const BUCKET_BREACH = 2;

const WAIT_FRESH_TARGET = 4;
const WAIT_WARN_TARGET = 5;
const WAIT_BREACH_TARGET = 6;

/** Every team member: four online, exactly one away. */
const TEAM: readonly TeamMember[] = [
  { id: 'tm-priya', name: 'Priya Sharma', role: 'Sales Lead', online: true, initials: 'PS' },
  { id: 'tm-rahul', name: 'Rahul Verma', role: 'Senior AE', online: true, initials: 'RV' },
  { id: 'tm-ananya', name: 'Ananya Iyer', role: 'Account Executive', online: true, initials: 'AI' },
  { id: 'tm-vikram', name: 'Vikram Rao', role: 'Account Executive', online: false, initials: 'VR' },
  { id: 'tm-sneha', name: 'Sneha Kulkarni', role: 'SDR', online: true, initials: 'SK' },
];

const TEAM_BY_ID: ReadonlyMap<string, TeamMember> = new Map(
  TEAM.map((member) => [member.id, member]),
);

interface SourceProfile {
  readonly name: string;
  /** Leads attributed to this ad out of the 60. */
  readonly volume: number;
  /** Leads that reached `closed`. */
  readonly closed: number;
  /** Reply-speed multiplier; below 1 means the ad brings warmer leads. */
  readonly replySpeed: number;
}

const SOURCE_PROFILES: readonly SourceProfile[] = [
  { name: 'CTWA-Diwali-Offer', volume: 12, closed: 4, replySpeed: 1.0 },
  { name: 'CTWA-Republic-Day-Sale', volume: 10, closed: 2, replySpeed: 1.35 },
  { name: 'CTWA-Same-Day-Install', volume: 8, closed: 4, replySpeed: 0.95 },
  { name: 'CTWA-Loan-EMI-0', volume: 18, closed: 2, replySpeed: 1.85 },
  { name: 'CTWA-Free-Demo-Request', volume: 7, closed: 3, replySpeed: 0.8 },
  { name: 'CTWA-Referral-Cashback', volume: 5, closed: 3, replySpeed: 0.68 },
];

const SOURCES: readonly string[] = SOURCE_PROFILES.map((profile) => profile.name);

const FALLBACK_PROFILE: SourceProfile = {
  name: 'CTWA-Diwali-Offer',
  volume: 0,
  closed: 0,
  replySpeed: 1,
};

/** Weighted owner assignment: the two floor hitters carry most of the load. */
const OWNER_POOL: readonly string[] = [
  'tm-rahul',
  'tm-rahul',
  'tm-rahul',
  'tm-ananya',
  'tm-ananya',
  'tm-ananya',
  'tm-priya',
  'tm-priya',
  'tm-vikram',
  'tm-sneha',
  'tm-sneha',
  'tm-rahul',
];

const FIRST_NAMES: readonly string[] = [
  'Aarav',
  'Ananya',
  'Rohan',
  'Meera',
  'Karthik',
  'Divya',
  'Arjun',
  'Neha',
  'Rahul',
  'Priya',
  'Sanjay',
  'Kavya',
  'Imran',
  'Lakshmi',
  'Vikram',
  'Sneha',
  'Aditya',
  'Pooja',
  'Rajesh',
  'Nisha',
  'Farhan',
  'Anjali',
  'Manish',
  'Shreya',
  'Girish',
  'Bhavana',
  'Nikhil',
  'Ritu',
  'Abhay',
  'Shruti',
  'Ishaan',
  'Tanvi',
  'Harsh',
  'Vidya',
  'Sameer',
  'Reema',
  'Akash',
  'Nandini',
  'Varun',
  'Deepa',
  'Mohit',
  'Sunita',
  'Gaurav',
  'Preeti',
];

const SURNAMES: readonly string[] = [
  'Sharma',
  'Verma',
  'Iyer',
  'Rao',
  'Kulkarni',
  'Nair',
  'Patel',
  'Reddy',
  'Bose',
  'Menon',
  'Gill',
  'Chawla',
  'Joshi',
  'Desai',
  'Malhotra',
];

const CITIES: readonly string[] = [
  'Mumbai',
  'Delhi',
  'Bengaluru',
  'Hyderabad',
  'Pune',
  'Chennai',
  'Kolkata',
  'Ahmedabad',
  'Jaipur',
  'Lucknow',
  'Indore',
  'Kochi',
  'Chandigarh',
  'Bhubaneswar',
  'Coimbatore',
  'Nagpur',
  'Surat',
  'Visakhapatnam',
  'Bhopal',
  'Guwahati',
];

interface ProductSpec {
  readonly name: string;
  readonly prices: readonly number[];
}

const PRODUCTS: readonly ProductSpec[] = [
  { name: 'Modular Sofa', prices: [45999, 78999, 124999] },
  { name: 'Split AC 1.5 Ton', prices: [24999, 45999, 78999] },
  { name: 'Diamond Ring 1.21ct', prices: [249999, 499999, 1250000] },
  { name: 'Laptop Stand', prices: [1499, 2499] },
  { name: 'Water Purifier', prices: [12999, 24999, 45999] },
  { name: 'Sofa Recliner', prices: [78999, 124999, 249999] },
  { name: 'iPhone 15 Case', prices: [1499, 2499] },
  { name: 'Air Fryer 6L', prices: [2499, 12999] },
  { name: 'Gaming Laptop RTX', prices: [124999, 249999] },
  { name: 'Wedding Package', prices: [249999, 499999, 1250000] },
  { name: 'Scooter Insurance', prices: [1499, 2499, 12999] },
  { name: 'Electric Bike', prices: [78999, 124999] },
  { name: 'Yoga Mat Bundle', prices: [1499, 2499] },
  { name: 'Chef Knife Set', prices: [2499, 12999] },
];

const GREETINGS: readonly string[] = [
  'Hi,',
  'Hello,',
  'Hi there,',
  'Good morning,',
  'Namaste,',
  'Hey, just saw your ad on WhatsApp.',
];

const INBOUND_LINES: readonly string[] = [
  'I am interested in the {product}. Is it available for delivery in {city}?',
  'Saw the ad for the {product} - what is the best price you can do on it?',
  'Looking at the {product}, my budget is around {amount}. Anything in that range?',
  'Does the {product} come with installation in {city}, or is that charged extra?',
  'Please share the full price list for the {product}.',
  'I saw your ad for the {product}. When can someone call me today?',
  'Interested in the {product} for my home in {city}. How soon can it be delivered?',
  'Can you confirm the {product} is in stock? I can pay {amount} upfront if it is.',
  'Got your ad for the {product}. I need it before the weekend here in {city}.',
  'Tell me about the {product} - is exchange of an old unit possible?',
];

const INBOUND_FOLLOWUPS: readonly string[] = [
  'Any update? Please reply, I am still waiting.',
  'Hello? I sent an enquiry a little while back.',
  'Kindly respond, I need to confirm this today.',
  'Just following up on the enquiry above.',
  'Are you there? I could not reach your number earlier.',
];

const OUTBOUND_LINES: readonly string[] = [
  'Hi {name}, thanks for your interest in the {product}. It is in stock and we deliver across {city} - what is a good time to call?',
  'Hello {name}, this is the {product} desk. I can share a full quote right here, what is your preferred budget range?',
  'Hi {name}, noted your enquiry about the {product}. Sending options on this chat now, please confirm your delivery slot in {city}.',
  'Hello {name}, thanks for reaching out. The {product} is available - would you like the {amount} option or something lower?',
  'Hi {name}, thanks for clicking our ad for the {product}. Is {city} the correct delivery address?',
  'Good day {name}, we have noted your interest in the {product}. A detailed quote follows on this chat within the hour.',
];

const OUTBOUND_FOLLOWUPS: readonly string[] = [
  'Also, EMI is available on this - roughly {emi} per month, no paperwork from your side.',
  'Sending the catalogue and a payment link on this chat as well.',
  'Our last two deliveries in {city} were done within three days.',
  'If you confirm today we can hold the {amount} pricing for you until tomorrow.',
];

const NOTE_TEXTS: readonly string[] = [
  'Wants delivery before Diwali.',
  'Comparing against two competitors.',
  'Asked for EMI options.',
  'Hot lead - replied within four minutes.',
  'Budget may stretch if delivery happens this week.',
  'Asked for a video walkthrough of the showroom.',
  'Follow up after 6 PM, office hours.',
  'Says the current unit is out of warranty.',
  'Wants the quote in writing on WhatsApp.',
  'Family decision, spouse will confirm.',
  'Referred by an existing customer.',
  'Asked about exchange value for the old unit.',
];

/** Ages (minutes before 
ow) of the twenty still-live leads. */
const LIVE_AGES: readonly number[] = [
  3, 6, 9, 13, 17, 21, 26, 31, 36, 41, 46, 52, 58, 63, 70, 79, 92, 108, 127, 149,
];

/** Fixed day indices (0 = today) that blow past the 60 minute SLA line. */
const HISTORY_OUTLIERS: readonly number[] = [9, 4];

/** Deterministic `[0, 1)` PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Uniform integer in the inclusive range `[min, max]`. */
function int(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

/** Uniform element of a non-empty pool. */
function pick<T>(rnd: () => number, items: readonly T[]): T {
  const value = items[Math.floor(rnd() * items.length)];
  if (value === undefined) throw new Error('seed: cannot pick from an empty pool');
  return value;
}

/** True with probability `p`. */
function chance(rnd: () => number, p: number): boolean {
  return rnd() < p;
}

/** Fisher-Yates on a copy: the same input always yields the same order. */
function shuffle<T>(rnd: () => number, items: readonly T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const held = copy[i];
    const picked = copy[j];
    if (held === undefined || picked === undefined) continue;
    copy[i] = picked;
    copy[j] = held;
  }
  return copy;
}

/** Standard normal deviate via Box-Muller. */
function gaussian(rnd: () => number): number {
  const u1 = Math.max(rnd(), Number.EPSILON);
  const u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-normal deviate, median `exp(mu)`: how reply times actually behave. */
function logNormal(rnd: () => number, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * gaussian(rnd));
}

function profileFor(source: string): SourceProfile {
  return SOURCE_PROFILES.find((profile) => profile.name === source) ?? FALLBACK_PROFILE;
}

function ownerName(ownerId: string | null): string {
  if (ownerId === null) return 'unassigned';
  return TEAM_BY_ID.get(ownerId)?.name ?? 'unassigned';
}

/** Interpolates `{token}` placeholders; unknown tokens collapse to nothing. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? '');
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/** Jitters a live age so the designed wait bucket can never leak across a line. */
function jitterLiveAge(age: number, rnd: () => number): number {
  if (age < 30) return 2.5 + rnd() * 25.5;
  if (age < 60) return 31 + rnd() * 28;
  return 62 + rnd() * 86;
}

/** Twenty live leads plus forty spread from 3.5 hours to 16 days back. */
function buildAges(rnd: () => number): number[] {
  const ages = LIVE_AGES.map((age) => jitterLiveAge(age, rnd));
  const older = LEAD_COUNT - ages.length;
  const span = 16 * 24 * 60 - OLD_LEAD_MINUTES;
  for (let i = 0; i < older; i += 1) {
    const t = (i + rnd()) / older;
    ages.push(OLD_LEAD_MINUTES + Math.pow(t, 1.45) * span);
  }
  return ages.sort((a, b) => a - b);
}

/**
 * Exact per-ad volumes, with each ad's closed-lead quota reserved inside the
 * older pool first, so no ad ever has to close a three hour old lead.
 */
function assignSources(rnd: () => number, ages: readonly number[]): string[] {
  const older: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < LEAD_COUNT; i += 1) {
    if ((ages[i] ?? 0) >= OLD_LEAD_MINUTES) older.push(i);
    else rest.push(i);
  }

  const sources: string[] = new Array<string>(LEAD_COUNT).fill('');
  const head = shuffle(rnd, older);
  let cursor = 0;
  const reserve = (name: string, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      const index = head[cursor];
      cursor += 1;
      if (index === undefined) break;
      sources[index] = name;
    }
  };

  for (const profile of SOURCE_PROFILES) reserve(profile.name, profile.closed);
  const tail = shuffle(rnd, older.concat(rest)).filter((index) => (sources[index] ?? '') === '');
  let tailCursor = 0;
  for (const profile of SOURCE_PROFILES) {
    for (let i = 0; i < profile.volume - profile.closed; i += 1) {
      const index = tail[tailCursor];
      tailCursor += 1;
      if (index === undefined) break;
      sources[index] = profile.name;
    }
  }
  return sources;
}

/** Each ad closes its own oldest leads, so every close rate is exact by design. */
function chooseClosedSlots(
  rnd: () => number,
  ages: readonly number[],
  sources: readonly string[],
): Set<number> {
  const closed = new Set<number>();
  let outstanding = CLOSED_TOTAL;
  for (const profile of SOURCE_PROFILES) {
    const group: number[] = [];
    for (let i = 0; i < LEAD_COUNT; i += 1) {
      if (sources[i] === profile.name && (ages[i] ?? 0) >= OLD_LEAD_MINUTES) group.push(i);
    }
    const shuffled = shuffle(rnd, group);
    for (let k = 0; k < profile.closed; k += 1) {
      const index = shuffled[k];
      if (index === undefined) break;
      closed.add(index);
      outstanding -= 1;
    }
  }
  for (let i = LEAD_COUNT - 1; i >= 0 && outstanding > 0; i -= 1) {
    if (closed.has(i)) continue;
    closed.add(i);
    outstanding -= 1;
  }
  return closed;
}

/** Explicit wait buckets: four fresh, five warning, six already in breach. */
function chooseWaitingSlots(
  rnd: () => number,
  ages: readonly number[],
  closed: ReadonlySet<number>,
): Map<number, number> {
  const fresh: number[] = [];
  const warn: number[] = [];
  const breach: number[] = [];
  for (let i = 0; i < LEAD_COUNT; i += 1) {
    if (closed.has(i)) continue;
    if ((ages[i] ?? 0) >= LIVE_WINDOW_MINUTES) continue;
    const age = ages[i] ?? 0;
    if (age < 30) fresh.push(i);
    else if (age < 60) warn.push(i);
    else breach.push(i);
  }

  const waiting = new Map<number, number>();
  const take = (pool: readonly number[], count: number, bucket: number): void => {
    const shuffled = shuffle(rnd, pool);
    for (let i = 0; i < count && i < shuffled.length; i += 1) {
      const index = shuffled[i];
      if (index !== undefined) waiting.set(index, bucket);
    }
  };
  take(fresh, WAIT_FRESH_TARGET, BUCKET_FRESH);
  take(warn, WAIT_WARN_TARGET, BUCKET_WARN);
  take(breach, WAIT_BREACH_TARGET, BUCKET_BREACH);
  return waiting;
}
/**
 * 18 new / 15 talks / 9 negotiation / 18 closed. Waiting leads are always `new`;
 * among the replied ones the live leads take the remaining `new` slots, so a
 * three minute old lead is never parked in a stage its age cannot support.
 */
function assignStages(
  rnd: () => number,
  ages: readonly number[],
  closed: ReadonlySet<number>,
  waiting: ReadonlyMap<number, number>,
): Stage[] {
  const slots: (Stage | null)[] = new Array<Stage | null>(LEAD_COUNT).fill(null);
  const liveReplied: number[] = [];
  const olderReplied: number[] = [];

  for (let i = 0; i < LEAD_COUNT; i += 1) {
    if (closed.has(i)) {
      slots[i] = 'closed';
      continue;
    }
    if (waiting.has(i)) {
      slots[i] = 'new';
      continue;
    }
    if ((ages[i] ?? 0) < LIVE_WINDOW_MINUTES) liveReplied.push(i);
    else olderReplied.push(i);
  }

  const live = shuffle(rnd, liveReplied);
  for (let i = 0; i < live.length; i += 1) {
    const index = live[i];
    if (index === undefined) continue;
    slots[index] = i < 3 ? 'new' : i < 5 ? 'talks' : 'negotiation';
  }

  const older = shuffle(rnd, olderReplied);
  for (let i = 0; i < older.length; i += 1) {
    const index = older[i];
    if (index === undefined) continue;
    slots[index] = i < 13 ? 'talks' : i < 22 ? 'negotiation' : 'new';
  }

  return slots.map((stage) => stage ?? 'new');
}

/** About 17% unassigned, weighted onto `new` and onto the breached leads. */
function assignOwners(
  rnd: () => number,
  waiting: ReadonlyMap<number, number>,
  stages: readonly Stage[],
): (string | null)[] {
  const forced = new Set<number>();
  const liveWaiting: number[] = [];
  for (const [index, bucket] of waiting) {
    if (bucket === BUCKET_BREACH) forced.add(index);
    else liveWaiting.push(index);
  }

  const stillOpen = shuffle(rnd, liveWaiting);
  for (let i = 0; i < 2; i += 1) {
    const index = stillOpen[i];
    if (index !== undefined) forced.add(index);
  }

  const hot: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < LEAD_COUNT; i += 1) {
    if (forced.has(i) || waiting.has(i)) continue;
    if (stages[i] === 'new') hot.push(i);
    else rest.push(i);
  }
  const candidates = shuffle(rnd, hot.concat(rest));
  for (let i = 0; i < 2; i += 1) {
    const index = candidates[i];
    if (index !== undefined) forced.add(index);
  }

  const owners: (string | null)[] = [];
  for (let i = 0; i < LEAD_COUNT; i += 1) owners.push(forced.has(i) ? null : pick(rnd, OWNER_POOL));
  return owners;
}

/** First-reply delay: log-normal, faster for good ads, slower when unowned. */
function replyDelayMinutes(
  rnd: () => number,
  speed: number,
  ownerId: string | null,
  ageMinutes: number,
): number {
  let minutes = logNormal(rnd, Math.log(16) + Math.log(speed), 0.9);
  if (ownerId === null) minutes *= 1.55;
  if (ownerId === 'tm-vikram') minutes *= 1.3;
  const ceiling = Math.max(0.5, Math.min(180, ageMinutes - 0.5));
  return Math.round(Math.min(minutes, ceiling) * 10) / 10;
}

function uniqueName(rnd: () => number, used: Set<string>): string {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = `${pick(rnd, FIRST_NAMES)} ${pick(rnd, SURNAMES)}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${pick(rnd, FIRST_NAMES)} ${pick(rnd, SURNAMES)} ${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function uniquePhone(rnd: () => number, used: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const lead = 6 + Math.floor(rnd() * 4);
    const rest = int(rnd, 0, 999_999_999).toString().padStart(9, '0');
    const phone = `91${lead}${rest}`;
    if (!used.has(phone)) {
      used.add(phone);
      return phone;
    }
  }
  let n = used.size + 1;
  while (used.has(`918${n.toString().padStart(9, '0')}`)) n += 1;
  const phone = `918${n.toString().padStart(9, '0')}`;
  used.add(phone);
  return phone;
}

function uniqueCity(rnd: () => number, previous: string | null): string {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const city = pick(rnd, CITIES);
    if (city !== previous) return city;
  }
  return pick(rnd, CITIES);
}

interface LeadPlan {
  readonly ageMinutes: number;
  readonly source: string;
  readonly stage: Stage;
  readonly ownerId: string | null;
  readonly waiting: boolean;
}

function buildTranscript(
  rnd: () => number,
  now: number,
  id: string,
  leadName: string,
  product: string,
  city: string,
  amountInr: number,
  createdMs: number,
  replyMs: number | null,
): ChatMessage[] {
  const vars: Record<string, string> = {
    product,
    city,
    amount: formatINR(amountInr),
    emi: formatINR(Math.max(100, Math.round(amountInr / 14 / 100) * 100)),
    name: leadName,
  };
  const messages: ChatMessage[] = [];
  let cursor = createdMs - 1000;

  const pushAt = (direction: 'in' | 'out', text: string, at: number): void => {
    const stamp = Math.min(now - 1000, Math.max(cursor + 1000, at));
    messages.push({ id: `${id}-m${messages.length + 1}`, direction, at: isoAt(stamp), text });
    cursor = stamp;
  };
  const push = (direction: 'in' | 'out', text: string, gapSeconds: number): void => {
    pushAt(direction, text, cursor + gapSeconds * 1000);
  };
  let said = '';
  const say = (pool: readonly string[]): string => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const text = fill(pick(rnd, pool), vars);
      if (text !== said) {
        said = text;
        return text;
      }
    }
    return said;
  };

  pushAt('in', `${pick(rnd, GREETINGS)} ${say(INBOUND_LINES)}`, createdMs);

  if (replyMs === null) {
    const headroom = Math.floor((now - cursor) / (MINUTE_MS / 2));
    const followUps = Math.min(chance(rnd, 0.65) ? 2 : 1, Math.max(1, headroom));
    for (let i = 0; i < followUps; i += 1) {
      push('in', say(INBOUND_FOLLOWUPS), int(rnd, 40, 260));
    }
    return messages;
  }

  pushAt('out', say(OUTBOUND_LINES), replyMs);
  if (chance(rnd, 0.55) && now - cursor > 2 * MINUTE_MS) {
    push('in', say(INBOUND_FOLLOWUPS), int(rnd, 120, 900));
    if (chance(rnd, 0.6) && now - cursor > 2 * MINUTE_MS) {
      push('out', say(OUTBOUND_FOLLOWUPS), int(rnd, 90, 600));
    }
  }
  if (chance(rnd, 0.3) && now - cursor > 2 * MINUTE_MS && messages.length < 5) {
    push('out', say(OUTBOUND_FOLLOWUPS), int(rnd, 45, 300));
  }
  return messages;
}

function buildTimeline(
  rnd: () => number,
  stage: Stage,
  createdMs: number,
  fromMs: number,
  endMs: number,
  ownerId: string | null,
): StageEvent[] {
  const limit = STAGE_ORDER.indexOf(stage);
  const path = STAGE_ORDER.filter((candidate) => STAGE_ORDER.indexOf(candidate) <= limit);
  const events: StageEvent[] = [];
  const steps = path.length - 1;
  const start = Math.min(Math.max(createdMs, fromMs), endMs);
  let previous = createdMs;

  for (let i = 0; i < path.length; i += 1) {
    const current = path[i];
    if (current === undefined) continue;
    if (i === 0) {
      events.push({ stage: current, at: isoAt(createdMs), by: 'system' });
      continue;
    }
    const ideal = start + Math.round(Math.max(0, endMs - start) * ((i - 1 + rnd() * 0.8) / steps));
    previous = Math.min(endMs, Math.max(previous + MINUTE_MS, Math.max(start, ideal)));
    events.push({ stage: current, at: isoAt(previous), by: ownerName(ownerId) });
  }
  return events;
}

function buildNotes(
  rnd: () => number,
  now: number,
  id: string,
  stage: Stage,
  createdMs: number,
  anchorMs: number,
  ownerId: string | null,
): LeadNote[] {
  let count = 0;
  if (stage === 'new') count = chance(rnd, 0.2) ? 1 : 0;
  else count = chance(rnd, 0.3) ? 0 : chance(rnd, 0.6) ? 1 : int(rnd, 2, 3);

  const notes: LeadNote[] = [];
  let cursor = Math.min(now, Math.max(createdMs, anchorMs));
  for (let i = 0; i < count; i += 1) {
    const stamp = Math.min(now, cursor + int(rnd, 120, 3600) * 1000);
    const safeAt = stamp > createdMs ? stamp : createdMs;
    const by = ownerId === null ? pick(rnd, TEAM).name : ownerName(ownerId);
    notes.push({ id: `${id}-n${i + 1}`, at: isoAt(safeAt), by, text: pick(rnd, NOTE_TEXTS) });
    cursor = Math.max(cursor, safeAt);
  }
  return notes;
}

function buildLead(
  index: number,
  plan: LeadPlan,
  now: number,
  rnd: () => number,
  usedNames: Set<string>,
  usedPhones: Set<string>,
  lastCity: string | null,
): { lead: Lead; city: string } {
  const id = `LD-${ID_BASE + index}`;
  const createdMs = Math.round(now - plan.ageMinutes * MINUTE_MS);
  const name = uniqueName(rnd, usedNames);
  const city = uniqueCity(rnd, lastCity);
  const product = PRODUCTS[index] ?? pick(rnd, PRODUCTS);
  const amountInr = pick(rnd, product.prices);
  const replyMs = plan.waiting
    ? null
    : createdMs +
      Math.round(
        replyDelayMinutes(rnd, profileFor(plan.source).replySpeed, plan.ownerId, plan.ageMinutes) *
          MINUTE_MS,
      );
  const anchorMs = Math.max(createdMs, Math.min(now, replyMs ?? now));

  const lead: Lead = {
    id,
    name,
    city,
    phone: uniquePhone(rnd, usedPhones),
    source: plan.source,
    stage: plan.stage,
    ownerId: plan.ownerId,
    product: product.name,
    amountInr,
    createdAt: isoAt(createdMs),
    firstReplyAt: replyMs === null ? null : isoAt(replyMs),
    transcript: buildTranscript(
      rnd,
      now,
      id,
      name,
      product.name,
      city,
      amountInr,
      createdMs,
      replyMs,
    ),
    timeline: buildTimeline(rnd, plan.stage, createdMs, anchorMs, now, plan.ownerId),
    notes: buildNotes(rnd, now, id, plan.stage, createdMs, anchorMs, plan.ownerId),
  };
  return { lead, city };
}

/** Builds the whole console dataset for an explicit `now`. */
export function generateSeed(now: number): SeedBundle {
  const rnd = mulberry32(SEED);
  const ages = buildAges(rnd);
  const sources = assignSources(rnd, ages);
  const closedSlots = chooseClosedSlots(rnd, ages, sources);
  const waitingSlots = chooseWaitingSlots(rnd, ages, closedSlots);
  const stages = assignStages(rnd, ages, closedSlots, waitingSlots);
  const owners = assignOwners(rnd, waitingSlots, stages);

  const usedNames = new Set<string>();
  const usedPhones = new Set<string>();
  const leads: Lead[] = [];
  let lastCity: string | null = null;

  for (let i = 0; i < LEAD_COUNT; i += 1) {
    const plan: LeadPlan = {
      ageMinutes: ages[i] ?? 0,
      source: sources[i] ?? FALLBACK_PROFILE.name,
      stage: stages[i] ?? 'new',
      ownerId: owners[i] ?? null,
      waiting: waitingSlots.has(i),
    };
    const built = buildLead(i, plan, now, rnd, usedNames, usedPhones, lastCity);
    leads.push(built.lead);
    lastCity = built.city;
  }

  return {
    leads,
    team: TEAM.map((member) => ({ ...member })),
    sources: SOURCES.slice(),
    generatedAt: new Date(now).toISOString(),
  };
}

/** Fourteen days of first-response medians, oldest first, today last. */
export function generateResponseHistory(now: number): ResponsePoint[] {
  const rnd = mulberry32(HISTORY_SEED);
  const points: ResponsePoint[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    day.setHours(12, 0, 0, 0);
    const iso = day.toISOString();
    const progress = (13 - i) / 13;
    const minutes = HISTORY_OUTLIERS.includes(i)
      ? 66 + rnd() * 9
      : 52 - 26 * progress + (rnd() - 0.5) * 7;
    points.push({
      day: formatDay(iso),
      iso,
      medianFirstReplyMinutes: Math.round(minutes * 10) / 10,
    });
  }
  return points;
}
