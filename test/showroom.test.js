// Showroom's walk: each browser context is one shopper's phone, or the back office's laptop.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';

// The owner every test shop starts with, set up from the shop's setup link; cheap hashing for tests.
const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };
const COST = { N: 2 ** 10, r: 8, p: 1 };
async function withOwner(server) {
  const made = await server.staff.accept(await server.staff.setup(), OWNER);
  if (!made.ok) throw new Error(made.error);
  return server;
}

const dir = mkdtempSync(join(tmpdir(), 'showroom-'));
const errors = [];
let browser;
let app;
let quick; // holds that last a second and a half

async function start(name, options = {}) {
  const server = await withOwner(await createApp({ staffCost: COST, db: join(dir, `${name}.db`), photos: join(dir, `${name}-photos`), cache: false, secret: 'test', ...options }));
  await new Promise((done) => server.listen(0, done));
  return { server, base: `http://localhost:${server.address().port}` };
}
const stop = (server) => {
  server.closeAllConnections?.();
  return new Promise((done) => server.close(done));
};

before(async () => {
  app = await start('app');
  quick = await start('quick', { holdMs: 1500 });
  const system = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((path) => existsSync(path));
  browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROME ?? system }));
});
after(async () => {
  await browser?.close();
  await stop(app.server);
  await stop(quick.server);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(errors, [], 'no page errors in any browser');
});

async function device(site, name, { javaScriptEnabled = true, staff = false } = {}) {
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && !/403/.test(message.text()) && errors.push(`${name}: ${message.text()}`));
  await page.goto(site.base);
  const post = async (path, form, headers = {}) => {
    const response = await context.request.post(`${site.base}${path}`, { form, headers, maxRedirects: 0 });
    return { status: response.status(), location: decodeURIComponent(response.headers().location ?? '') };
  };
  const get = async (path) => (await context.request.get(`${site.base}${path}`)).text();
  if (staff) await post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
  return { context, page, post, get };
}
/** A seeded listing by title. */
const find = (site, title) => site.server.room.listings().find((listing) => listing.title === title);
const who = { name: 'Rosa Bittinger', phone: '301-555-0100' };
const card = (number) => ({ ...who, email: 'rosa@example.com', card: number });

test('without JavaScript: browse the floor, hold a piece till tomorrow, and let it go', async () => {
  const shopper = await device(app, 'holder', { javaScriptEnabled: false });
  const { page } = shopper;
  assert.equal(await page.locator('.card').count(), 5);
  const lantern = find(app, 'B&O Railroad lantern');
  await page.click(`a[href="/l/${lantern.key}"]`);
  assert.match(await page.locator('main').innerText(), /B&O Railroad lantern[\s\S]*\$185\.00[\s\S]*Available[\s\S]*Era\s*1920s[\s\S]*Condition\s*Very good/);
  await page.fill('form[action$="/hold"] [name=name]', who.name);
  await page.fill('form[action$="/hold"] [name=phone]', who.phone);
  await page.click('form[action$="/hold"] button');
  await page.waitForURL(/done=/);
  await page.locator('listing-status', { hasText: 'Held for you' }).first().waitFor();
  assert.match(await page.locator('listing-status').first().innerText(), /^Held for you until \w{3} \d{1,2}:\d{2} [AP]M$/);
  assert.equal(await page.locator('form[action$="/hold"]').count(), 0);

  // Someone else sees it on hold, can't hold or buy it, but can still ask.
  const other = await device(app, 'other', { javaScriptEnabled: false });
  await other.page.goto(`${app.base}/l/${lantern.key}`);
  assert.match(await other.page.locator('main').innerText(), /On hold until[\s\S]*Someone is holding this one/);
  assert.equal(await other.page.locator('form[action$="/buy"]').count(), 0);
  assert.equal((await other.post(`/l/${lantern.key}/hold`, who)).location, `/l/${lantern.key}?problem=Someone is holding that one. Ask us to call you if it comes free.`);
  assert.equal((await other.post(`/l/${lantern.key}/buy`, card('4242'))).location, `/l/${lantern.key}?problem=Someone is holding that one.`);
  assert.equal((await other.post(`/l/${lantern.key}/release`, {})).location, `/l/${lantern.key}?problem=That hold isn’t yours.`);

  // The back office sees who's holding it.
  const office = await device(app, 'office', { javaScriptEnabled: false, staff: true });
  assert.match(await office.get('/back'), /B&amp;O Railroad lantern[\s\S]*On hold<br><small>hold: Rosa Bittinger, 301-555-0100/);
  await page.click('form[action$="/release"] button');
  await page.waitForURL((url) => decodeURIComponent(url.search).includes('done=Let go'));
  assert.equal(find(app, 'B&O Railroad lantern').state, 'available');
  await Promise.all([shopper.context.close(), other.context.close(), office.context.close()]);
});

