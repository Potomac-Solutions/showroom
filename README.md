# Showroom

Unique stock, for a shop where every piece is one of a kind: antiques, consignment, vintage, a gallery, used gear. Each piece has its photos and its story; a guest can hold it till tomorrow, buy it online, or ask about it, and every open page shows at once when it's held or sold. A Potomac Solutions platform, built on the Potomac kit and [Zubra](https://github.com/zubra-js/zubra).

The shop it starts with, Old Depot Antiques & Consignment in Frostburg, Maryland, is made up. Nothing here is really for sale, and payments are in test mode.

## Try it

`npm install`, then `npm run demo`: it fills the shop with six months of made-up pieces coming in and selling, forty customers, today's holds and questions, and starts it on http://localhost:3000. It prints three demo sign-ins, for this machine only:

| Who | Email | Password | Where |
| --- | --- | --- | --- |
| Owner | `owner@example.com` | `old-depot-owner-demo` | `/admin`: everything |
| Staff | `floor@example.com` | `old-depot-staff-demo` | `/admin` (overview, inventory, sales, questions, customers), `/back` |
| Customer | `riley@example.com` | `old-depot-guest-demo` | `/account` |

The demo's pieces have no photos (each card says "Photo coming"); add some from the back office. `npm start` alone keeps what's there; with no data it prints a setup link for the first owner instead. `npm run seed` fills an empty shop, and `npm run seed -- --fresh` starts over.

