// Showroom: unique stock, on one small Node server.
//
// - Listings with photos, each one of a kind: hold it till tomorrow, buy it online, or ask about
//   it. Every page shows whether a listing is free, live.
// - The back office adds listings (photos too), marks walk-in sales and reads the questions.
// - Every form is a plain post to a route here, so it all works without JavaScript.
// - The deciding is the kit's (src/showroom.js): hold, pay, files.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';
import { signedCookie } from '@potomac-solutions/kit/auth';
import { createStaff } from '@potomac-solutions/kit/staff';
import { staffPages, clientAddress } from '@potomac-solutions/kit/staff/pages';
import { createCustomers } from '@potomac-solutions/kit/customers';
import { createNotify, outbox } from '@potomac-solutions/kit/notify';
import * as accountPages from './src/account.js';
import { createAdmin } from './src/admin.js';
import { createNotices } from '@potomac-solutions/kit/notice';
import { lockedStaff, lockedCustomers, staffSignIn, guestSignIn, nightly } from './src/demo.js';
import { diskFiles } from '@potomac-solutions/kit/files';
import { createShowroom } from './src/showroom.js';
import { layout, escape } from './src/layout.js';
import { shell } from './src/shell.js';
import { landing } from './src/site.js';
import { photo as stock } from './src/assets.js';
import { cards } from './src/tables.js';
import { serveAsset } from './src/assets.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The staff's pages, for marking where they are in the sidebar. */
const STAFF_LINKS = ['/back', '/admin', '/admin/inventory', '/admin/sales', '/admin/questions', '/admin/customers', '/admin/reports', '/admin/settings', '/admin/outbox', '/staff/people'];
const components = join(here, 'src', 'components');
const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'showroom.db'), photos = join(process.env.DATA_DIR ?? here, 'photos'), cache = true, secret = process.env.SESSION_SECRET, now = Date.now, holdMs, files, staffCost, publicUrl = process.env.PUBLIC_URL ?? '' , demo = process.env.DEMO === '1' } = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'showroom-development-only';
  }
  const room = await createShowroom({ db, files: files ?? diskFiles(photos), now, holdMs });
  const guests = signedCookie({ secret, name: 'guest' });
  const zubra = createZubra({ components, cache, packages: ['@potomac-solutions/kit/components'] });
  const { shop } = room;
  // Holds that have run out are let go every minute, so every page sees them free.
  const sweeper = setInterval(() => room.sweep?.(), 60_000);
  sweeper.unref();

  // The people who run the shop: an owner and the staff they invite (the kit's staff module), in the
  // shop's own log; their pages and routes are the kit's too.
  const production = process.env.NODE_ENV === 'production';
  // Customers who make an account (kit/customers), in the shop's own log.
  // The public demo (src/demo.js) refuses changes to its sign-ins.
  const kitCustomers = createCustomers({ store: room.store, secure: production, now, ...(staffCost ? { cost: staffCost } : {}) });
  const customers = demo ? lockedCustomers(kitCustomers) : kitCustomers;
  // Email goes to an outbox the owner can read: this demo sends nothing for real.
  const mail = outbox();
  const notify = createNotify({
    send: mail.send,
    templates: {
      reset: ({ name, link }) => ({ subject: `Reset your ${shop.name} password`, body: `Hi ${name},\n\nThis link sets a new password. It works once, for an hour:\n${link}\n\nIf it wasn’t you, ignore this email.` }),
      bought: ({ name, title, price, link }) => ({ subject: `It’s yours: ${title}`, body: `Hi ${name},\n\nYou bought ${title} for ${price} (test mode).\n${link}\n\n${shop.pickup}` }),
    },
  });
  const origin = (req) => publicUrl || `http://${req.headers.host ?? 'localhost'}`;
  const proxies = Number(process.env.TRUST_PROXIES ?? 0);
  const kitStaff = createStaff({ store: room.store, secure: production, ...(staffCost ? { cost: staffCost } : {}) });
  const staff = demo ? lockedStaff(kitStaff) : kitStaff;
  // A message in an address shows only if the server signed it (kit/notice), so a link can't put
  // its own words in a page's alert.
  const notices = createNotices({ secret });
  const pages = staffPages({ staff, notices, proxies, home: '/admin', business: shop.name, secure: production, // A signed-in member of staff sees the kit's pages (people, their password) inside the staff shell;
    // signing in and accepting an invite are a narrow card on the shop's own page.
    render: (res, title, body) => (staff.can(res.who, 'staff') ? staffPage(res, zubra.page(), title, body, { here: title === 'People' ? '/staff/people' : '' }) : page(res, zubra.page(), title, `<div class="auth">${body}</div>`)) });
  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location: notices.sign(location) }), res.end());
  const page = (res, p, title, body, { status = 200, ...options } = {}) => send(res, status, p.finish(layout({ title, shop, body, ...options })));
  const staffPage = (res, p, title, body, { status = 200, ...options } = {}) => send(res, status, p.finish(shell({ title, shop, body: cards(body), who: res.who, owner: staff.can(res.who, 'owner'), waiting: room.enquiries().filter((one) => !one.answered).length, ...options })));
  const admin = createAdmin({ room, customers, sent: mail.sent, now });
  const downloadCsv = (res, name, text) => (res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' }), res.end(text));
  const note = (url) => {
    const problem = notices.read(url).problem;
    const done = notices.read(url).done;
    return `${problem ? `<p class="notice" role="alert">${escape(problem)}</p>` : ''}${done ? `<p class="ok" role="status">${escape(done)}</p>` : ''}`;
  };
  const withProblem = (path, answer) => `${path}?problem=${encodeURIComponent(answer.error)}`;
  const withDone = (path, said) => `${path}?done=${encodeURIComponent(said)}`;
  /** A form, plain or with files (the back office's photos): at most 21 MB. */
  async function readForm(req) {
    if (Number(req.headers['content-length'] ?? 0) > 21 * 1024 * 1024) return null;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
    try {
      return await new Request('http://showroom.local/', { method: 'POST', headers, body: Readable.toWeb(req), duplex: 'half' }).formData();
    } catch {
      return null;
    }
  }
  // A piece's own photograph; without one, a photograph of its kind of thing, marked as not the piece itself.
  const slug = (category) => String(category ?? '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  const photo = (listing, i = 0, alt = '') => {
    if (listing.photos?.[i]) return `<img class="photo" src="/photos/${listing.photos[i]}" alt="${escape(alt)}" loading="lazy">`;
    const standIn = stock(slug(listing.category)) || stock('other');
    return standIn ? `<div class="photo stand-in"><img src="${standIn}" alt="" loading="lazy"><span>${listing.category ? `${escape(listing.category)} · ` : ''}Photo coming</span></div>` : `<div class="photo none">${listing.category ? `${escape(listing.category)} · ` : ''}Photo coming</div>`;
  };
  const status = (p, listing, guest) => p.render('listing-status', { unit: room.unitKey(listing.key), me: guest?.pub ?? '', stateNow: listing.state === 'available' ? 'free' : listing.state === 'sold' ? 'taken' : 'held', byNow: listing.mine ? guest?.pub ?? '' : '', untilNow: listing.until, untilLabel: listing.until ? new Date(listing.until).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: shop.timeZone }) : '', now: Date.now(), timeZone: shop.timeZone });

  function floor(p, url, guest, account) {
    const card = (listing) => `<li class="card${listing.state === 'sold' ? ' gone' : ''}"><a class="pic" href="/l/${listing.key}" tabindex="-1" aria-hidden="true">${photo(listing, 0, '')}</a><div class="body"><h3><a href="/l/${listing.key}">${escape(listing.title)}</a></h3><p class="era">${escape(listing.era)}</p><p class="row"><strong>${money(listing.price)}</strong> ${status(p, listing, guest)}</p></div></li>`;
    return landing({ shop, listings: room.listings(guest), card, said: note(url), account });
  }

  function listingPage(p, url, guest, listing) {
    const form = (action, label, extra = '') => `<form class="panel" method="post" action="/l/${listing.key}/${action}"><h2>${label}</h2>${extra}</form>`;
    const who = `<label>Your name<input name="name" autocomplete="name" required></label><label>Phone<input name="phone" type="tel" autocomplete="tel" required></label>`;
    const actions =
      listing.state === 'sold'
        ? `<p class="notice">${listing.mine ? 'You bought this. ' + escape(shop.pickup) : 'Sorry, this one has been sold.'}</p>`
        : listing.state === 'held' && !listing.mine
          ? `<p class="notice">Someone is holding this one. Ask below and we’ll call if it comes free.</p>`
          : `<div class="actions">
${listing.mine ? `<form class="panel" method="post" action="/l/${listing.key}/release"><h2>It’s held for you</h2><p>We’ll keep it at the counter. ${escape(shop.pickup)}</p><button class="button light" type="submit">Let it go</button></form>` : form('hold', `Hold it till tomorrow`, `<p>Free. We keep it for ${shop.holdHours} hours and call if you don’t make it.</p>${who}<button type="submit" class="go">Hold it</button>`)}
${form('buy', `Buy it now · ${money(listing.price)}`, `<p class="lede">Test mode: no money moves. Any card number works except 4000 0000 0000 0002.</p>${who}<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Card number<input name="card" inputmode="numeric" autocomplete="cc-number" required></label><button type="submit">Pay ${money(listing.price)}</button>`)}
</div>`;
    return `<div class="piece">
<section class="page-head"><a class="back" href="/#floor">Back to the shop floor</a><p class="kicker">${escape(listing.category ?? 'One of a kind')}</p><h1>${escape(listing.title)}</h1><p class="row price"><strong>${money(listing.price)}</strong> ${status(p, listing, guest)}</p></section>
${note(url)}
<div class="piece-grid">
  <div class="shots">${listing.photos?.length ? `<div class="gallery">${listing.photos.map((id, i) => `<img src="/photos/${id}" alt="${escape(listing.title)}, photo ${i + 1}">`).join('')}</div>` : photo(listing)}
    <section class="panel"><p>${escape(listing.description)}</p><dl class="facts"><dt>Era</dt><dd>${escape(listing.era)}</dd><dt>Size</dt><dd>${escape(listing.size)}</dd><dt>Condition</dt><dd>${escape(listing.condition)}</dd></dl></section></div>
  <div class="deal">${actions}
${form('ask', 'Ask about it', `${who}<label>Your question<textarea name="message" rows="3" required></textarea></label><button class="button light" type="submit">Send it</button>`)}</div>
</div></div>`;
  }

  function backOffice(url) {
    const { listings, enquiries } = room.back();
    const row = (listing) =>
      `<tr><td><a href="/l/${listing.key}">${escape(listing.title)}</a><br><small>${money(listing.price)}</small></td><td>${listing.state === 'sold' ? 'Sold' : listing.state === 'held' ? 'On hold' : 'Available'}${listing.buyer && listing.state !== 'available' ? `<br><small>${escape(listing.buyer.how)}${listing.buyer.name ? `: ${escape(listing.buyer.name)}, ${escape(listing.buyer.phone ?? '')}` : ''}</small>` : ''}</td><td>${listing.state === 'sold' ? '' : `<form method="post" action="/back/sold"><input type="hidden" name="key" value="${listing.key}"><button type="submit">Sold in the shop</button></form>`}${listing.state === 'held' ? `<form method="post" action="/back/release"><input type="hidden" name="key" value="${listing.key}"><button class="button light" type="submit">Let the hold go</button></form>` : ''}</td></tr>`;
    return `<section class="page-head"><h1>The back office</h1><p class="lede">Add what comes in, mark what sells at the counter, and answer questions.</p></section>
${note(url)}
<form class="panel add-piece" method="post" action="/back/add" enctype="multipart/form-data"><h2>Add a piece</h2>
  <label>Title<input name="title" required></label><label>Price, in dollars<input name="price" inputmode="decimal" required></label>
  <label>Category<select name="category">${shop.categories.map((one) => `<option>${escape(one)}</option>`).join('')}</select></label>
  <label>Era<input name="era"></label><label>Size<input name="size"></label><label>Condition<input name="condition"></label>
  <label>Description<textarea name="description" rows="3"></textarea></label>
  <label>Photos (up to four)<input name="photos" type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple></label>
  <button type="submit">Put it on the floor</button></form>
<section class="panel"><h2>Questions</h2>${enquiries.length ? `<ul>${enquiries.map((one) => `<li><strong>${escape(one.title)}</strong>: ${escape(one.message)}<br><small>${escape(one.name)}, ${escape(one.phone)}</small></li>`).join('')}</ul>` : '<p>No questions yet.</p>'}</section>
<section class="panel"><h2>Every piece</h2><table><tbody>${listings.map(row).join('')}</tbody></table></section>`;
  }

  const server = createServer(async (req, res) => {
    try {
      if (await room.sync.handle(req, res)) return;
      if (zubra.handle(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      if (serveAsset(req, res, url)) return;
      // A made-up shop asks not to be listed; a real one (shop.listed) lists its public pages only.
      if (url.pathname === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(shop.listed ? 'User-agent: *\nDisallow: /admin\nDisallow: /back\nDisallow: /staff\nDisallow: /account\n' : 'User-agent: *\nDisallow: /\n');
      if (url.pathname === '/favicon.ico') return res.writeHead(302, { location: '/assets/favicon.svg' }).end();
      const picture = url.pathname.match(/^\/photos\/([0-9a-f]{64}\.[a-z]{3,4})$/);
      if (picture) {
        const file = await room.files.get(picture[1]);
        if (!file) return send(res, 404, 'No such photo');
        res.writeHead(200, { 'content-type': file.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        return res.end(file.body);
      }
      const account = customers.session(req);
      const guest = { ...guests.ensure(req, res), customer: account?.customer };
      const who = staff.session(req);
      const inBack = staff.can(who, 'staff');
      const owner = staff.can(who, 'owner');
      const nav = { customer: account, staff: inBack };
      res.who = who;
      // Staff pages (the admin passes `wide`) go in the staff shell; the rest in the shop's own page.
      const staffHere = () => STAFF_LINKS.filter((href) => url.pathname === href || url.pathname.startsWith(`${href}/`)).sort((a, b) => b.length - a.length)[0] ?? '';
      const show = (p, title, body, { wide = false, here, ...options } = {}) => (wide ? staffPage(res, p, title, body, { here: staffHere(), ...options }) : page(res, p, title, body, { nav, here, ...options }));
      const signInPage = () => show(zubra.page(), 'Sign in', `<div class="auth">${demo ? staffSignIn(escape) : ''}${pages.signIn(url)}</div>`);
      if (url.pathname.startsWith('/account') || url.pathname.startsWith('/admin')) res.setHeader('cache-control', 'no-store');

      if (req.method === 'POST') {
        // Every form is ours: another site's post is refused (the cookies are SameSite=Lax too).
        if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'Forbidden');
        const form = await readForm(req);
        if (!form) return send(res, 413, 'Too large');
        const acting = url.pathname.match(/^\/l\/(l[a-z0-9]+)\/(hold|release|buy|ask)$/);
        if (acting) {
          const [, key, what] = acting;
          const done = what === 'ask' ? await room.ask(key, form) : what === 'release' ? await room.release(guest, key) : await room[what](guest, key, form);
          if (!done.ok) return back(res, withProblem(`/l/${key}`, done));
          if (what === 'buy') {
            const listing = room.listing(key);
            const email = String(form.get('email') ?? '').trim();
            if (email) await notify.notify({ email }, 'bought', { name: String(form.get('name') ?? '').trim(), title: listing.title, price: money(listing.price), link: `${origin(req)}/l/${key}` });
          }
          const said = { hold: 'It’s held for you until tomorrow. We’ll call if you don’t make it.', release: 'Let go. It’s back on the floor.', buy: `It’s yours. ${shop.pickup}`, ask: 'Sent. We’ll call you back.' }[what];
          return back(res, withDone(`/l/${key}`, said));
        }
        // A customer's account.
        if (url.pathname.startsWith('/account/')) {
          const p = zubra.page();
          const problem = (words) => `<p class="notice" role="alert">${escape(words)}</p>`;
          if (url.pathname === '/account/sign-up') {
            const made = await customers.signUp({ email: form.get('email'), name: form.get('name'), password: form.get('password') });
            if (made.error) return show(p, 'Make an account', accountPages.signUp({ problem: problem(made.error), form }), { status: 422 });
            await room.claim(guest, made.customer);
            res.setHeader('set-cookie', made.cookie);
            return back(res, withDone('/account', 'Welcome. Your account is ready.'));
          }
          if (url.pathname === '/account/sign-in') {
            const signed = await customers.signIn(form.get('email'), form.get('password'), { client: clientAddress(req, { proxies }) });
            if (signed.error) return show(p, 'Sign in', (demo ? `<div class="auth">${guestSignIn(escape)}</div>` : '') + accountPages.signIn({ problem: problem(signed.error === 'locked' ? 'Too many tries. Wait 15 minutes, or reset your password.' : 'That email and password don’t match.'), email: String(form.get('email') ?? '') }), { status: 401 });
            await room.claim(guest, signed.customer);
            res.setHeader('set-cookie', signed.cookie);
            return back(res, '/account');
          }
          if (url.pathname === '/account/sign-out') {
            res.setHeader('set-cookie', (await customers.signOut(req)).cookie);
            return back(res, '/');
          }
          if (url.pathname === '/account/forgot') {
            const email = String(form.get('email') ?? '').trim().toLowerCase();
            const raw = await customers.resetToken(email);
            const one = raw && customers.list().find((c) => c.email === email);
            if (one) {
              const link = `${origin(req)}/account/reset?token=${raw}`;
              await notify.notify({ email: one.email }, 'reset', { name: one.name, link });
              if (!production) console.log(`Password reset for ${one.email}: ${link}`);
            }
            return show(p, 'Reset your password', accountPages.forgot({ sent: true }));
          }
          if (url.pathname === '/account/reset') {
            const raw = String(form.get('token') ?? '');
            const reset = await customers.reset(raw, form.get('password'));
            if (reset.error) return show(p, 'Choose a new password', accountPages.reset({ token: raw, problem: problem(reset.error), works: customers.peek(raw) }), { status: 422 });
            res.setHeader('set-cookie', reset.cookie);
            return back(res, withDone('/account', 'Your new password is saved.'));
          }
          if (url.pathname === '/account/profile') {
            if (!account) return back(res, '/account/sign-in');
            const renamed = await customers.rename(account.customer, form.get('name'));
            return back(res, renamed.ok ? withDone('/account', 'Saved.') : withProblem('/account', renamed));
          }
          return send(res, 404, 'Not found');
        }
        // The admin's changes. Staff edit and sell pieces; owners change customers and settings.
        if (url.pathname.startsWith('/admin/')) {
          if (!inBack) return back(res, '/admin');
          const piece = url.pathname.match(/^\/admin\/inventory\/(l[a-z0-9]+)\/(edit|sold|release)$/);
          if (piece) {
            const [, key, what] = piece;
            const done = what === 'edit' ? await room.update(key, form) : what === 'sold' ? await room.soldInShop(key) : await room.release(null, key, { staff: true });
            if (!done.ok) return back(res, withProblem(`/admin/inventory/${key}`, done));
            const title = room.listing(key).title;
            await room.audit(who, what === 'edit' ? `edited ${title}` : what === 'sold' ? `sold ${title} in the shop` : `let the hold on ${title} go`, key);
            return back(res, withDone(`/admin/inventory/${key}`, what === 'edit' ? 'Saved.' : what === 'sold' ? 'Sold in the shop.' : 'The hold is let go.'));
          }
          if (url.pathname === '/admin/questions/answered') {
            const done = await room.answered(String(form.get('key') ?? ''));
            if (done.ok) await room.audit(who, 'answered a question');
            return back(res, done.ok ? withDone('/admin/questions', 'Marked answered.') : withProblem('/admin/questions', done));
          }
          if (!owner) return back(res, '/admin');
          const customerAction = url.pathname.match(/^\/admin\/customers\/(c[a-z0-9]+)\/(disabled|reset)$/);
          const one = customerAction && customers.get(customerAction[1]);
          if (one && customerAction[2] === 'disabled') {
            const off = form.get('disabled') === 'yes';
            const changed = await customers.setDisabled(one.customer, off);
            if (changed?.error) return back(res, withProblem(`/admin/customers/${one.customer}`, changed));
            await room.audit(who, `${off ? 'turned off' : 'turned back on'} ${one.name}’s account`, one.customer);
            return back(res, withDone(`/admin/customers/${one.customer}`, off ? 'Turned off and signed out everywhere.' : 'Turned back on.'));
          }
          if (one) {
            const raw = await customers.resetToken(one.email);
            if (!raw) return back(res, withProblem(`/admin/customers/${one.customer}`, { error: 'That account is turned off.' }));
            await notify.notify({ email: one.email }, 'reset', { name: one.name, link: `${origin(req)}/account/reset?token=${raw}` });
            await room.audit(who, `emailed ${one.name} a reset link`, one.customer);
            return back(res, withDone(`/admin/customers/${one.customer}`, 'Sent. It’s in the outbox.'));
          }
          if (url.pathname === '/admin/settings') {
            const saved = await room.setShop(form);
            if (saved.error) return back(res, withProblem('/admin/settings', saved));
            await room.audit(who, 'changed the hours or pickup words');
            return back(res, withDone('/admin/settings', 'Saved.'));
          }
          return send(res, 404, 'Not found');
        }
        // Sign-in, links, people and passwords.
        if (await pages.handle(req, res, url, form)) return;
        if (url.pathname.startsWith('/back/')) {
          if (!inBack) return back(res, '/back');
          if (url.pathname === '/back/add') {
            const done = await room.add(form);
            if (done.ok) await room.audit(who, `added ${String(form.get('title') ?? '').trim()}`, done.key);
            return back(res, done.ok ? withDone(`/l/${done.key}`, 'It’s on the floor.') : withProblem('/back', done));
          }
          const key = String(form.get('key') ?? '');
          if (url.pathname === '/back/sold') {
            const done = await room.soldInShop(key);
            if (done.ok) await room.audit(who, `sold ${done.listing.title} in the shop`, key);
            return back(res, done.ok ? withDone('/back', `${done.listing.title}: sold.`) : withProblem('/back', done));
          }
          if (url.pathname === '/back/release') {
            const done = await room.release(null, key, { staff: true });
            if (done.ok) await room.audit(who, `let the hold on ${room.listing(key)?.title} go`, key);
            return back(res, done.ok ? withDone('/back', 'The hold is let go.') : withProblem('/back', done));
          }
        }
        return send(res, 404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

      if (await pages.handle(req, res, url, null)) return;
      const p = zubra.page();
      if (url.pathname === '/') return show(p, 'The shop floor', floor(p, url, guest, account), { here: '/', landing: true, canonical: publicUrl ? `${publicUrl}/` : '' });
      const showing = url.pathname.match(/^\/l\/(l[a-z0-9]+)$/);
      const listing = showing && room.listing(showing[1], guest);

      // A customer's pages.
      if (url.pathname === '/account') return account ? show(p, 'Your account', accountPages.account({ room, guest, customer: account, said: note(url) }), { here: '/account' }) : back(res, '/account/sign-in');
      if (url.pathname === '/account/sign-in') return account ? back(res, '/account') : show(p, 'Sign in', (demo ? `<div class="auth">${guestSignIn(escape)}</div>` : '') + accountPages.signIn({ problem: note(url) }), { here: '/account/sign-in' });
      if (url.pathname === '/account/sign-up') return account ? back(res, '/account') : show(p, 'Make an account', accountPages.signUp());
      if (url.pathname === '/account/forgot') return show(p, 'Reset your password', accountPages.forgot());
      if (url.pathname === '/account/reset') {
        const raw = url.searchParams.get('token') ?? '';
        return show(p, 'Choose a new password', accountPages.reset({ token: raw, works: customers.peek(raw) }));
      }

      // The admin: staff only; reports, settings and the outbox for owners.
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        if (!inBack) return signInPage();
        const bar = '';
        const said = note(url);
        const wide = { wide: true, here: '/admin' };
        if (url.pathname === '/admin') return show(p, 'Overview', admin.dashboard({ who, owner, bar }), wide);
        if (url.pathname === '/admin/inventory') return show(p, 'Inventory', admin.inventory({ url, owner, bar }), wide);
        if (url.pathname === '/admin/inventory.csv') return downloadCsv(res, 'inventory.csv', admin.inventoryCsv(url));
        const piece = url.pathname.match(/^\/admin\/inventory\/(l[a-z0-9]+)$/);
        const one = piece && room.listing(piece[1]);
        if (one) return show(p, one.title, admin.piece({ listing: one, owner, bar, said }), wide);
        if (url.pathname === '/admin/sales') return show(p, 'Sales', admin.sales({ url, owner, bar }), wide);
        if (url.pathname === '/admin/sales.csv') return downloadCsv(res, 'sales.csv', admin.salesCsv());
        if (url.pathname === '/admin/questions') return show(p, 'Questions', admin.questions({ owner, bar, said }), wide);
        if (url.pathname === '/admin/customers') return show(p, 'Customers', admin.customers({ url, owner, bar }), wide);
        if (url.pathname === '/admin/customers.csv') return downloadCsv(res, 'customers.csv', admin.customersCsv());
        const oneCustomer = url.pathname.match(/^\/admin\/customers\/(c[a-z0-9]+)$/);
        const person = oneCustomer && customers.get(oneCustomer[1]);
        if (person) return show(p, person.name, admin.customer({ one: person, owner, bar, said }), wide);
        if (['/admin/reports', '/admin/reports.csv', '/admin/settings', '/admin/outbox'].includes(url.pathname) && !owner) return show(p, 'Owners only', '<section class="page-head"><h1>Owners only</h1><p class="lede">Reports, settings and the outbox are for owners. Ask one to show you this page.</p></section><p><a class="button light" href="/admin">Back to the overview</a></p>', { status: 403, wide: true });
        if (url.pathname === '/admin/reports') return show(p, 'Reports', admin.reports({ url, owner, bar }), wide);
        if (url.pathname === '/admin/reports.csv') return downloadCsv(res, 'sales-by-period.csv', admin.reportCsv(url));
        if (url.pathname === '/admin/settings') return show(p, 'Settings', admin.settings({ owner, bar, said }), wide);
        if (url.pathname === '/admin/outbox') return show(p, 'Outbox', admin.outbox({ owner, bar }), wide);
        return send(res, 404, 'Not found');
      }
      if (listing) return show(p, listing.title, listingPage(p, url, guest, listing));
      if (url.pathname === '/back') {
        if (!inBack) return signInPage();
        return show(p, 'The back office', backOffice(url), { wide: true });
      }
      send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.');
      else res.end();
    }
  });
  server.on('close', () => clearInterval(sweeper));
  return Object.assign(server, { demo, room, staff, customers, sent: mail.sent });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  if (server.staff.needsOwner()) console.log(`Set up the first owner (works once, for a day): http://localhost:${port}/staff/accept?token=${await server.staff.setup()}`);
  if (server.demo) nightly();
  server.listen(port, '0.0.0.0', () => console.log(`Showroom on http://localhost:${port}`));
}
