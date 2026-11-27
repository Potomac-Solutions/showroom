// Paying on the platform's page: the test page until Stripe is set up, then Stripe Checkout
// (cards, and Link), by one setting. Stripe is faked here (its calls are the kit's, tested
// there); the trip is real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { served } from './http-client.js';

const dir = mkdtempSync(join(tmpdir(), 'showroom-pay-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const COST = { N: 2 ** 10, r: 8, p: 1 };
const SECRET = 'test-only-secret-that-is-long-enough-1234';
const who = { name: 'Rosa Bittinger', phone: '301-555-0100', email: 'rosa@example.com' };

function fakeStripe() {
  const state = { sessions: [], paid: new Set() };
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v1/checkout/sessions') {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)));
      const id = `cs_test_${state.sessions.length + 1}`;
      state.sessions.push({ id, form });
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    const one = state.sessions.find((session) => path === `/v1/checkout/sessions/${session.id}`);
    if (one) return Response.json({ id: one.id, status: 'open', payment_status: state.paid.has(one.id) ? 'paid' : 'unpaid', amount_total: Number(one.form['line_items[0][price_data][unit_amount]']), currency: 'usd', payment_intent: `pi_${one.id}` });
    return new Response('{}', { status: 404 });
  };
  return { fetcher, state };
}

test('bought on Stripe once its key is there: held while they pay, sold for good when it comes back paid, the webhook too', async () => {
  const stripe = fakeStripe();
  const s = await served(await createApp({ staffCost: COST, db: join(dir, 'stripe.db'), photos: join(dir, 'photos'), cache: false, secret: SECRET, payEnv: { PAY_STRIPE_KEY: 'sk_test_fake' }, payFetch: stripe.fetcher }));
  try {
    const rug = s.server.room.listings().find((listing) => listing.title === 'Hand-hooked rug');
    assert.match((await s.call(`/l/${rug.key}`)).text, /You’ll pay on Stripe’s secure page, in its test mode: no money moves\. We never see your card number\./);
    const sent = await s.post(`/l/${rug.key}/buy`, who);
    assert.equal(sent.location, 'https://checkout.stripe.com/c/pay/cs_test_1');
    assert.equal(stripe.state.sessions[0].form['line_items[0][price_data][unit_amount]'], String(rug.price), 'the shop’s price, never the page’s');
    assert.equal(stripe.state.sessions[0].form.success_url, `${s.base}/pay/back?listing=${rug.key}`);
    assert.equal(s.server.room.listings().find((listing) => listing.key === rug.key).state, 'held', 'held for them while they pay');

    stripe.state.paid.add('cs_test_1');
    assert.equal((await s.call(`/pay/back?listing=${rug.key}`)).location, `/l/${rug.key}?done=It’s yours. Collect it from the front counter in opening hours; bring help for anything heavy.`);
    assert.equal(s.server.room.listings().find((listing) => listing.key === rug.key).state, 'sold');
    const webhook = await s.call('/pay/webhook', { method: 'POST', body: JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1' } } }) });
    assert.equal(webhook.status, 200);
    assert.equal(s.server.sent.filter((mail) => mail.subject.includes('Hand-hooked rug')).length, 1, 'one email');
  } finally {
    await s.close();
  }
});

test('backed out of Stripe: nothing charged, back on the floor for anyone', async () => {
  const stripe = fakeStripe();
  const s = await served(await createApp({ staffCost: COST, db: join(dir, 'cancel.db'), photos: join(dir, 'photos2'), cache: false, secret: SECRET, payEnv: { PAY_STRIPE_KEY: 'sk_test_fake' }, payFetch: stripe.fetcher }));
  try {
    const lamp = s.server.room.listings().find((listing) => listing.state === 'available');
    await s.post(`/l/${lamp.key}/buy`, who);
    assert.equal((await s.call(`/pay/cancel?listing=${lamp.key}`)).location, `/l/${lamp.key}?problem=Nothing was charged.`);
    assert.equal(s.server.room.listings().find((listing) => listing.key === lamp.key).state, 'available');
  } finally {
    await s.close();
  }
});