**The public side**
1. **The landing page** (`/`): the shop, how holding and buying work, and the floor: everything for sale, then the six latest sales.
2. **Hold a piece.** Give a name and a phone number, and **Hold it**: it's yours until this time tomorrow. In another window it says **On hold** without a reload.
3. **Buy online** with any card number (`4000 0000 0000 0002` is declined). It shows **Sold** everywhere, and a receipt lands in the owner's **Outbox**.
4. **An account** (`/account`): sign up, and holds and purchases from this browser join it. Signed in on another device, what you hold is still yours: buy it from there. **Forgot your password?** sends a one-time link (to the Outbox, and the server's log).

**The admin** (`/admin`, staff sign-in)
5. **Overview**: sales for the last 30 days against the 30 before, how long pieces take to sell, what's on the floor and at what asking prices, what's on hold and for whom, questions waiting, new accounts, sales by day, the latest sales, and what the staff did.
6. **Inventory**: search, filter by state and category, CSV. A piece's page edits it, sells it in the shop, lets its hold go, and shows the questions about it.
7. **Sales** (online and in the shop, as CSV), **Questions** (mark them answered) and **Customers** (what each bought; an owner can turn an account off or email a reset link).
8. **Reports** (owners): sales by day, week or month in the shop's time zone, by category, online against in the shop, how long pieces took to sell, pieces added, and what's sat more than 90 days; with CSV.
9. **Settings** (owners): the hours and pickup words.
10. **The back office** (`/back`): add a piece with photos, sell at the counter, let holds go.
11. **Without JavaScript** (turn it off in the browser's settings), all of it works the same.

## The public demo

With `DEMO=1` the server is a demo anyone can try, back office included (`src/demo.js`):

- It runs on the seeded data (`npm run demo` seeds fresh, then serves), so the admin, reports and screens are full from the first visit.
- The sign-in pages show the demo sign-ins:

  | Who | Email | Password |
  | --- | --- | --- |
  | Owner | `owner@example.com` | `old-depot-owner-demo` |
  | Staff | `floor@example.com` | `old-depot-staff-demo` |
  | Customer | `riley@example.com` | `old-depot-guest-demo` |

- Nobody can change a demo account: not its password, roles, name or reset link, and nobody can turn it off. Everything else a visitor does lasts until the reset, including people they invite.
- Once a day at 4 am New York time the server exits, and Railway's "always" restart policy starts it again with `npm run demo`: fresh data dated today, and the same sign-ins.

## Deploy the demo on Railway

`railway.json` sets the build, the start command (`npm run demo`), the health check (`/health`) and the restart policy (`ALWAYS`).

1. In Railway, make a service from `Potomac-Solutions/showroom`, from the `main` branch. No volume is needed: every start seeds fresh.
2. Set its variables:

   ```
   DEMO=1
   NODE_ENV=production
   SESSION_SECRET=<a long random string>
   TRUST_PROXIES=1
   PUBLIC_URL=https://<the demo's address>
   ```
3. Give it a domain under **Settings → Networking**, and keep it at one replica.

For a real business, leave out `DEMO`, set `DATA_DIR` to a mounted volume, start it with `npm start`, and claim the first owner's setup link from the deploy log.

## How it is put together

| Piece | Job |
| --- | --- |
| Potomac kit (private) | `hold` (each piece is a pool of one: held for a day, held for the minutes a payment takes, or taken for good), `pay` (its test provider, one charge per piece), `files` (photos, kept by their hash; only real images), `staff` and `staff/pages` (the owner and staff: passwords, sessions, invites, roles, and their pages), `auth` (guest and staff cookies), `store` (the Sync log) |
| `@zubra/server` | Renders every page before any JavaScript runs |
| `@zubra/sync` | The log (one SQLite file). Each listing and whether it's free are documents only the server writes; pages follow them live, and never read who holds or bought a piece |
| `src/shop.js` | The shop: name, hours, how long a hold lasts, the pieces it starts with |
| `src/showroom.js` | The shop's side: the floor, holds, buying, questions, adding and editing pieces, sold in the shop, what follows a customer account, the owner's settings and the staff activity |
| `kit/customers`, `kit/reports`, `kit/charts` | Customer accounts; the numbers by day, week or month, and CSV; charts drawn on the server as SVG, with a table under each |
| `src/account.js`, `src/admin.js` | The account pages; the admin |
| `bin/seed.js` | The demo data |
| `listing-status` | The live badge: Available, On hold until…, Held for you until…, Sold |

## Run it

```sh
npm install      # needs read access to the private Potomac kit repository
npm start        # http://localhost:3000
npm test         # needs Chrome or Playwright's Chromium
```

Node 26. `SESSION_SECRET` is required in production; `DATA_DIR` says where the database file and the photos go. Behind a proxy (Railway, Fly, a load balancer), set `TRUST_PROXIES` to how many add to `X-Forwarded-For` (usually `1`), so a wrong-password lockout falls on the device guessing and not on everyone; left unset, no header is trusted and every sign-in counts as the proxy's address.

## What the tests prove

1. Without JavaScript: the floor and a piece's page; a hold till tomorrow, with the time; someone else sees it on hold and can't hold, buy or let it go; the back office sees who; the holder lets it go.
2. A hold needs a name and a full phone number; a question needs both and the question, and reaches the back office.
3. Buying online charges once and sells it for good; a declined card lets the piece go, or keeps the hold the buyer already had; a sold piece can't be held or bought again and goes to the end of the floor.
4. Two people buying the same piece at the same moment: one gets it, the other is told.
5. The floor is live: a hold, the staff letting it go, and a sale in the shop over someone's hold reach every open page at once.
6. A hold runs out after its time: the piece is free for someone else, live pages show it free even before the sweep, and the sweep writes it down.
7. The back office adds a piece with photos (the same picture twice is one file) and serves them; it refuses anything that isn't an image, a missing title or price, and anyone who isn't signed in; another site's post is refused.
8. A page reads the listings and whether each is free, nothing else, even when it asks: no names, no phone numbers. It writes nothing.

The admin, customer accounts and reports (`test/admin.test.js`, over plain HTTP):

9. The landing page leads with the shop, then the floor; a guest sees no admin link.
10. A hold made before signing up joins the account; signed in on another device it's theirs and can be bought there; the sale shows on both, and its receipt is in the outbox.
11. A forgotten password gets the same page whether or not the account exists; the emailed link works once.
12. The admin needs a staff sign-in; staff get no reports, settings or outbox (403) and their settings posts change nothing; owners get them all.
13. Staff edit a piece (a bad price is refused) and sell it in the shop from the admin, once; it's in the sales and the activity; a later price change doesn't alter the sale.
14. A question reaches the admin and is marked answered.
15. The report's sales match the sales and its CSV adds up to them; a title starting with `=` opens in a spreadsheet as text.
16. A turned-off customer is signed out; only an owner can turn them back on.

Every behaviour was broken on purpose once to check a test fails (24 of 26 caught). The two that can't be: a page may write nothing because every collection is the server's (the check stays as a safety belt), and a photo address must be a hash because the kit's `files` already refuses any other name.

## How it looks

- **The landing page** (`/`) is photo-led: a full-screen photograph with **See the floor**, the promise to hold a piece beside a photograph, the floor as photo cards with price and live status, the depot's story over a photograph, three steps, and where to find it. Its words are in `src/shop.js` (`site`); `src/site.js` lays them out.
- **A piece with no photograph of its own** shows a photograph of its kind of thing (by category), marked "Photo coming", so the floor never looks empty and nobody mistakes the picture for the piece.
- **Photographs** for the page are files in `public/photos/` (`hero`, `hold`, `depot`, and one per category), as `.jpg` or `.webp`. Replace a file and restart. The ones here were generated for this made-up shop; see `public/photos/README.md`. A piece's own photographs are still the ones the back office uploads.
- **Styles** are files in `public/`: `base.css`, `site.css` (the landing page), `customer.css` (a piece, the account) and `app.css` (the back office and the admin). `src/assets.js` serves them, the photographs and the two typefaces (Playfair Display and Lato, from `@fontsource`, self-hosted) at `/assets/…`, cached by a hash of their bytes.
- **The staff's side** has its own page frame (`src/shell.js`): a sidebar at a desk; on a phone a bar on top, tabs along the bottom and the sidebar as a sheet. Light or dark follows the device, with a switch that remembers. Unanswered questions are counted beside **Questions**.
- **Tables** become cards on a phone (`src/tables.js`).
- **Search engines** are asked not to list the page, because the shop is made up. Set `listed: true` in `src/shop.js` for a real one.
- **Checks.** With the demo running, `npm run design-check` opens every page in a browser at five widths, light and dark.

## Not yet

- More of the owner's admin: the shop's name and how long a hold lasts are still in `src/shop.js` (hours and pickup words are editable). Changing a piece's photos after it's listed.
- Consignors: who brought a piece in, their split, and a page where they see what sold.
- Texts when a hold is about to run out, real email (receipts and reset links go to the outbox), shipping, and a real payment provider.