test('holding needs a name and a phone; asking needs a question too, and reaches the back office', async () => {
  const shopper = await device(app, 'asker', { javaScriptEnabled: false });
  const pitcher = find(app, 'Fiesta pitcher, cobalt');
  assert.equal((await shopper.post(`/l/${pitcher.key}/hold`, { name: 'Rosa', phone: '555-0100' })).location, `/l/${pitcher.key}?problem=Give your name and a phone number with its area code.`);
  assert.equal((await shopper.post(`/l/${pitcher.key}/ask`, { ...who, message: '' })).location, `/l/${pitcher.key}?problem=Give your name, a phone number with its area code, and your question.`);
  assert.equal((await shopper.post(`/l/${pitcher.key}/ask`, { ...who, message: 'Is the glaze crazed anywhere?' })).location, `/l/${pitcher.key}?done=Sent. We’ll call you back.`);
  const office = await device(app, 'inbox', { javaScriptEnabled: false, staff: true });
  assert.match(await office.get('/back'), /Questions[\s\S]*Fiesta pitcher, cobalt<\/strong>: Is the glaze crazed anywhere\?<br><small>Rosa Bittinger, 301-555-0100/);
  assert.equal((await shopper.post('/l/l000000000/ask', { ...who, message: 'Hi' })).location, '/l/l000000000?problem=That isn’t in the shop.');
  await shopper.context.close();
  await office.context.close();
});

test('buying online sells it for good, once; a declined card lets it go, or keeps a hold the buyer had', async () => {
  const buyer = await device(app, 'buyer', { javaScriptEnabled: false });
  const rug = find(app, 'Hand-hooked rug');
  assert.equal((await buyer.post(`/l/${rug.key}/buy`, card('4000 0000 0000 0002'))).location, `/l/${rug.key}?problem=That card was declined. Try another.`);
  assert.equal(find(app, 'Hand-hooked rug').state, 'available', 'not holding it before: let go');
  assert.equal((await buyer.post(`/l/${rug.key}/hold`, who)).location.startsWith(`/l/${rug.key}?done=`), true);
  assert.equal((await buyer.post(`/l/${rug.key}/buy`, card('4000 0000 0000 0002'))).location, `/l/${rug.key}?problem=That card was declined. Try another.`);
  assert.equal(find(app, 'Hand-hooked rug').state, 'held', 'held before: still held');
  assert.equal((await buyer.post(`/l/${rug.key}/buy`, card('4242 4242 4242 4242'))).location, `/l/${rug.key}?done=It’s yours. Collect it from the front counter in opening hours; bring help for anything heavy.`);
  assert.equal(find(app, 'Hand-hooked rug').state, 'sold');
  assert.match(await buyer.get(`/l/${rug.key}`), /You bought this/);
  assert.equal((await buyer.post(`/l/${rug.key}/buy`, card('4242'))).location, `/l/${rug.key}?problem=You’ve already bought this.`);
  const other = await device(app, 'too late', { javaScriptEnabled: false });
  assert.match(await other.get(`/l/${rug.key}`), /Sorry, this one has been sold/);
  assert.equal((await other.post(`/l/${rug.key}/hold`, who)).location, `/l/${rug.key}?problem=Sorry, that’s been sold.`);
  // Sold pieces go to the end of the floor.
  assert.equal(app.server.room.listings().at(-1).title, 'Hand-hooked rug');
  const office = await device(app, 'sold office', { javaScriptEnabled: false, staff: true });
  assert.match(await office.get('/back'), /Hand-hooked rug[\s\S]*Sold<br><small>online: Rosa Bittinger/);
  await Promise.all([buyer.context.close(), other.context.close(), office.context.close()]);
});

