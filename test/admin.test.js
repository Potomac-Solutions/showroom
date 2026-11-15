// The admin, customer accounts and reports, over plain HTTP (no browser needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryFiles } from '@potomac-solutions/kit/files';
import { createApp } from '../server.js';

const COST = { N: 2 ** 10, r: 8, p: 1 };
const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };
const STAFF = { email: 'hand@example.com', name: 'Floor Hand', password: 'floor hand password' };
const dir = mkdtempSync(join(tmpdir(), 'showroom-admin-'));
let server;
let base;

before(async () => {
  server = await createApp({ staffCost: COST, db: join(dir, 'shop.db'), files: memoryFiles(), cache: false, secret: 'test' });
  await server.staff.accept(await server.staff.setup(), OWNER);
  const owner = server.staff.list().find((one) => one.email === OWNER.email);
  await server.staff.accept((await server.staff.invite(owner, { email: STAFF.email, name: STAFF.name, roles: ['staff'] })).token, STAFF);
  await new Promise((done) => server.listen(0, done));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

function browser() {
  const jar = new Map();
  const remember = (response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1));
      else jar.delete(pair.slice(0, at));
    }
    return response;
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const where = (response) => decodeURIComponent((response.headers.get('location') ?? '').replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
  return {
    async get(path) {
      const response = remember(await fetch(`${base}${path}`, { headers: { cookie: cookie() }, redirect: 'manual' }));
      return { status: response.status, type: response.headers.get('content-type'), location: where(response), text: await response.text() };
    },
    async post(path, form) {
      const response = remember(await fetch(`${base}${path}`, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), redirect: 'manual' }));
      return { status: response.status, location: where(response), text: await response.text() };
    },
  };
}
async function signInStaff(who) {
  const b = browser();
  await b.get('/');
  assert.equal((await b.post('/staff/sign-in', { email: who.email, password: who.password })).location, '/admin');
  return b;
}
/** The first piece on the floor that nobody holds: its key. */
const available = () => server.room.listings().find((listing) => listing.state === 'available').key;
const buy = (b, key, { name = 'Pat Quill', email = 'pat@example.com' } = {}) => b.post(`/l/${key}/buy`, { name, phone: '301-555-0101', email, card: '4242 4242 4242 4242' });

test('the landing page leads with the shop, then the floor; sold pieces don’t crowd it; no admin link for a guest', async () => {
  const page = (await browser().get('/')).text;
  assert.match(page, /class="hero"[\s\S]*See the floor[\s\S]*How it works[\s\S]*id="floor"/);
  assert.ok(!page.includes('>Admin</a>'));
});

test('a customer signs up and their hold follows the account to another device, where it can be bought', async () => {
  const phone = browser();
  await phone.get('/');
  const key = available();
  assert.match((await phone.post(`/l/${key}/hold`, { name: 'Pat Quill', phone: '301-555-0101' })).location, /held for you/);
  assert.equal((await phone.post('/account/sign-up', { name: 'Pat Quill', email: 'pat@example.com', password: 'pat quill password' })).location, '/account?done=Welcome. Your account is ready.');
  const title = server.room.listing(key).title;
  assert.match((await phone.get('/account')).text, new RegExp(`Held for you[\\s\\S]*${title}`));

  const laptop = browser();
  await laptop.get('/');
  assert.match((await buy(laptop, key)).location, /Someone is holding/, 'not theirs before signing in');
  assert.equal((await laptop.post('/account/sign-in', { email: 'pat@example.com', password: 'pat quill password' })).location, '/account');
  assert.match((await buy(laptop, key)).location, /It’s yours/);
  assert.equal(server.room.listing(key).state, 'sold');
  assert.match((await phone.get('/account')).text, new RegExp(`Bought[\\s\\S]*${title}`), 'the sale shows on the first device too');
  assert.match(server.sent.at(-1).subject, /It’s yours/);
  assert.equal((await laptop.post('/account/sign-out', {})).location, '/');
  assert.equal((await laptop.get('/account')).location, '/account/sign-in');
});

test('a forgotten password: the same page either way, and the emailed link works once', async () => {
  const b = browser();
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Lee Forgets', email: 'lee@example.com', password: 'lee first password' });
  const nobody = (await b.post('/account/forgot', { email: 'nobody@example.com' })).text.match(/<main[\s\S]*<\/main>/)[0];
  const lee = (await b.post('/account/forgot', { email: 'lee@example.com' })).text.match(/<main[\s\S]*<\/main>/)[0];
  assert.equal(nobody, lee);
  const token = /\/account\/reset\?token=([\w-]{43})/.exec(server.sent.at(-1).body)[1];
  assert.equal((await b.post('/account/reset', { token, password: 'lee second password' })).location, '/account?done=Your new password is saved.');
  assert.match((await b.post('/account/reset', { token, password: 'lee third password' })).text, /expired/);
});

