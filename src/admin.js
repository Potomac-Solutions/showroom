// The admin pages: the shop at a glance, the inventory, sales, questions, customers, reports
// and settings.
//
// Staff see the overview, the inventory (and edit pieces), sales, questions and customers.
// Owners also see reports, settings and the outbox, and can turn a customer's account off.
import { series, totals, breakdown, csv } from '@potomac-solutions/kit/reports';
import { barChart, rankBars } from '@potomac-solutions/kit/charts';
import { escape } from './layout.js';
import { money } from './account.js';

const DAY = 86_400_000;
const PAGE = 25;
const STATE = { available: 'Available', held: 'On hold', sold: 'Sold' };
const badge = (state) => `<span class="badge ${state}">${STATE[state] ?? escape(state)}</span>`;

export const RANGES = {
  '30d': { label: 'Last 30 days', days: 30, by: 'day' },
  '13w': { label: 'Last 13 weeks', days: 91, by: 'week' },
  '12m': { label: 'Last 12 months', days: 365, by: 'month' },
};

export function createAdmin({ room, customers, sent, now = Date.now }) {
  const { shop } = room;
  const zone = shop.timeZone;
  const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone }) : '');
  const short = (start, by) => {
    const date = new Date(`${start}T12:00:00Z`);
    return by === 'month' ? date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const option = (value, words, current) => `<option value="${escape(value)}"${current === value ? ' selected' : ''}>${escape(words)}</option>`;
  const pageOf = (url) => Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pager = (url, base, count, page) => {
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const at = (n) => {
      const next = new URLSearchParams(url.searchParams);
      next.set('page', String(n));
      return `${base}?${next}`;
    };
    return pages > 1 ? `<p class="pager">${page > 1 ? `<a href="${escape(at(page - 1))}">Previous</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${escape(at(page + 1))}">Next</a>` : ''}</p>` : '';
  };
  const daysOnFloor = (sale) => Math.max(0, Math.round((sale.at - (sale.listing.added ?? sale.at)) / DAY));

  // Each page used to wrap itself in the admin's navigation; src/shell.js does that now.
  const frame = (_here, _owner, _bar, body) => body;

  function filterInventory(url) {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
    const state = url.searchParams.get('state') ?? '';
    const category = url.searchParams.get('category') ?? '';
    return room
      .listings()
      .filter((listing) => (!state || listing.state === state) && (!category || (listing.category ?? 'Other') === category) && (!q || [listing.key, listing.title, listing.era, listing.description].some((field) => String(field ?? '').toLowerCase().includes(q))))
      .map((listing) => ({ ...listing, buyer: room.buyer(listing.key) }));
  }
  const saleRows = (list) =>
    list.length
      ? `<div class="table-wrap"><table><thead><tr><th scope="col">Piece</th><th scope="col">Sold</th><th scope="col">How</th><th scope="col">To</th><th scope="col" class="num">Price</th></tr></thead><tbody>${list
          .map((sale) => `<tr><td><a href="/admin/inventory/${sale.key}">${escape(sale.listing.title)}</a><br><small class="muted">${escape(sale.listing.category ?? 'Other')} · ${daysOnFloor(sale)} days on the floor</small></td><td>${dateTime(sale.at)}</td><td>${escape(sale.how)}</td><td>${sale.name ? escape(sale.name) : '<span class="muted">Walk-in</span>'}${sale.customer ? ` <a class="muted" href="/admin/customers/${escape(sale.customer)}">(account)</a>` : ''}</td><td class="num">${money(sale.cents)}</td></tr>`)
          .join('')}</tbody></table></div>`
      : '<p class="muted">Nothing here.</p>';

  return {

    dashboard({ who, owner, bar }) {
      const at = now();
      const sales = room.sales();
      const last30 = sales.filter((sale) => sale.at > at - 30 * DAY);
      const before30 = sales.filter((sale) => sale.at <= at - 30 * DAY && sale.at > at - 60 * DAY);
      const revenue = totals(last30, { amount: (sale) => sale.cents }).amount;
      const earlier = totals(before30, { amount: (sale) => sale.cents }).amount;
      const floor = room.listings().filter((listing) => listing.state !== 'sold');
      const held = floor.filter((listing) => listing.state === 'held');
      const waiting = room.enquiries().filter((one) => !one.answered);
      const people = customers.list();
      const days = series(sales, { at: (sale) => sale.at, amount: (sale) => sale.cents, by: 'day', zone, from: at - 29 * DAY, to: at });
      const activity = room.activity(8);
      const avgDays = last30.length ? Math.round(last30.reduce((n, sale) => n + daysOnFloor(sale), 0) / last30.length) : 0;
      return frame(
        '/admin',
        owner,
        bar,
        `<section class="page-head"><h1>Overview</h1><p class="lede">${escape(shop.name)}. Good to see you, ${escape(who.name.split(' ')[0])}.</p></section>
<div class="tiles">
  <div class="tile"><span>Sales, last 30 days</span><strong>${money(revenue)}</strong><small>${earlier ? `${revenue >= earlier ? '▲' : '▼'} ${Math.abs(Math.round(((revenue - earlier) / earlier) * 100))}% on the 30 days before` : `${last30.length} pieces`}</small></div>
  <div class="tile"><span>Pieces sold, last 30 days</span><strong>${last30.length}</strong><small>${avgDays} days on the floor, on average</small></div>
  <div class="tile"><span>On the floor</span><strong>${floor.length}</strong><small>${money(totals(floor, { amount: (listing) => listing.price }).amount)} at asking prices</small></div>
  <div class="tile"><span>On hold</span><strong>${held.length}</strong><small>for people coming in</small></div>
  <div class="tile"><span>Questions</span><strong>${waiting.length}</strong><small>waiting for a call back</small></div>
  <div class="tile"><span>Customer accounts</span><strong>${people.length}</strong><small>${people.filter((one) => one.at > at - 30 * DAY).length} new in 30 days</small></div>
</div>
<section class="panel"><h2>Sales by day, last 30 days</h2>${barChart(days.map((b) => ({ label: short(b.start, 'day'), value: b.amount, tip: `${short(b.start, 'day')}: ${money(b.amount)} from ${b.count} piece${b.count === 1 ? '' : 's'}` })), { name: 'Sales', format: money })}${owner ? '<p><a href="/admin/reports">All reports</a></p>' : ''}</section>
<section class="panel"><h2>On hold now</h2>${held.length ? `<div class="table-wrap"><table><tbody>${held.map((listing) => { const buyer = room.buyer(listing.key); return `<tr><td><a href="/admin/inventory/${listing.key}">${escape(listing.title)}</a></td><td>${escape(buyer?.name ?? '')}, ${escape(buyer?.phone ?? '')}</td><td>until ${dateTime(listing.until)}</td><td class="num">${money(listing.price)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p>Nothing on hold.</p>'}</section>
<section class="panel"><h2>Latest sales</h2>${saleRows(sales.slice(0, 6))}<p><a href="/admin/sales">Every sale</a></p></section>
<section class="panel"><h2>Staff activity</h2>${activity.length ? `<ul>${activity.map((one) => `<li><strong>${escape(one.by)}</strong> ${escape(one.what)} <small class="muted">${dateTime(one.at)}</small></li>`).join('')}</ul>` : '<p>Nothing yet.</p>'}</section>`,
      );
    },

    inventory({ url, owner, bar }) {
      const list = filterInventory(url);
      const page = pageOf(url);
      const query = new URLSearchParams(url.searchParams);
      query.delete('page');
      return frame(
        '/admin/inventory',
        owner,
        bar,
        `<section class="page-head"><h1>Inventory</h1><p class="lede">${list.length} piece${list.length === 1 ? '' : 's'}, ${money(totals(list, { amount: (listing) => listing.price }).amount)} at asking prices. <a href="/back">Add a piece</a> in the back office.</p></section>
<form class="panel filters" method="get" action="/admin/inventory">
  <label class="grow">Search<input name="q" type="search" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Title, era or code"></label>
  <label>State<select name="state">${option('', 'Any', url.searchParams.get('state') ?? '')}${Object.entries(STATE).map(([value, words]) => option(value, words, url.searchParams.get('state'))).join('')}</select></label>
  <label>Category<select name="category">${option('', 'Any', url.searchParams.get('category') ?? '')}${shop.categories.map((one) => option(one, one, url.searchParams.get('category'))).join('')}</select></label>
  <button type="submit">Show</button>
  <a class="button light" href="/admin/inventory.csv?${escape(String(query))}">Download CSV</a>
</form>
<section class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Piece</th><th scope="col">Category</th><th scope="col">On the floor since</th><th scope="col">State</th><th scope="col" class="num">Price</th></tr></thead><tbody>${list
          .slice((page - 1) * PAGE, page * PAGE)
          .map((listing) => `<tr><td><a href="/admin/inventory/${listing.key}">${escape(listing.title)}</a><br><small class="muted">${escape(listing.era ?? '')}</small></td><td>${escape(listing.category ?? 'Other')}</td><td>${dateTime(listing.added)}</td><td>${badge(listing.state)}</td><td class="num">${money(listing.price)}</td></tr>`)
          .join('')}</tbody></table></div>${pager(url, '/admin/inventory', list.length, page)}</section>`,
      );
    },

    inventoryCsv(url) {
      return csv(filterInventory(url), [
        { key: 'key', label: 'Code' },
        { key: 'title', label: 'Title' },
        { key: 'category', label: 'Category', value: (listing) => listing.category ?? 'Other' },
        { key: 'era', label: 'Era' },
        { key: 'added', label: 'Added', value: (listing) => new Date(listing.added).toISOString() },
        { key: 'state', label: 'State' },
        { key: 'price', label: 'Price (USD)', value: (listing) => listing.price / 100 },
        { key: 'sold', label: 'Sold', value: (listing) => (listing.state === 'sold' && listing.buyer ? new Date(listing.buyer.at).toISOString() : '') },
        { key: 'how', label: 'How', value: (listing) => (listing.state === 'sold' ? listing.buyer?.how : '') },
      ]);
    },

    piece({ listing, owner, bar, said }) {
      const buyer = room.buyer(listing.key);
      const questions = room.enquiries().filter((one) => one.listing === listing.key);
      return frame(
        '/admin/inventory',
        owner,
        bar,
        `<section class="page-head"><a class="back" href="/admin/inventory">All inventory</a><h1>${escape(listing.title)}</h1><p class="lede">${escape(listing.key)} · ${badge(listing.state)} · on the floor since ${dateTime(listing.added)} · <a href="/l/${listing.key}">as guests see it</a></p></section>
${said}
<section class="two">
  <div class="panel"><h2>${listing.state === 'sold' ? 'Sold' : listing.state === 'held' ? 'On hold' : 'Available'}</h2>${
          listing.state === 'available'
            ? '<p>Nobody holds it.</p>'
            : `<dl><dt>How</dt><dd>${escape(buyer?.how ?? '')}</dd><dt>Who</dt><dd>${escape(buyer?.name || 'Walk-in')}${buyer?.customer ? ` <a href="/admin/customers/${escape(buyer.customer)}">(account)</a>` : ''}</dd><dt>Phone</dt><dd>${escape(buyer?.phone || '—')}</dd><dt>${listing.state === 'held' ? 'Until' : 'When'}</dt><dd>${dateTime(listing.state === 'held' ? listing.until : buyer?.at)}</dd>${listing.state === 'sold' ? `<dt>For</dt><dd>${money(buyer?.cents ?? listing.price)}</dd>` : ''}</dl>`
        }
  <div class="filters">${listing.state === 'sold' ? '' : `<form method="post" action="/admin/inventory/${listing.key}/sold"><button type="submit">Sold in the shop</button></form>`}${listing.state === 'held' ? `<form method="post" action="/admin/inventory/${listing.key}/release"><button class="button light" type="submit">Let the hold go</button></form>` : ''}</div></div>
  <div class="panel"><h2>Questions about it</h2>${questions.length ? `<ul>${questions.map((one) => `<li>${escape(one.message)}<br><small class="muted">${escape(one.name)}, ${escape(one.phone)} · ${dateTime(one.at)}${one.answered ? ' · answered' : ''}</small></li>`).join('')}</ul>` : '<p class="muted">Nothing here.</p>'}</div>
</section>
<form class="panel" method="post" action="/admin/inventory/${listing.key}/edit"><h2>Edit</h2>
  <div class="two"><label>Title<input name="title" required maxlength="120" value="${escape(listing.title)}"></label><label>Price ($)<input name="price" inputmode="decimal" required value="${(listing.price / 100).toFixed(2)}"></label></div>
  <div class="two"><label>Category<select name="category">${shop.categories.map((one) => option(one, one, listing.category ?? 'Other')).join('')}</select></label><label>Era<input name="era" maxlength="60" value="${escape(listing.era ?? '')}"></label></div>
  <div class="two"><label>Size<input name="size" maxlength="60" value="${escape(listing.size ?? '')}"></label><label>Condition<input name="condition" maxlength="200" value="${escape(listing.condition ?? '')}"></label></div>
  <label>Description<textarea name="description" rows="3" maxlength="1000">${escape(listing.description ?? '')}</textarea></label>
  <button type="submit">Save</button>${listing.state === 'sold' ? '<p class="muted">It sold for the price it had then; a change here doesn’t alter the sale.</p>' : ''}
</form>`,
      );
    },

    sales({ url, owner, bar }) {
      const how = url.searchParams.get('how') ?? '';
      const list = room.sales().filter((sale) => !how || sale.how === how);
      const page = pageOf(url);
      return frame(
        '/admin/sales',
        owner,
        bar,
        `<section class="page-head"><h1>Sales</h1><p class="lede">${list.length} pieces, ${money(totals(list, { amount: (sale) => sale.cents }).amount)}.</p></section>
<form class="panel filters" method="get" action="/admin/sales"><label>How<select name="how">${option('', 'Online and in the shop', how)}${option('online', 'Online', how)}${option('in the shop', 'In the shop', how)}</select></label><button type="submit">Show</button><a class="button light" href="/admin/sales.csv">Download CSV</a></form>
<section class="panel">${saleRows(list.slice((page - 1) * PAGE, page * PAGE))}${pager(url, '/admin/sales', list.length, page)}</section>`,
      );
    },

    salesCsv() {
      return csv(room.sales(), [
        { key: 'at', label: 'Sold', value: (sale) => new Date(sale.at).toISOString() },
        { key: 'title', label: 'Piece', value: (sale) => sale.listing.title },
        { key: 'category', label: 'Category', value: (sale) => sale.listing.category ?? 'Other' },
        { key: 'how', label: 'How' },
        { key: 'name', label: 'Buyer' },
        { key: 'email', label: 'Email' },
        { key: 'days', label: 'Days on the floor', value: daysOnFloor },
        { key: 'cents', label: 'Price (USD)', value: (sale) => sale.cents / 100 },
      ]);
    },

    questions({ owner, bar, said }) {
      const list = room.enquiries();
      return frame(
        '/admin/questions',
        owner,
        bar,
        `<section class="page-head"><h1>Questions</h1><p class="lede">${list.filter((one) => !one.answered).length} to call back, ${list.filter((one) => one.answered).length} answered.</p></section>
${said}
<section class="panel">${list.length ? list.map((one) => `<article class="message"><p><strong><a href="/admin/inventory/${escape(one.listing)}">${escape(one.title)}</a></strong> ${one.answered ? '<span class="badge sold">Answered</span>' : '<span class="badge held">To call back</span>'} <small class="muted">${dateTime(one.at)}</small></p><p>${escape(one.message)}</p><p class="muted">${escape(one.name)}, ${escape(one.phone)}</p>${one.answered ? '' : `<form method="post" action="/admin/questions/answered"><input type="hidden" name="key" value="${escape(one.key)}"><button class="button light" type="submit">Mark answered</button></form>`}</article>`).join('') : '<p>No questions yet.</p>'}</section>`,
      );
    },

    customers({ url, owner, bar }) {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
      const sales = room.sales();
      const list = customers.list().filter((one) => !q || one.name.toLowerCase().includes(q) || one.email.includes(q));
      const page = pageOf(url);
      return frame(
        '/admin/customers',
        owner,
        bar,
        `<section class="page-head"><h1>Customers</h1><p class="lede">${customers.list().length} with accounts. Anyone can also hold or buy without one.</p></section>
<form class="panel filters" method="get" action="/admin/customers"><label class="grow">Search<input name="q" type="search" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Name or email"></label><button type="submit">Show</button><a class="button light" href="/admin/customers.csv">Download CSV</a></form>
<section class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Customer</th><th scope="col">Joined</th><th scope="col" class="num">Bought</th><th scope="col" class="num">Spent</th></tr></thead><tbody>${list
          .slice((page - 1) * PAGE, page * PAGE)
          .map((one) => {
            const theirs = sales.filter((sale) => sale.customer === one.customer);
            return `<tr><td><a href="/admin/customers/${escape(one.customer)}">${escape(one.name)}</a>${one.disabled ? ' <span class="badge off">Off</span>' : ''}<br><small class="muted">${escape(one.email)}</small></td><td>${dateTime(one.at)}</td><td class="num">${theirs.length}</td><td class="num">${money(totals(theirs, { amount: (sale) => sale.cents }).amount)}</td></tr>`;
          })
          .join('')}</tbody></table></div>${pager(url, '/admin/customers', list.length, page)}</section>`,
      );
    },

    customersCsv() {
      const sales = room.sales();
      return csv(customers.list(), [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'at', label: 'Joined', value: (one) => new Date(one.at).toISOString() },
        { key: 'disabled', label: 'Turned off', value: (one) => (one.disabled ? 'yes' : 'no') },
        { key: 'bought', label: 'Pieces bought', value: (one) => sales.filter((sale) => sale.customer === one.customer).length },
        { key: 'spent', label: 'Spent (USD)', value: (one) => sales.filter((sale) => sale.customer === one.customer).reduce((sum, sale) => sum + sale.cents, 0) / 100 },
      ]);
    },

    customer({ one, owner, bar, said }) {
      const sales = room.sales().filter((sale) => sale.customer === one.customer);
      return frame(
        '/admin/customers',
        owner,
        bar,
        `<section class="page-head"><a class="back" href="/admin/customers">All customers</a><h1>${escape(one.name)}</h1><p class="lede">${escape(one.email)} · joined ${dateTime(one.at)}${one.disabled ? ' · <span class="badge off">Turned off</span>' : ''}</p></section>
${said}
<div class="tiles"><div class="tile"><span>Pieces bought</span><strong>${sales.length}</strong></div><div class="tile"><span>Spent</span><strong>${money(totals(sales, { amount: (sale) => sale.cents }).amount)}</strong></div><div class="tile"><span>Collects</span><strong>${escape(breakdown(sales, { key: (sale) => sale.listing.category ?? 'Other' })[0]?.key ?? '—')}</strong></div></div>
<section class="panel"><h2>Bought</h2>${saleRows(sales)}</section>
${
  owner
    ? `<section class="panel"><h2>Account</h2><p>Turning an account off signs it out everywhere; what it bought stays.</p><div class="filters">${one.disabled ? `<form method="post" action="/admin/customers/${escape(one.customer)}/disabled"><input type="hidden" name="disabled" value="no"><button type="submit">Turn back on</button></form>` : `<details class="confirm"><summary>Turn this account off…</summary><div class="sure"><p><strong>${escape(one.name)} will be signed out everywhere and won’t be able to sign in.</strong> What they have with the shop stays, and an owner can turn the account back on.</p><form method="post" action="/admin/customers/${escape(one.customer)}/disabled"><input type="hidden" name="disabled" value="yes"><button type="submit">Yes, turn it off</button></form></div></details>`}${one.disabled ? '' : `<form method="post" action="/admin/customers/${escape(one.customer)}/reset"><button class="button light" type="submit">Email a reset link</button></form>`}</div></section>`
    : ''
}`,
      );
    },

    report(url) {
      const key = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '30d';
      const { days, by, label } = RANGES[key];
      const to = now();
      const from = to - (days - 1) * DAY;
      const sales = room.sales().filter((sale) => sale.at >= from && sale.at <= to);
      return { key, by, label, from, to, sales, buckets: series(sales, { at: (sale) => sale.at, amount: (sale) => sale.cents, by, zone, from, to }) };
    },

    reports({ url, owner, bar }) {
      const r = this.report(url);
      const sum = totals(r.sales, { amount: (sale) => sale.cents });
      const byCategory = breakdown(r.sales, { key: (sale) => sale.listing.category ?? 'Other', amount: (sale) => sale.cents }).sort((a, b) => b.amount - a.amount);
      const byHow = breakdown(r.sales, { key: (sale) => (sale.how === 'online' ? 'Online' : 'In the shop'), amount: (sale) => sale.cents });
      const added = room.listings().filter((listing) => listing.added >= r.from && listing.added <= r.to).length;
      const ages = [
        ['Within a week', 0, 7],
        ['1 to 4 weeks', 7, 28],
        ['1 to 3 months', 28, 91],
        ['Longer', 91, Infinity],
      ].map(([label, low, high]) => ({ label, value: r.sales.filter((sale) => daysOnFloor(sale) >= low && daysOnFloor(sale) < high).length }));
      const floor = room.listings().filter((listing) => listing.state !== 'sold');
      const stale = floor.filter((listing) => listing.added < now() - 90 * DAY).sort((a, b) => a.added - b.added);
      return frame(
        '/admin/reports',
        owner,
        bar,
        `<section class="page-head"><h1>Reports</h1><p class="lede">${r.label}, by ${r.by}, in the shop’s time (${escape(zone)}). Counted on the day each piece sold.</p></section>
<div class="segments" role="group" aria-label="Range">${Object.entries(RANGES).map(([key, one]) => `<a href="?range=${key}"${key === r.key ? ' aria-current="true"' : ''}>${one.label}</a>`).join('')}</div>
<div class="tiles">
  <div class="tile"><span>Sales</span><strong>${money(sum.amount)}</strong></div>
  <div class="tile"><span>Pieces sold</span><strong>${sum.count}</strong></div>
  <div class="tile"><span>Average sale</span><strong>${money(sum.count ? Math.round(sum.amount / sum.count) : 0)}</strong></div>
  <div class="tile"><span>Pieces added</span><strong>${added}</strong></div>
  <div class="tile"><span>Days to sell</span><strong>${sum.count ? Math.round(r.sales.reduce((n, sale) => n + daysOnFloor(sale), 0) / sum.count) : '—'}</strong><small>on average</small></div>
</div>
<section class="panel"><h2>Sales by ${r.by}</h2>${barChart(r.buckets.map((b) => ({ label: short(b.start, r.by), value: b.amount, tip: `${short(b.start, r.by)}: ${money(b.amount)} from ${b.count} pieces` })), { name: 'Sales', format: money })}<p><a class="button light" href="/admin/reports.csv?range=${r.key}">Download CSV</a></p></section>
<section class="two">
  <div class="panel"><h2>By category</h2>${byCategory.length ? rankBars(byCategory.map((row) => ({ label: row.key, value: row.amount })), { format: money }) : '<p class="muted">Nothing here.</p>'}</div>
  <div class="panel"><h2>Online or in the shop</h2>${byHow.length ? rankBars(byHow.map((row) => ({ label: row.key, value: row.amount })), { format: money }) : '<p class="muted">Nothing here.</p>'}<h2>How long pieces took to sell</h2>${rankBars(ages)}</div>
</section>
<section class="panel"><h2>On the floor more than 90 days</h2>${stale.length ? `<p class="muted">Worth a new photo, a better spot, or a lower price.</p><div class="table-wrap"><table><tbody>${stale.slice(0, 12).map((listing) => `<tr><td><a href="/admin/inventory/${listing.key}">${escape(listing.title)}</a></td><td>${escape(listing.category ?? 'Other')}</td><td>since ${dateTime(listing.added)}</td><td class="num">${money(listing.price)}</td></tr>`).join('')}</tbody></table></div>` : '<p>Nothing has sat that long.</p>'}</section>`,
      );
    },

    reportCsv(url) {
      const r = this.report(url);
      return csv(r.buckets, [
        { key: 'start', label: r.by === 'day' ? 'Day' : r.by === 'week' ? 'Week starting' : 'Month' },
        { key: 'count', label: 'Pieces sold' },
        { key: 'amount', label: 'Sales (USD)', value: (b) => b.amount / 100 },
      ]);
    },

    settings({ owner, bar, said }) {
      return frame(
        '/admin/settings',
        owner,
        bar,
        `<section class="page-head"><h1>Settings</h1><p class="lede">The words guests see. Prices and descriptions are on each piece in the <a href="/admin/inventory">inventory</a>.</p></section>
${said}
<form class="panel" method="post" action="/admin/settings"><h2>The shop</h2>
<label>Hours<input name="hours" maxlength="120" required value="${escape(shop.hours)}"></label>
<label>Pickup<textarea name="pickup" rows="2" maxlength="240" required>${escape(shop.pickup)}</textarea></label>
<p class="muted">A hold lasts ${shop.holdHours} hours.</p>
<button type="submit">Save</button></form>`,
      );
    },

    outbox({ owner, bar }) {
      const list = [...sent].reverse();
      return frame(
        '/admin/outbox',
        owner,
        bar,
        `<section class="page-head"><h1>Outbox</h1><p class="lede">This demo sends no real email. What it would have sent since the server started is here, newest first.</p></section>
<section class="panel">${list.length ? list.map((message) => `<article class="message"><p><strong>${escape(message.subject)}</strong><br><small class="muted">To ${escape(message.to)}</small></p><pre>${escape(message.body)}</pre></article>`).join('') : '<p>Nothing sent yet.</p>'}</section>`,
      );
    },
  };
}