test('two shoppers buying the same piece at the same moment: one gets it', async () => {
  const a = await device(app, 'race a', { javaScriptEnabled: false });
  const b = await device(app, 'race b', { javaScriptEnabled: false });
  const chairs = find(app, 'Set of six ladderback chairs');
  const answers = await Promise.all([a.post(`/l/${chairs.key}/buy`, card('4242')), b.post(`/l/${chairs.key}/buy`, card('4242'))]);
  assert.equal(answers.filter((answer) => answer.location.includes('done=It’s yours')).length, 1, JSON.stringify(answers));
  assert.equal(answers.filter((answer) => answer.location.includes('problem=')).length, 1);
  assert.equal(find(app, 'Set of six ladderback chairs').state, 'sold');
  await a.context.close();
  await b.context.close();
});

test('the floor is live: a hold and a sale show at once on every open page', async () => {
  const watcher = await device(app, 'watcher');
  await watcher.page.waitForFunction(() => customElements.get('listing-status'));
  await watcher.page.waitForTimeout(400); // the live stream open
  const washstand = find(app, 'Oak washstand with mirror');
  const card = (text) => watcher.page.locator('.card', { has: watcher.page.locator(`a[href="/l/${washstand.key}"]`) }).locator('listing-status', { hasText: text });
  const shopper = await device(app, 'live holder', { javaScriptEnabled: false });
  await shopper.post(`/l/${washstand.key}/hold`, who);
  await card('On hold until').waitFor({ timeout: 5000 });
  const office = await device(app, 'live office', { javaScriptEnabled: false, staff: true });
  // The staff can let anyone's hold go from the counter.
  assert.equal((await office.post('/back/release', { key: washstand.key })).location, '/back?done=The hold is let go.');
  await card('Available').waitFor({ timeout: 5000 });
  assert.equal((await office.post('/back/release', { key: washstand.key })).location, '/back?problem=That isn’t on hold.');
  await shopper.post(`/l/${washstand.key}/hold`, who);
  await card('On hold until').waitFor({ timeout: 5000 });
  assert.equal((await office.post('/back/sold', { key: washstand.key })).location, '/back?done=Oak washstand with mirror: sold.');
  await card('Sold').waitFor({ timeout: 5000 });
  assert.match(await shopper.get(`/l/${washstand.key}`), /Sorry, this one has been sold/, 'sold in the shop over a hold');
  assert.equal((await office.post('/back/sold', { key: washstand.key })).location, '/back?problem=That’s already sold.');
  await Promise.all([watcher.context.close(), shopper.context.close(), office.context.close()]);
});

test('a hold runs out after its time, and the piece is back on the floor for everyone', async () => {
  const shopper = await device(quick, 'quick holder', { javaScriptEnabled: false });
  const lantern = find(quick, 'B&O Railroad lantern');
  await shopper.post(`/l/${lantern.key}/hold`, who);
  assert.equal(find(quick, 'B&O Railroad lantern').state, 'held');
  await new Promise((done) => setTimeout(done, 1800));
  assert.equal(find(quick, 'B&O Railroad lantern').state, 'available');
  // Before the sweep writes it down, a live page still shows it free, not on hold.
  const live = await device(quick, 'live before sweep');
  await live.page.waitForFunction(() => customElements.get('listing-status'));
  await live.page.waitForTimeout(600);
  const status = live.page.locator('.card', { has: live.page.locator(`a[href="/l/${lantern.key}"]`) }).locator('listing-status');
  assert.equal((await status.innerText()).trim(), 'Available');
  await live.context.close();
  const other = await device(quick, 'after it ran out', { javaScriptEnabled: false });
  assert.equal((await other.post(`/l/${lantern.key}/hold`, { name: 'Sam Teets', phone: '304-555-0111' })).location.includes('done='), true);
  // The sweep writes the lapsed hold down, so live pages see it too.
  await new Promise((done) => setTimeout(done, 1800));
  assert.equal(await quick.server.room.sweep(), 1);
  assert.equal(quick.server.room.store.get('units', quick.server.room.unitKey(lantern.key)).state, 'free');
  await shopper.context.close();
  await other.context.close();
});

