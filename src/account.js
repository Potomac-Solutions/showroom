// A customer's account pages: sign in, sign up, a forgotten password, and their own page.
import { escape } from './layout.js';

export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
const badge = (status, words) => `<span class="badge ${status}">${escape(words)}</span>`;

export function signIn({ problem = '', email = '' } = {}) {
  return `<section><h1>Sign in</h1><p class="lede">See what you hold and have bought on any device. No account? <a href="/account/sign-up">Make one</a>.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-in">
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(email)}"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
  <p><a href="/account/forgot">Forgot your password?</a></p>
</form>`;
}

export function signUp({ problem = '', form = null } = {}) {
  return `<section><h1>Make an account</h1><p class="lede">What you hold and buy follows you to any device. Anything held or bought from this browser joins your account.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-up">
  <label>Your name<input name="name" autocomplete="name" required maxlength="80" value="${escape(form?.get('name') ?? '')}"></label>
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(form?.get('email') ?? '')}"></label>
  <label>Password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Make my account</button>
  <p>Already have one? <a href="/account/sign-in">Sign in</a>.</p>
</form>`;
}

export function forgot({ sent = false } = {}) {
  return `<section><h1>Reset your password</h1><p class="lede">We’ll email a link that works once, for an hour.</p></section>
${sent ? '<p class="ok" role="status">If there’s an account with that email, a link is on its way.</p>' : ''}
<form class="panel" method="post" action="/account/forgot">
  <label>Email<input name="email" type="email" autocomplete="email" required></label>
  <button type="submit">Send the link</button>
</form>`;
}

export function reset({ token, problem = '', works = true }) {
  if (!works) return `<section><h1>That link has expired</h1><p class="lede">It may have been used already. <a href="/account/forgot">Ask for a new one</a>.</p></section>`;
  return `<section><h1>Choose a new password</h1></section>
${problem}
<form class="panel" method="post" action="/account/reset">
  <input type="hidden" name="token" value="${escape(token)}">
  <label>New password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Save and sign in</button>
</form>`;
}

/** The customer's own page: what they hold and what they've bought; their details. */
export function account({ room, guest, customer, said }) {
  const mine = room.mine(guest);
  const held = mine.filter((one) => one.listing.state === 'held');
  const bought = mine.filter((one) => one.listing.state === 'sold');
  const spent = bought.reduce((sum, one) => sum + (one.cents ?? one.listing.price), 0);
  const until = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: room.shop.timeZone });
  const when = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: room.shop.timeZone });
  return `<section><h1>Hello, ${escape(customer.name.split(' ')[0])}</h1><p class="lede">${bought.length ? `${bought.length} piece${bought.length === 1 ? '' : 's'} bought, ${money(spent)} in all.` : 'Nothing bought yet.'} <a href="/#floor">See the floor</a>.</p></section>
${said}
<section class="panel"><h2>Held for you</h2>${held.length ? `<div class="table-wrap"><table><tbody>${held.map((one) => `<tr><td><a href="/l/${one.key}">${escape(one.listing.title)}</a></td><td>until ${escape(until(one.listing.until))}</td><td class="num">${money(one.listing.price)}</td></tr>`).join('')}</tbody></table></div>` : '<p>Nothing on hold.</p>'}</section>
<section class="panel"><h2>Bought</h2>${bought.length ? `<div class="table-wrap"><table><tbody>${bought.map((one) => `<tr><td><a href="/l/${one.key}">${escape(one.listing.title)}</a></td><td>${escape(when(one.at))}</td><td class="num">${money(one.cents ?? one.listing.price)}</td></tr>`).join('')}</tbody></table></div><p class="muted">${escape(room.shop.pickup)}</p>` : '<p>Nothing yet.</p>'}</section>
<section class="two">
  <form class="panel" method="post" action="/account/profile"><h2>Your details</h2><label>Name<input name="name" autocomplete="name" required maxlength="80" value="${escape(customer.name)}"></label><p class="muted">Email: ${escape(customer.email)}</p><button type="submit">Save</button></form>
  <div class="panel"><h2>Signing in</h2><p><a href="/account/forgot">Change your password</a> by email.</p><form method="post" action="/account/sign-out"><button class="button light" type="submit">Sign out</button></form></div>
</section>`;
}