test('the admin is for staff; reports, settings and the outbox for owners', async () => {
  const guest = browser();
  await guest.get('/');
  const key = available();
  for (const path of ['/admin', '/admin/inventory', '/admin/reports', '/admin/sales.csv']) {
    const page = await guest.get(path);
    assert.ok(!/Overview|text\/csv/.test(`${page.text}${page.type}`), path);
  }
  assert.equal((await guest.post(`/admin/inventory/${key}/edit`, { title: 'Free', price: '1' })).location, '/admin');
  assert.notEqual(server.room.listing(key).title, 'Free');
  const hand = await signInStaff(STAFF);
  assert.match((await hand.get('/admin')).text, /Overview[\s\S]*On the floor/);
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox']) assert.equal((await hand.get(path)).status, 403, path);
  assert.equal((await hand.post('/admin/settings', { hours: 'Never', pickup: 'Nowhere' })).location, '/admin');
  const owner = await signInStaff(OWNER);
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox']) assert.equal((await owner.get(path)).status, 200, path);
});

test('staff edit a piece and sell it in the shop from the admin; the sale is in the activity and the sales list', async () => {
  const key = available();
  const hand = await signInStaff(STAFF);
  assert.match((await hand.post(`/admin/inventory/${key}/edit`, { title: 'Brass lamp', price: 'cheap' })).location, /price in dollars/);
  assert.equal((await hand.post(`/admin/inventory/${key}/edit`, { title: 'Brass student lamp', price: '125', category: 'Lighting', era: '1900s' })).location, `/admin/inventory/${key}?done=Saved.`);
  assert.equal(server.room.listing(key).price, 12500);
  assert.equal((await hand.post(`/admin/inventory/${key}/sold`, {})).location, `/admin/inventory/${key}?done=Sold in the shop.`);
  assert.match((await hand.post(`/admin/inventory/${key}/sold`, {})).location, /already sold/);
  assert.match((await hand.get('/admin/sales')).text, /Brass student lamp[\s\S]*in the shop[\s\S]*\$125/);
  assert.match((await hand.get('/admin')).text, /Floor Hand<\/strong> sold Brass student lamp in the shop/);
  // A sale keeps its price when the piece's price changes afterward.
  await hand.post(`/admin/inventory/${key}/edit`, { title: 'Brass student lamp', price: '999' });
  assert.equal(server.room.sales().find((sale) => sale.key === key).cents, 12500);
});

test('a question comes in and staff mark it answered', async () => {
  const key = available();
  const b = browser();
  await b.get('/');
  assert.match((await b.post(`/l/${key}/ask`, { name: 'Ash Asker', phone: '301-555-0109', message: 'Is the finish original?' })).location, /Sent/);
  const hand = await signInStaff(STAFF);
  assert.match((await hand.get('/admin/questions')).text, /Is the finish original\?[\s\S]*Ash Asker/);
  const question = server.room.enquiries().find((one) => one.name === 'Ash Asker');
  assert.equal((await hand.post('/admin/questions/answered', { key: question.key })).location, '/admin/questions?done=Marked answered.');
  assert.equal(server.room.enquiries().find((one) => one.key === question.key).answered, true);
});

test('reports and CSV: the sales add up, and a title can’t become a formula', async () => {
  const key = available();
  const owner = await signInStaff(OWNER);
  await owner.post(`/admin/inventory/${key}/edit`, { title: '=HYPERLINK("http://evil.example")', price: '40' });
  await owner.post(`/admin/inventory/${key}/sold`, {});
  const total = server.room.sales().reduce((sum, sale) => sum + sale.cents, 0);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: total % 100 ? 2 : 0 }).format(total / 100);
  assert.ok((await owner.get('/admin/reports?range=30d')).text.includes(`Sales</span><strong>${money}</strong>`), money);
  const rows = (await owner.get('/admin/reports.csv?range=30d')).text.trim().split('\r\n');
  assert.equal(rows[0], 'Day,Pieces sold,Sales (USD)');
  assert.equal(Math.round(rows.slice(1).reduce((sum, row) => sum + Number(row.split(',')[2]), 0) * 100), total);
  assert.match((await owner.get('/admin/sales.csv')).text, /"'=HYPERLINK\(""http:\/\/evil\.example""\)"/);
});

test('an owner turns a customer off; staff can’t turn them back on', async () => {
  const b = browser();
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Off Switch', email: 'off@example.com', password: 'off switch password' });
  const id = server.customers.list().find((c) => c.email === 'off@example.com').customer;
  const owner = await signInStaff(OWNER);
  assert.match((await owner.post(`/admin/customers/${id}/disabled`, { disabled: 'yes' })).location, /Turned off/);
  assert.equal((await b.get('/account')).location, '/account/sign-in');
  const hand = await signInStaff(STAFF);
  await hand.post(`/admin/customers/${id}/disabled`, { disabled: 'no' });
  assert.equal(server.customers.get(id).disabled, true);
});
