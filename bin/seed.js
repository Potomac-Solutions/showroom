// Demo data: an owner and a floor hand, forty customers, six months of pieces coming in and
// selling, holds and questions today, so every admin page and report has something to show.
//
//   npm run seed            add to an empty shop (refuses if it has sold anything)
//   npm run seed -- --fresh start over: delete the database first
//
// Sales go through the real hold and payment (or "sold in the shop"), then are dated back; the
// pieces on hold now are held the real way, so every page shows them on hold. No photos: each
// card shows "Photo coming". The names are made up and every address is @example.com.
// Run it with the server stopped.
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryFiles } from '@potomac-solutions/kit/files';
import { createApp } from '../server.js';

const here = dirname(fileURLToPath(import.meta.url));
const db = join(process.env.DATA_DIR ?? join(here, '..'), 'showroom.db');
if (process.argv.includes('--fresh')) for (const file of [db, `${db}-wal`, `${db}-shm`]) if (existsSync(file)) rmSync(file);

// The demo sign-ins live in src/demo.js, so the public demo can show and protect them.
import { DEMO } from '../src/demo.js';
export { DEMO };

let seed = 20261115;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const FIRST = ['Avery', 'Blake', 'Casey', 'Drew', 'Emerson', 'Finley', 'Harper', 'Jamie', 'Kendall', 'Logan', 'Morgan', 'Noah', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Taylor', 'Peyton', 'Rowan', 'Skyler', 'Elliot', 'Hayden', 'Jordan', 'Kai', 'Lane', 'Micah', 'Sasha', 'Tatum', 'Wren', 'Ari'];
const LAST = ['Abbott', 'Barnes', 'Calloway', 'Dunmore', 'Ellison', 'Fairbanks', 'Garrett', 'Holloway', 'Iverson', 'Jessup', 'Kessler', 'Lowry', 'Marsh', 'Nolan', 'Oakley', 'Pruitt', 'Ramsey', 'Sutton', 'Thayer', 'Underwood', 'Vance', 'Whitaker', 'Yates', 'Zeller'];
const person = () => {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  return { name, email: `${name.toLowerCase().replace(' ', '.')}${Math.floor(random() * 90 + 10)}@example.com`, phone: `301-555-0${String(Math.floor(random() * 200)).padStart(3, '0')}` };
};
const DAY = 86_400_000;
const NOW = Date.now();

// What comes through the door, by category: names, eras and a price range in dollars.
const STOCK = {
  Furniture: { things: ['Oak dresser', 'Pine blanket chest', 'Walnut side table', 'Cherry drop-leaf table', 'Hoosier cabinet', 'Bentwood rocker', 'Mission bookcase', 'Painted jelly cupboard', 'Cane-seat chair', 'Maple dry sink'], eras: ['About 1890', 'About 1910', '1920s', '1940s', 'Late 1800s'], price: [120, 950] },
  Lighting: { things: ['Brass student lamp', 'Slag glass table lamp', 'Kerosene parlor lamp', 'Industrial cage light', 'Hurricane lamp', 'Milk glass ceiling fixture'], eras: ['1900s', '1920s', '1930s', '1950s'], price: [45, 420] },
  Textiles: { things: ['Double wedding ring quilt', 'Hand-hooked rug', 'Feed-sack apron', 'Crocheted bedspread', 'Wool army blanket', 'Embroidered table runner'], eras: ['1930s', '1940s', '1950s'], price: [25, 380] },
  'Pottery and glass': { things: ['Crock, 3 gallon', 'Fiesta platter', 'Depression glass set', 'Stoneware pitcher', 'Hall teapot', 'Carnival glass bowl', 'Pyrex mixing bowls'], eras: ['1920s', '1930s', '1940s', '1950s'], price: [15, 160] },
  Railroadiana: { things: ['B&O lantern', 'Switch key', 'Conductor’s cap', 'Railroad timetable', 'Depot bench', 'Dining car china plate'], eras: ['1910s', '1920s', '1940s'], price: [40, 600] },
  Tools: { things: ['Stanley block plane', 'Blacksmith’s anvil', 'Cross-cut saw', 'Wooden tool tote', 'Hand-crank drill', 'Coal miner’s lamp'], eras: ['1900s', '1920s', '1940s'], price: [20, 300] },
  'Art and frames': { things: ['Oil landscape, gilt frame', 'Tintype portrait', 'Hand-tinted photograph', 'Folk-art weathervane', 'Tin sign, feed store', 'Watercolor of the depot'], eras: ['Late 1800s', '1920s', '1950s'], price: [30, 700] },
};
const CONDITIONS = ['Very good', 'Good; light wear', 'Sound; refinished', 'Fair; priced for it', 'Excellent'];

const server = await createApp({ db, files: memoryFiles(), cache: false });
const { room, staff, customers } = server;
const { store } = room;
if (room.sales().length) {
  console.log(`The shop in ${db} already has sales. Run \`npm run seed -- --fresh\` to start over.`);
  process.exit(1);
}

await staff.accept(await staff.setup(), DEMO.owner);
const ownerView = staff.list().find((one) => one.email === DEMO.owner.email);
await staff.accept((await staff.invite(ownerView, { email: DEMO.staff.email, name: DEMO.staff.name, roles: ['staff'] })).token, DEMO.staff);
const floorHand = staff.list().find((one) => one.email === DEMO.staff.email);
const accounts = [];
const riley = await customers.signUp(DEMO.customer);
accounts.push({ id: riley.customer, ...DEMO.customer, phone: '301-555-0142', at: NOW - 170 * DAY });
for (let i = 0; i < 40; i++) {
  const one = person();
  const made = await customers.signUp({ ...one, password: `demo-password-${i}-${Math.floor(random() * 1e6)}` });
  if (made.ok) accounts.push({ id: made.customer, ...one, at: NOW - Math.floor(random() * 170 + 1) * DAY });
}
for (const one of accounts) await store.write('customers', one.id, { at: one.at });
await customers.setDisabled(accounts.at(-1).id, true);

// The starting pieces get categories and dates too.
for (const listing of room.listings()) await store.write('listings', listing.key, { added: NOW - Math.floor(random() * 20 + 3) * DAY });

// Six months of pieces coming in; most sell, some take a while.
let added = 0;
let sold = 0;
for (let i = 0; i < 190; i++) {
  const category = pick(Object.keys(STOCK));
  const kind = STOCK[category];
  const thing = pick(kind.things);
  const [low, high] = kind.price;
  const dollars = Math.round((low + Math.pow(random(), 1.8) * (high - low)) / 5) * 5;
  const form = new URLSearchParams({ title: thing, price: String(dollars), category, era: pick(kind.eras), condition: pick(CONDITIONS), size: '', description: `From an estate near ${pick(['Grantsville', 'Lonaconing', 'Midland', 'Westernport', 'Cumberland', 'Accident'])}.` });
  const made = await room.add(form);
  const addedAt = NOW - Math.floor(Math.pow(random(), 0.8) * 180 * DAY);
  await store.write('listings', made.key, { added: addedAt });
  added++;
  // How long it sat: most go within a month; some never do.
  const wait = Math.floor(-Math.log(1 - random()) * 22 * DAY);
  const soldAt = addedAt + wait + Math.floor(random() * 8) * 3_600_000;
  if (soldAt > NOW - 3_600_000 || random() < 0.12) continue;
  const online = random() < 0.35;
  if (online) {
    const known = accounts.slice(0, -1).filter((one) => one.at < soldAt);
    const who = known.length && random() < 0.6 ? { ...(random() < 0.08 ? accounts[0] : pick(known)), account: true } : person();
    const guest = { pub: `seed-guest-${i}`, customer: who.account ? who.id : undefined };
    const done = await room.buy(guest, made.key, new URLSearchParams({ name: who.name, phone: who.phone ?? '301-555-0100', email: who.email, card: '4242 4242 4242 4242' }));
    if (!done.ok) continue;
  } else {
    await room.soldInShop(made.key);
  }
  await store.write('buyers', made.key, { at: soldAt });
  sold++;
}

// Today: a few holds, the real way, and questions.
const floor = room.listings().filter((listing) => listing.state === 'available');
for (let i = 0; i < 6 && i < floor.length; i++) {
  const who = i === 0 ? { ...accounts[0], account: true } : person();
  await room.hold({ pub: `seed-holder-${i}`, customer: who.account ? who.id : undefined }, floor[i * 3].key, new URLSearchParams({ name: who.name, phone: who.phone ?? '301-555-0100' }));
}
const asks = ['Is it still available? Could you hold it till Saturday?', 'Can you measure the height?', 'Would you take less if I buy two?', 'Do you deliver to Cumberland?', 'Any chips or repairs I should know about?', 'Is the finish original?'];
for (let i = 0; i < 12; i++) {
  const who = person();
  const listing = pick(room.listings());
  await room.ask(listing.key, new URLSearchParams({ name: who.name, phone: who.phone, message: pick(asks) }));
}
const questions = room.enquiries();
for (const [i, one] of questions.entries()) {
  await store.write('enquiries', one.key, { at: NOW - (i * 2 + 1) * 3_600_000 * 7 });
  if (i >= 5) await room.answered(one.key);
}
await room.audit(floorHand, 'answered a question');
await room.audit(ownerView, `edited ${floor[1]?.title ?? 'a piece'}`, floor[1]?.key ?? '');

console.log(`Seeded ${db}:
  ${accounts.length} customer accounts, ${added} pieces added over six months, ${sold} sold, 6 on hold, ${questions.length} questions.

Sign in (this machine only; these are demo passwords):
  Owner     ${DEMO.owner.email} / ${DEMO.owner.password}    → /admin
  Staff     ${DEMO.staff.email} / ${DEMO.staff.password}    → /admin, /back
  Customer  ${DEMO.customer.email} / ${DEMO.customer.password}    → /account

Then: npm start`);
process.exit(0);
