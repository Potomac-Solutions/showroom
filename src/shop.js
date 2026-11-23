// The shop Showroom starts with. The owner edits the hours and pickup words from the admin;
// listings are added, edited and sold from the staff pages.
//
// A made-up shop in a real town, so the demo reads like the trade without being anyone's.

export const shop = {
  id: 'depot',
  name: 'Old Depot Antiques & Consignment',
  short: 'Old Depot',
  town: 'Frostburg, Maryland',
  timeZone: 'America/New_York',
  hours: 'Open Thursday to Sunday, 10 am to 5 pm',
  concept: 'Concept by Potomac Solutions. Old Depot Antiques & Consignment is a made-up shop; nothing here is really for sale.',
  pickup: 'Collect it from the front counter in opening hours; bring help for anything heavy.',
  /** How long a hold lasts. */
  holdHours: 24,
  /** Listed in search engines? Off for a made-up shop; a real one turns it on. */
  listed: false,
  /** What the floor is sorted into, for the admin and the reports. */
  categories: ['Furniture', 'Lighting', 'Textiles', 'Pottery and glass', 'Railroadiana', 'Tools', 'Art and frames', 'Other'],
};

/** What the shop starts with. Photos are added from the staff page. Prices in whole cents. */
export const seedListings = [
  { category: 'Furniture', title: 'Oak washstand with mirror', price: 34000, condition: 'Good; one drawer pull replaced', era: 'About 1900', size: '30 × 18 × 64 in', description: 'Quarter-sawn oak, original finish on the top, harp mirror that tilts.' },
  { category: 'Railroadiana', title: 'B&O Railroad lantern', price: 18500, condition: 'Very good; red globe, no cracks', era: '1920s', size: '10 in tall', description: 'Adams & Westlake, marked B&O on the frame. Still takes a wick.' },
  { category: 'Textiles', title: 'Hand-hooked rug', price: 22000, condition: 'Good; light wear at one corner', era: '1940s', size: '3 × 5 ft', description: 'Wool on burlap, a farmhouse with a red barn and three hens.' },
  { category: 'Furniture', title: 'Set of six ladderback chairs', price: 48000, condition: 'Sound; seats rewoven last year', era: 'Late 1800s', size: 'Seat height 17 in', description: 'Maple, splint seats, from a farm sale near Grantsville.' },
  { category: 'Pottery and glass', title: 'Fiesta pitcher, cobalt', price: 6500, condition: 'Excellent', era: '1940s', size: '2 qt', description: 'The disc pitcher, marked on the base. No chips.' },
];

/**
 * Every word on the landing page that isn't a piece. Change the page here, not in src/site.js.
 * `{hold}` is filled from `holdHours` above, so the words can't drift from the rule.
 */
export const site = {
  description: 'Antiques, vintage and consignment in the old depot at Frostburg, Maryland. Every piece is the only one: hold it till tomorrow, or buy it before someone else does.',
  trade: 'Antiques & Consignment',
  cta: 'See the floor',
  hero: {
    kicker: 'Frostburg, Maryland · in the old depot',
    title: 'One of a kind.',
    titleSoft: 'Gone when it’s gone.',
    lede: 'Antiques and consignment, photographed the day they come in.',
    secondary: 'How it works',
  },
  hold: {
    kicker: 'Seen something?',
    heading: 'We’ll hold it till tomorrow.',
    text: 'Free, for {hold} hours, with a name and a phone number. Come and see it in person before you decide, or buy it here and it’s yours.',
    button: 'See the floor',
  },
  floor: { kicker: 'On the floor today', heading: 'Fresh in. Going out.', lede: 'When a piece is held or sold, every open page shows it at once.' },
  sold: { heading: 'Just sold', lede: 'Too late for these. The good ones go quickly.' },
  story: {
    kicker: 'The depot',
    heading: 'Trains stopped here once.',
    paragraphs: [
      'The last passenger train left in the fifties. The building sat empty until the shop moved in with a truckload of oak and a lot of lanterns.',
      'Half of what’s on the floor is on consignment from families up and down the county. Every piece has a story, and we write down what we’re told.',
    ],
  },
  steps: {
    heading: 'How it works',
    list: [
      ['Find it', 'Browse the floor from your phone.'],
      ['Hold it or buy it', 'Hold it free for {hold} hours, or pay now.'],
      ['Collect it', 'From the front counter. Bring help for the heavy ones.'],
    ],
  },
  visit: { kicker: 'Find us', heading: 'Visit', where: 'The brick depot beside the old platform. Park along the track side; the wide doors are for loading.' },
  foot: { line: 'Antiques, vintage and consignment. Every piece is the only one.', built: 'Built by Potomac Solutions', builtHref: 'https://potomac.solutions' },
};
