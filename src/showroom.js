// The showroom: what the server knows, and what only it may decide.
//
// Everything lives in one Sync log (a SQLite file), read and written through the kit's store;
// photos are kept by the kit's `files`. Each listing is one of a kind, so the kit's `hold` keeps
// it to one person: held for a day by a guest who asks, held for the minutes a payment takes,
// or taken for good once sold (online, or in the shop). `pay` charges once. This file knows
// the shop's listings, questions and words.
//
//   listings/<key>           title, price, condition, era, size, description, photos
//   units/listing/<key>/item  held or taken, by whom, until when (kit hold), live on every page
//   holders/<pool>/<guest>   the kit hold's summary of what a guest holds
//   buyers/<key>             who holds or bought it: name and phone (the staff see it)
//   enquiries/<id>           a question about a listing, for the staff
//   payments/<id>            the kit's record of each payment
//   settings/shop            what the owner changed from the admin: hours, pickup words
//   audit/<key>              who on the staff did what, and when
//   customers, customer-sessions, customer-tokens   customer accounts (kit customers)
//
// A hold or a purchase is a guest's by their browser (the hold's holder) and, signed in, by their
// account (`customer` on the buyer record).
import { createSyncServer } from '@zubra/sync/server';
import { sqliteLog } from '@zubra/sync/sqlite';
import { syncStore, serverOnly, SERVER_ONLY } from '@potomac-solutions/kit/store';
import { createHolds } from '@potomac-solutions/kit/hold';
import { createPay, testProvider } from '@potomac-solutions/kit/pay';
import { shop, seedListings } from './shop.js';

const KEY = /^l[a-z0-9]{6,24}$/;
const newKey = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const poolOf = (key) => `listing/${key}`;
const UNIT = 'item';
/** The shop's own name in the holds, for things sold or held at the counter. */
const SHOP = 'shop';

