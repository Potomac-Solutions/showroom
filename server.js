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
import { diskFiles } from '@potomac-solutions/kit/files';
import { createShowroom } from './src/showroom.js';
import { layout, escape } from './src/layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'src', 'components');
const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'showroom.db'), photos = join(process.env.DATA_DIR ?? here, 'photos'), cache = true, secret = process.env.SESSION_SECRET, now, holdMs, files } = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'showroom-development-only';
  }
  const room = await createShowroom({ db, files: files ?? diskFiles(photos), now, holdMs });
  const guests = signedCookie({ secret, name: 'guest' });
  // Staff accounts come later: for the concept, a device signs in to the back office.
  const staff = signedCookie({ secret, name: 'staff', maxAge: 12 * 3600 });
  const zubra = createZubra({ components, cache, packages: ['@potomac-solutions/kit/components'] });
  const { shop } = room;
  // Holds that have run out are let go every minute, so every page sees them free.
  const sweeper = setInterval(() => room.sweep?.(), 60_000);
  sweeper.unref();

  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location }), res.end());
  const page = (res, p, title, body) => send(res, 200, p.finish(layout({ title, shop, body })));
  const note = (url) => {
    const problem = (url.searchParams.get('problem') ?? '').slice(0, 200);
    const done = (url.searchParams.get('done') ?? '').slice(0, 200);
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
  const photo = (listing, i = 0, alt = '') => (listing.photos?.[i] ? `<img class="photo" src="/photos/${listing.photos[i]}" alt="${escape(alt)}" loading="lazy">` : `<div class="photo none">Photo coming</div>`);
  const status = (p, listing, guest) => p.render('listing-status', { unit: room.unitKey(listing.key), me: guest?.pub ?? '', stateNow: listing.state === 'available' ? 'free' : listing.state === 'sold' ? 'taken' : 'held', byNow: listing.mine ? guest.pub : '', untilNow: listing.until, untilLabel: listing.until ? new Date(listing.until).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: shop.timeZone }) : '', now: Date.now(), timeZone: shop.timeZone });

  function floor(p, url, guest) {
    return `<section><h1>On the shop floor</h1><p class="lede">${escape(shop.hours)}. Every piece is one of a kind: hold it till tomorrow, buy it here, or ask us about it.</p></section>
${note(url)}
<ul class="grid">${room
      .listings(guest?.pub)
      .map((listing) => `<li class="card">${photo(listing, 0, listing.title)}<h2><a href="/l/${listing.key}">${escape(listing.title)}</a></h2><p class="row"><strong>${money(listing.price)}</strong> ${status(p, listing, guest)}</p><p>${escape(listing.era)}</p></li>`)
      .join('')}</ul>`;
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
${listing.mine ? `<form class="panel" method="post" action="/l/${listing.key}/release"><h2>It’s held for you</h2><p>We’ll keep it at the counter. ${escape(shop.pickup)}</p><button class="button light" type="submit">Let it go</button></form>` : form('hold', `Hold it till tomorrow`, `<p>Free. We keep it for ${shop.holdHours} hours and call if you don’t make it.</p>${who}<button type="submit">Hold it</button>`)}
${form('buy', `Buy it now · ${money(listing.price)}`, `<p class="lede">Test mode: no money moves. Any card number works except 4000 0000 0000 0002.</p>${who}<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Card number<input name="card" inputmode="numeric" autocomplete="cc-number" required></label><button type="submit">Pay ${money(listing.price)}</button>`)}
</div>`;
    return `<section><a href="/">Back to the shop floor</a><h1>${escape(listing.title)}</h1><p class="row lede"><strong>${money(listing.price)}</strong> ${status(p, listing, guest)}</p></section>
${note(url)}
${listing.photos?.length ? `<div class="gallery">${listing.photos.map((id, i) => `<img src="/photos/${id}" alt="${escape(listing.title)}, photo ${i + 1}">`).join('')}</div>` : photo(listing)}
<section class="panel"><p>${escape(listing.description)}</p><dl class="facts"><dt>Era</dt><dd>${escape(listing.era)}</dd><dt>Size</dt><dd>${escape(listing.size)}</dd><dt>Condition</dt><dd>${escape(listing.condition)}</dd></dl></section>
${actions}
${form('ask', 'Ask about it', `${who}<label>Your question<textarea name="message" rows="3" required></textarea></label><button class="button light" type="submit">Send it</button>`)}`;
  }

  function backOffice(url) {
    const { listings, enquiries } = room.back();
    const row = (listing) =>
      `<tr><td><a href="/l/${listing.key}">${escape(listing.title)}</a><br><small>${money(listing.price)}</small></td><td>${listing.state === 'sold' ? 'Sold' : listing.state === 'held' ? 'On hold' : 'Available'}${listing.buyer && listing.state !== 'available' ? `<br><small>${escape(listing.buyer.how)}${listing.buyer.name ? `: ${escape(listing.buyer.name)}, ${escape(listing.buyer.phone ?? '')}` : ''}</small>` : ''}</td><td>${listing.state === 'sold' ? '' : `<form method="post" action="/back/sold"><input type="hidden" name="key" value="${listing.key}"><button type="submit">Sold in the shop</button></form>`}${listing.state === 'held' ? `<form method="post" action="/back/release"><input type="hidden" name="key" value="${listing.key}"><button class="button light" type="submit">Let the hold go</button></form>` : ''}</td></tr>`;
    return `<section><h1>The back office</h1><p class="lede">Add what comes in, mark what sells at the counter, and answer questions.</p></section>
${note(url)}
<form class="panel" method="post" action="/back/add" enctype="multipart/form-data"><h2>Add a piece</h2>
  <label>Title<input name="title" required></label><label>Price, in dollars<input name="price" inputmode="decimal" required></label>
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
      if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
      const picture = url.pathname.match(/^\/photos\/([0-9a-f]{64}\.[a-z]{3,4})$/);
      if (picture) {
        const file = await room.files.get(picture[1]);
        if (!file) return send(res, 404, 'No such photo');
        res.writeHead(200, { 'content-type': file.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        return res.end(file.body);
      }
      const guest = guests.ensure(req, res);
      const inBack = Boolean(staff.read(req.headers.cookie ?? ''));

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
          const said = { hold: 'It’s held for you until tomorrow. We’ll call if you don’t make it.', release: 'Let go. It’s back on the floor.', buy: `It’s yours. ${shop.pickup}`, ask: 'Sent. We’ll call you back.' }[what];
          return back(res, withDone(`/l/${key}`, said));
        }
        if (url.pathname === '/staff/start') {
          res.setHeader('set-cookie', staff.cookie('back'));
          return back(res, '/back');
        }
        if (url.pathname.startsWith('/back/')) {
          if (!inBack) return back(res, '/back');
          if (url.pathname === '/back/add') {
            const done = await room.add(form);
            return back(res, done.ok ? withDone(`/l/${done.key}`, 'It’s on the floor.') : withProblem('/back', done));
          }
          const key = String(form.get('key') ?? '');
          if (url.pathname === '/back/sold') {
            const done = await room.soldInShop(key);
            return back(res, done.ok ? withDone('/back', `${done.listing.title}: sold.`) : withProblem('/back', done));
          }
          if (url.pathname === '/back/release') {
            const done = await room.release(null, key, { staff: true });
            return back(res, done.ok ? withDone('/back', 'The hold is let go.') : withProblem('/back', done));
          }
        }
        return send(res, 404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

      const p = zubra.page();
      if (url.pathname === '/') return page(res, p, 'The shop floor', floor(p, url, guest));
      const showing = url.pathname.match(/^\/l\/(l[a-z0-9]+)$/);
      const listing = showing && room.listing(showing[1], guest.pub);
      if (listing) return page(res, p, listing.title, listingPage(p, url, guest, listing));
      if (url.pathname === '/back') {
        if (!inBack) return page(res, p, 'The back office', `<section><h1>The back office</h1><p class="lede">This page is for the shop. Staff accounts come later; for the concept, any device can sign in.</p></section><form method="post" action="/staff/start"><button type="submit">Sign in to the back office</button></form>`);
        return page(res, p, 'The back office', backOffice(url));
      }
      send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.');
      else res.end();
    }
  });
  server.on('close', () => clearInterval(sweeper));
  return Object.assign(server, { room });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  server.listen(port, '0.0.0.0', () => console.log(`Showroom on http://localhost:${port}`));
}
