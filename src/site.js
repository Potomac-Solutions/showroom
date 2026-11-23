// The landing page: what a guest sees at `/`. A full-screen photograph and a few words, the
// promise to hold a piece beside a photograph, then the floor itself: every piece as a photo
// card with its price and whether it is still free, live.
//
// The words are in src/shop.js (`site`); the photographs are files in public/photos/, and each
// piece's own are the ones the back office uploaded.
import { escape, art } from './layout.js';
import { photo } from './assets.js';
import { site } from './shop.js';

const picture = (name, alt, { eager = false, cls = '' } = {}) => (photo(name) ? `<img${cls ? ` class="${cls}"` : ''} src="${photo(name)}" alt="${escape(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">` : '');

/**
 * `listings` are the pieces as this guest sees them; `card(listing)` renders one (the server
 * knows the photographs and the live status); `said` is any signed message.
 */
export function landing({ shop, listings, card, said = '', account = null }) {
  const say = (words) => escape(String(words).replace('{hold}', shop.holdHours));
  const { hero, hold, floor, sold, story, steps, visit } = site;
  const free = listings.filter((listing) => listing.state !== 'sold');
  const gone = listings.filter((listing) => listing.state === 'sold').slice(0, 6);
  const cta = (cls = 'go lg') => `<a class="${cls}" href="#floor">${escape(site.cta)}</a>`;

  return `<section class="hero">${picture('hero', '', { eager: true, cls: 'bg' })}
  <div class="wrap hero-words">
    <p class="kicker">${escape(hero.kicker)}</p>
    <h1>${escape(hero.title)} <em>${escape(hero.titleSoft)}</em></h1>
    <p class="lede">${escape(hero.lede)}</p>
    <div class="actions">${cta()}<a class="button ghost lg" href="#how">${escape(hero.secondary)}</a></div>
  </div>
  <div class="hero-strip"><div class="wrap"><p class="live"><span class="dot"></span>${free.length} piece${free.length === 1 ? '' : 's'} on the floor today</p><p>${escape(shop.hours)}</p></div></div>
</section>
<div class="wrap said">${said}</div>

<section class="split"><div class="wrap">
  <div class="pic">${picture('hold', 'A blank tag tied to the arm of an antique chair')}</div>
  <div class="words"><p class="kicker">${escape(hold.kicker)}</p><h2>${escape(hold.heading)}</h2><p>${say(hold.text)}</p><a class="go lg" href="#floor">${escape(hold.button)}</a></div>
</div></section>

<div class="sec menu"><div class="wrap">
  <header class="head center"><p class="kicker">${escape(floor.kicker)}</p><h2 class="big" id="floor">${escape(floor.heading)}</h2><p>${escape(floor.lede)}</p></header>
  ${free.length ? `<ul class="grid">${free.map(card).join('')}</ul>` : '<p class="head center">The floor is empty today. New pieces come in most weeks.</p>'}
  ${gone.length ? `<header class="head center sold-head"><h2 class="big">${escape(sold.heading)}</h2><p>${escape(sold.lede)}</p></header><ul class="grid sold">${gone.map(card).join('')}</ul>` : ''}
</div></div>

<section class="banner" id="story">${picture('depot', '', { cls: 'bg' })}<div class="wrap"><p class="kicker">${escape(story.kicker)}</p><h2>${escape(story.heading)}</h2>${story.paragraphs.map((text) => `<p>${escape(text)}</p>`).join('')}${cta()}</div></section>

<div class="sec how" id="how"><div class="wrap">
  <h2 class="big">${escape(steps.heading)}</h2>
  <ol class="steps">${steps.list.map(([title, text]) => `<li><h3>${say(title)}</h3><p>${say(text)}</p></li>`).join('')}</ol>
</div></div>

<div class="sec dark" id="visit"><div class="wrap">
  <header class="head"><p class="kicker">${escape(visit.kicker)}</p><h2 class="big">${escape(visit.heading)}</h2></header>
  <div class="visit">
    <div>${art.clock}<h3>Hours</h3><p><strong>${escape(shop.hours)}</strong></p></div>
    <div>${art.pin}<h3>The depot</h3><p><strong>${escape(shop.town)}</strong></p><p>${escape(visit.where)}</p></div>
    <div>${art.phone}<h3>Collecting</h3><p>${escape(shop.pickup)}</p><p>${account ? '<a href="/account">Your holds and buys</a> are in your account.' : 'Buying more than once? <a href="/account/sign-up">Make an account</a>.'}</p></div>
  </div>
  <p class="visit-cta">${cta()}</p>
</div></div>`;
}
