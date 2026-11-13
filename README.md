# Showroom

Unique stock, for a shop where every piece is one of a kind: antiques, consignment, vintage, a gallery, used gear. Each piece has its photos and its story; a guest can hold it till tomorrow, buy it online, or ask about it, and every open page shows at once when it's held or sold. A Potomac Solutions platform, built on the [kit](https://github.com/Potomac-Solutions/kit) and [Zubra](https://github.com/journey-to-code-org/zubra).

The shop it starts with, Old Depot Antiques & Consignment in Frostburg, Maryland, is made up. Nothing here is really for sale, and payments are in test mode.

## Try it

`npm install`, then `npm start`, and open http://localhost:3000. Two browser windows side by side (one private, so it's another person) show the live parts best.

**Staff sign in with their own accounts.** The first time, nobody has one, so the server prints a setup link: open it to make the owner (your email, name and a password). The owner's **People** page invites the rest of the staff (an invite is a link to send them), resets passwords and turns people off.

1. **Hold a piece.** Open the railroad lantern, give a name and a phone number, and **Hold it**. It's held for you until this time tomorrow.
2. **Watch the floor.** In the other window, the lantern's card says **On hold** without a reload, and the piece can't be held or bought there. **Let it go** in the first window, and it's **Available** again in both.
3. **Buy online.** Buy the rug with any card number (`4000 0000 0000 0002` is declined, to see that: a piece you weren't holding goes straight back on the floor). Once bought, it shows **Sold** everywhere and moves to the end of the floor.
4. **Ask about it.** Send a question about the pitcher.
5. **The back office.** Open **The back office** from the footer and sign in. Add a piece with a couple of photos from your phone or computer; it's on the floor at once. Mark something **Sold in the shop** (a walk-in paid cash), let a hold go, and read the question from step 4, with the name and number to call back.
6. **Without JavaScript** (turn it off in the browser's settings), all of it works the same.

## How it is put together

| Piece | Job |
| --- | --- |
| [Potomac kit](https://github.com/Potomac-Solutions/kit) (private) | `hold` (each piece is a pool of one: held for a day, held for the minutes a payment takes, or taken for good), `pay` (its test provider, one charge per piece), `files` (photos, kept by their hash; only real images), `staff` and `staff/pages` (the owner and staff: passwords, sessions, invites, roles, and their pages), `auth` (guest and staff cookies), `store` (the Sync log) |
| `@zubra/server` | Renders every page before any JavaScript runs |
| `@zubra/sync` | The log (one SQLite file). Each listing and whether it's free are documents only the server writes; pages follow them live, and never read who holds or bought a piece |
| `src/shop.js` | The shop: name, hours, how long a hold lasts, the pieces it starts with |
| `src/showroom.js` | The shop's side: the floor, holds, buying, questions, adding pieces, sold in the shop |
| `listing-status` | The live badge: Available, On hold until…, Held for you until…, Sold |

## Run it

```sh
npm install      # needs read access to the private Potomac-Solutions/kit repository
npm start        # http://localhost:3000
npm test         # needs Chrome or Playwright's Chromium
```

Node 22.13 or later. `SESSION_SECRET` is required in production; `DATA_DIR` says where the database file and the photos go. Behind a proxy (Railway, Fly, a load balancer), set `TRUST_PROXIES` to how many add to `X-Forwarded-For` (usually `1`), so a wrong-password lockout falls on the device guessing and not on everyone; left unset, no header is trusted and every sign-in counts as the proxy's address.

## What the tests prove

1. Without JavaScript: the floor and a piece's page; a hold till tomorrow, with the time; someone else sees it on hold and can't hold, buy or let it go; the back office sees who; the holder lets it go.
2. A hold needs a name and a full phone number; a question needs both and the question, and reaches the back office.
3. Buying online charges once and sells it for good; a declined card lets the piece go, or keeps the hold the buyer already had; a sold piece can't be held or bought again and goes to the end of the floor.
4. Two people buying the same piece at the same moment: one gets it, the other is told.
5. The floor is live: a hold, the staff letting it go, and a sale in the shop over someone's hold reach every open page at once.
6. A hold runs out after its time: the piece is free for someone else, live pages show it free even before the sweep, and the sweep writes it down.
7. The back office adds a piece with photos (the same picture twice is one file) and serves them; it refuses anything that isn't an image, a missing title or price, and anyone who isn't signed in; another site's post is refused.
8. A page reads the listings and whether each is free, nothing else, even when it asks: no names, no phone numbers. It writes nothing.

Every behaviour was broken on purpose once to check a test fails (24 of 26 caught). The two that can't be: a page may write nothing because every collection is the server's (the check stays as a safety belt), and a photo address must be a hash because the kit's `files` already refuses any other name.

## Not yet

- The owner's admin: the shop's details and how long a hold lasts, now in `src/shop.js`. Editing a piece or its photos after it's listed.
- Consignors: who brought a piece in, their split, and a page where they see what sold.
- Texts when a hold is about to run out (the kit's `notify`), shipping, and a real payment provider.
