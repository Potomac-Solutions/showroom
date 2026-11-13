// The shop Showroom starts with. Everything here is data the owner will edit from an admin page
// (a later step); listings are added and sold from the staff pages.
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
};

/** What the shop starts with. Photos are added from the staff page. Prices in whole cents. */
export const seedListings = [
  { title: 'Oak washstand with mirror', price: 34000, condition: 'Good; one drawer pull replaced', era: 'About 1900', size: '30 × 18 × 64 in', description: 'Quarter-sawn oak, original finish on the top, harp mirror that tilts.' },
  { title: 'B&O Railroad lantern', price: 18500, condition: 'Very good; red globe, no cracks', era: '1920s', size: '10 in tall', description: 'Adams & Westlake, marked B&O on the frame. Still takes a wick.' },
  { title: 'Hand-hooked rug', price: 22000, condition: 'Good; light wear at one corner', era: '1940s', size: '3 × 5 ft', description: 'Wool on burlap, a farmhouse with a red barn and three hens.' },
  { title: 'Set of six ladderback chairs', price: 48000, condition: 'Sound; seats rewoven last year', era: 'Late 1800s', size: 'Seat height 17 in', description: 'Maple, splint seats, from a farm sale near Grantsville.' },
  { title: 'Fiesta pitcher, cobalt', price: 6500, condition: 'Excellent', era: '1940s', size: '2 qt', description: 'The disc pitcher, marked on the base. No chips.' },
];