test('the back office adds a piece with photos; only real images, a title and a price; staff only', async () => {
  const office = await device(app, 'adder', { staff: true });
  await office.page.goto(`${app.base}/back`);
  await office.page.setContent('<div style="width:320px;height:240px;background:linear-gradient(135deg,#3d4a5c,#b98a3e)"></div>');
  const png = await office.page.locator('div').screenshot();
  await office.page.goto(`${app.base}/back`);
  await office.page.fill('[name=title]', 'Crock, 3 gallon');
  await office.page.fill('[name=price]', '120');
  await office.page.fill('[name=era]', '1880s');
  await office.page.setInputFiles('[name=photos]', [{ name: 'a.png', mimeType: 'image/png', buffer: png }, { name: 'b.png', mimeType: 'image/png', buffer: png }]);
  await office.page.click('form[action="/back/add"] button');
  await office.page.waitForURL(/\/l\/l[a-z0-9]+\?done=/);
  const crock = find(app, 'Crock, 3 gallon');
  assert.equal(crock.price, 12000);
  assert.equal(crock.photos.length, 2);
  assert.equal(crock.photos[0], crock.photos[1], 'the same picture twice is one file');
  const served = await office.context.request.get(`${app.base}/photos/${crock.photos[0]}`);
  assert.equal(served.status(), 200);
  assert.equal(served.headers()['content-type'], 'image/png');
  assert.deepEqual(Buffer.from(await served.body()), png);
  assert.equal((await office.context.request.get(`${app.base}/photos/../showroom.db`)).status(), 404);

  const multipart = async (fields) => {
    const response = await office.context.request.post(`${app.base}/back/add`, { multipart: fields, maxRedirects: 0 });
    return decodeURIComponent(response.headers().location ?? '');
  };
  assert.equal(await multipart({ title: 'Not a picture', price: '10', photos: { name: 'x.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') } }), '/back?problem=Photos must be PNG, JPEG, WebP or AVIF.');
  assert.equal(await multipart({ title: '', price: '10' }), '/back?problem=Give it a title.');
  assert.equal(await multipart({ title: 'Free?', price: '0' }), '/back?problem=Give a price in dollars.');
  const outsider = await device(app, 'not staff', { javaScriptEnabled: false });
  assert.match(await outsider.get('/back'), /<button type=\"submit\">Sign in<\/button>/);
  assert.equal((await outsider.post('/back/sold', { key: crock.key })).location, '/back');
  assert.equal(find(app, 'Crock, 3 gallon').state, 'available');
  assert.equal((await outsider.post('/staff/sign-in', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
  await office.context.close();
  await outsider.context.close();
});

test('a page reads the listings and whether each is free, never who holds or bought it; it writes nothing', async () => {
  const nosy = await device(app, 'nosy', { javaScriptEnabled: false });
  const all = [];
  for (let since = 0, i = 0; i < 200; i++) {
    const page = await (await nosy.context.request.get(`${app.base}/_zb/sync/pull?since=${encodeURIComponent(since)}&scope=${encodeURIComponent(JSON.stringify({ listings: true, units: true, buyers: true, enquiries: true, holders: true, payments: true }))}`)).json();
    all.push(...(page.changes ?? []));
    if (!page.changes?.length || page.cursor === since) break;
    since = page.cursor;
  }
  assert.ok(all.some((change) => change.collection === 'listings'));
  for (const change of all) assert.ok(['listings', 'units'].includes(change.collection), `${change.collection} isn't sent`);
  assert.ok(!JSON.stringify(all).includes('301-555-0100'), 'no phone numbers');
  const push = await nosy.context.request.post(`${app.base}/_zb/sync/push`, {
    headers: { 'sec-fetch-site': 'same-origin' },
    data: { changes: [{ collection: 'units', key: 'listing/x/item', field: 'state', value: 'free', clock: `${String(Date.now()).padStart(15, '0')}-00000-x` }] },
  });
  assert.equal(push.status(), 403);
  assert.equal((await nosy.post(`/l/${find(app, 'Fiesta pitcher, cobalt').key}/hold`, who, { 'sec-fetch-site': 'cross-site' })).status, 403);
  await nosy.context.close();
});