export async function createShowroom({ db = ':memory:', files, now = Date.now, holdMs = shop.holdHours * 3_600_000, payMs = 2 * 60_000 } = {}) {
  if (!files) throw new TypeError('createShowroom needs files (the kit’s diskFiles or memoryFiles)');
  const sync = createSyncServer({
    log: await sqliteLog(db),
    // Pages write nothing: every collection here is the server's.
    authorize: serverOnly([...SERVER_ONLY, 'listings', 'holders', 'buyers', 'enquiries', 'settings', 'audit'], ({ kind }) => kind === 'read'),
    // A page reads the listings and whether each is free; never who holds or bought it.
    scope: () => ({ listings: true, units: true }),
  });
  const store = await syncStore(sync);
  // One listing is one unit in a pool of its own: one person holds it at a time.
  const holds = createHolds({ store, holdMs, ceilingMs: holdMs + payMs, max: 1, names: { holders: 'holders' }, now });
  const pay = createPay({ provider: testProvider(), store, now });

  // What the owner changed, over the defaults in shop.js.
  const defaults = { hours: shop.hours, pickup: shop.pickup };
  const applySettings = () => Object.assign(shop, defaults, Object.fromEntries(Object.entries(store.get('settings', 'shop') ?? {}).filter(([name]) => name in defaults)));
  applySettings();

  if (!store.under('listings').length) {
    let at = now() - seedListings.length * 60_000;
    for (const listing of seedListings) await store.write('listings', newKey(), { ...listing, photos: [], added: (at += 60_000) });
  }

  /** A listing as it stands: available, on hold (until when, and whether it's this guest's), or sold. */
  function stateOf(key, who = '') {
    const { pub = '', customer = '' } = typeof who === 'string' ? { pub: who } : (who ?? {});
    const unit = holds.taken(poolOf(key)).get(UNIT);
    if (!unit) return { state: 'available', until: 0, mine: false };
    const buyer = store.get('buyers', key);
    const mine = (Boolean(pub) && unit.by === pub) || (Boolean(customer) && buyer?.customer === customer && buyer?.owner === unit.by);
    if (unit.state === 'held') return { state: 'held', until: unit.until, mine };
    return { state: 'sold', until: 0, mine };
  }
  const view = (key, pub) => {
    const listing = KEY.test(key ?? '') ? store.get('listings', key) : null;
    return listing ? { key, ...listing, ...stateOf(key, pub) } : null;
  };
  const contact = (form) => ({ name: String(form.get('name') ?? '').trim().slice(0, 80), phone: String(form.get('phone') ?? '').trim().slice(0, 40) });
  const enough = ({ name, phone }) => name && phone.replace(/\D/g, '').length >= 10;

  return {
    sync,
    store,
    files,
    shop,
    unitKey: (key) => `${poolOf(key)}/${UNIT}`,

    /** Every listing, newest first, sold ones last. */
    listings(pub = '') {
      return store
        .under('listings')
        .map((listing) => ({ ...listing, ...stateOf(listing.key, pub) }))
        .sort((a, b) => Number(a.state === 'sold') - Number(b.state === 'sold') || b.added - a.added);
    },
    listing: view,

    /** A guest holds a listing until tomorrow: their name and phone, so the shop can call. */
    async hold(guest, key, form) {
      const listing = view(key, guest);
      if (!guest || !listing) return { error: 'That isn’t in the shop.' };
      const who = contact(form);
      if (!enough(who)) return { error: 'Give your name and a phone number with its area code.' };
      if (listing.state === 'sold') return { error: 'Sorry, that’s been sold.' };
      if (listing.state === 'held' && !listing.mine) return { error: 'Someone is holding that one. Ask us to call you if it comes free.' };
      const held = listing.mine ? { until: listing.until } : await holds.choose(guest.pub, poolOf(key), { units: [UNIT] });
      if (held.error) return { error: 'Someone just took that one.' };
      if (!listing.mine) await store.write('buyers', key, { ...who, how: 'hold', owner: guest.pub, customer: guest.customer ?? '', heldAt: now(), at: now() });
      return { ok: true, until: held.until };
    },

    /** Let go of a hold: the guest's own, or any at the counter. */
    async release(guest, key, { staff = false } = {}) {
      const unit = holds.taken(poolOf(key)).get(UNIT);
      if (!unit || unit.state !== 'held') return { error: 'That isn’t on hold.' };
      if (!staff && !stateOf(key, guest).mine) return { error: 'That hold isn’t yours.' };
      await holds.release(unit.by, poolOf(key));
      return { ok: true };
    },

    /**
     * Buy it online: held for the payment (the last of anything goes to one person), charged
     * once, then sold for good. A declined card lets it go, unless the guest was holding it.
     */
    async buy(guest, key, form) {
      const listing = view(key, guest);
      if (!guest || !listing) return { error: 'That isn’t in the shop.' };
      if (listing.state === 'sold') return { error: listing.mine ? 'You’ve already bought this.' : 'Sorry, that’s been sold.' };
      if (listing.state === 'held' && !listing.mine) return { error: 'Someone is holding that one.' };
      const wasHolding = listing.state === 'held';
      // Held from another device of the same account: the hold is that browser's, so buy as it.
      const as = wasHolding ? holds.taken(poolOf(key)).get(UNIT).by : guest.pub;
      const held = await holds.choose(as, poolOf(key), { units: [UNIT] });
      if (held.error) return { error: 'Someone just took that one.' };
      const paid = await pay.pay({ id: `listing/${key}`, cents: listing.price, method: { card: String(form.get('card') ?? '') }, description: `${listing.title} (test mode)` });
      if (!paid.ok) {
        if (!wasHolding) await holds.release(as, poolOf(key));
        return { error: paid.error === 'declined' ? 'That card was declined. Try another.' : 'That didn’t go through. Try again.' };
      }
      await holds.confirm(as, poolOf(key), [UNIT]);
      await store.write('buyers', key, { name: String(form.get('name') ?? '').trim().slice(0, 80), email: String(form.get('email') ?? '').trim().slice(0, 200), phone: String(form.get('phone') ?? '').trim().slice(0, 40), how: 'online', ref: paid.ref, owner: as, customer: guest.customer ?? store.get('buyers', key)?.customer ?? '', cents: listing.price, at: now() });
      return { ok: true };
    },

    /** A question about a listing, for the staff. */
    async ask(key, form) {
      const listing = view(key);
      if (!listing) return { error: 'That isn’t in the shop.' };
      const who = contact(form);
      const message = String(form.get('message') ?? '').trim().slice(0, 1000);
      if (!who.name || !message || who.phone.replace(/\D/g, '').length < 10) return { error: 'Give your name, a phone number with its area code, and your question.' };
      await store.write('enquiries', `q${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, { listing: key, title: listing.title, ...who, message, answered: false, at: now() });
      return { ok: true };
    },

    // ---- The staff ----------------------------------------------------------------------------

    /** Add a listing, with up to four photos (kept by the kit's files). */
    async add(form) {
      const title = String(form.get('title') ?? '').trim().slice(0, 120);
      const price = Math.round(Number(form.get('price')) * 100);
      if (!title) return { error: 'Give it a title.' };
      if (!Number.isInteger(price) || price <= 0) return { error: 'Give a price in dollars.' };
      const photos = [];
      for (const file of form.getAll('photos').filter((one) => typeof one === 'object' && one.size > 0).slice(0, 4)) {
        const kept = await files.put({ type: file.type, body: new Uint8Array(await file.arrayBuffer()) });
        if (kept.error) return { error: kept.error === 'type' ? 'Photos must be PNG, JPEG, WebP or AVIF.' : kept.error === 'too-big' ? 'Each photo must be under 5 MB.' : 'A photo couldn’t be read.' };
        photos.push(kept.id);
      }
      const key = newKey();
      const text = (name, length) => String(form.get(name) ?? '').trim().slice(0, length);
      const category = shop.categories.includes(text('category', 40)) ? text('category', 40) : 'Other';
      await store.write('listings', key, { title, price, category, condition: text('condition', 200), era: text('era', 60), size: text('size', 60), description: text('description', 1000), photos, added: now() });
      return { ok: true, key };
    },

    /** Sold at the counter (cash, a walk-in): taken for good, whoever was holding it. */
    async soldInShop(key) {
      const listing = view(key);
      if (!listing) return { error: 'That isn’t in the shop.' };
      if (listing.state === 'sold') return { error: 'That’s already sold.' };
      const unit = holds.taken(poolOf(key)).get(UNIT);
      if (unit?.state === 'held') await holds.release(unit.by, poolOf(key));
      await holds.choose(SHOP, poolOf(key), { units: [UNIT] });
      await holds.confirm(SHOP, poolOf(key), [UNIT]);
      await store.write('buyers', key, { how: 'in the shop', cents: listing.price, name: '', phone: '', email: '', customer: '', owner: SHOP, at: now() });
      return { ok: true, listing };
    },

    // ---- Accounts, the admin and the owner's settings -----------------------------------------
    /** On signing in or up: this browser's holds and purchases join the account. */
    async claim(guest, customer) {
      let claimed = 0;
      for (const buyer of store.under('buyers')) {
        if (buyer.owner === guest?.pub && !buyer.customer) {
          await store.write('buyers', buyer.key, { customer });
          claimed++;
        }
      }
      return claimed;
    },
    /** What a customer holds and has bought, for their account page. */
    mine(guest) {
      return store
        .under('buyers')
        .filter((buyer) => (guest?.pub && buyer.owner === guest.pub) || (guest?.customer && buyer.customer === guest.customer))
        .map((buyer) => ({ ...buyer, listing: view(buyer.key, guest) }))
        .filter((one) => one.listing && one.listing.mine)
        .sort((a, b) => b.at - a.at);
    },
    /** Every sale, newest first: the listing, how it sold, for how much, and when. */
    sales: () =>
      store
        .under('buyers')
        .filter((buyer) => buyer.how === 'online' || buyer.how === 'in the shop')
        .map((buyer) => ({ ...buyer, cents: buyer.cents ?? store.get('listings', buyer.key)?.price ?? 0, listing: { key: buyer.key, ...store.get('listings', buyer.key) } }))
        .filter((sale) => stateOf(sale.key).state === 'sold')
        .sort((a, b) => b.at - a.at),
    enquiries: () => store.under('enquiries').sort((a, b) => Number(a.answered) - Number(b.answered) || b.at - a.at),
    async answered(key) {
      if (!store.get('enquiries', key ?? '')) return { error: 'That question isn’t here.' };
      await store.write('enquiries', key, { answered: true });
      return { ok: true };
    },
    buyer: (key) => store.get('buyers', key),

    /** The staff change a listing's words or price. A sold piece keeps the price it sold for. */
    async update(key, form) {
      const listing = view(key);
      if (!listing) return { error: 'That isn’t in the shop.' };
      const text = (name, length) => String(form.get(name) ?? '').trim().slice(0, length);
      const title = text('title', 120);
      const price = Math.round(Number(text('price', 12).replace(/[$,]/g, '')) * 100);
      if (!title) return { error: 'Give it a title.' };
      if (!Number.isInteger(price) || price <= 0) return { error: 'Give a price in dollars.' };
      const category = shop.categories.includes(text('category', 40)) ? text('category', 40) : listing.category ?? 'Other';
      await store.write('listings', key, { title, price, category, condition: text('condition', 200), era: text('era', 60), size: text('size', 60), description: text('description', 1000) });
      return { ok: true, listing: { ...listing, title, price } };
    },

    /** Something someone on the staff did, for the activity list. */
    async audit(by, what, ref = '') {
      await store.write('audit', `a${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, { by: by?.name ?? 'System', what: String(what).slice(0, 200), ref, at: now() });
    },
    activity: (limit = 20) => store.under('audit').sort((a, b) => b.at - a.at).slice(0, limit),

    /** The owner changes the hours and pickup words. */
    async setShop(form) {
      const hours = String(form.get('hours') ?? '').trim().slice(0, 120);
      const pickup = String(form.get('pickup') ?? '').trim().slice(0, 240);
      if (!hours || !pickup) return { error: 'Give the hours and the pickup words.' };
      await store.write('settings', 'shop', { hours, pickup });
      applySettings();
      return { ok: true };
    },

    /** Let go of every hold whose day is up, so every page sees it free. */
    sweep: () => holds.sweep(),

    /** The staff's view: every listing with who holds or bought it, and the questions. */
    back() {
      return {
        listings: this.listings().map((listing) => ({ ...listing, buyer: store.get('buyers', listing.key) })),
        enquiries: store.under('enquiries').sort((a, b) => b.at - a.at).slice(0, 20),
      };
    },
  };
}
