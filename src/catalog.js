// What can exist in a house, where it usually lives, and the words people use for it.

export const REQUIRED_ROOMS = ['living room', 'kitchen', 'bedroom', 'bathroom'];
export const EXTRA_ROOMS = ['office', 'dining room', 'laundry room'];

// Furniture is fixed. Objects get placed on it or in front of it.
export const FURNITURE = {
  'living room': ['sofa', 'bookshelf', 'coffee table'],
  kitchen: ['sink', 'fridge', 'counter'],
  bedroom: ['bed', 'wardrobe', 'nightstand'],
  bathroom: ['bathtub', 'towel rack', 'basin'],
  office: ['desk'],
  'dining room': ['dining table'],
  'laundry room': ['washing machine', 'laundry basket'],
};

// Where each piece of furniture is found (inverse of FURNITURE).
export const FURNITURE_ROOM = Object.fromEntries(
  Object.entries(FURNITURE).flatMap(([room, items]) => items.map((f) => [f, room])),
);

// Movable objects.
//   home:   where "tidy up" puts it (first one that exists in this house wins)
//   likely: rooms where it tends to be left lying around, most likely first
export const OBJECTS = {
  mug: { home: ['sink'], likely: ['living room', 'office', 'bedroom'] },
  plate: { home: ['sink'], likely: ['dining room', 'living room', 'kitchen'] },
  apple: { home: ['fridge'], likely: ['kitchen', 'living room', 'dining room'] },
  milk: { home: ['fridge'], likely: ['kitchen', 'dining room', 'living room'] },
  book: { home: ['bookshelf'], likely: ['bedroom', 'office', 'living room'] },
  towel: { home: ['towel rack'], likely: ['bathroom', 'bedroom', 'laundry room'] },
  pillow: { home: ['bed'], likely: ['living room', 'bedroom'] },
  sock: { home: ['laundry basket', 'wardrobe'], likely: ['bedroom', 'bathroom', 'living room'] },
  shirt: { home: ['laundry basket', 'wardrobe'], likely: ['bedroom', 'bathroom', 'laundry room'] },
  remote: { home: ['coffee table'], likely: ['living room', 'bedroom'] },
  laptop: { home: ['desk', 'coffee table'], likely: ['living room', 'bedroom', 'office'] },
  keys: { home: ['counter'], likely: ['living room', 'bedroom', 'kitchen'] },
  toothbrush: { home: ['basin'], likely: ['bathroom', 'bedroom'] },
};

// Words people actually say -> canonical names. Values are arrays because some
// words ("table") could mean more than one thing; the robot uses whichever it finds.
export const SYNONYMS = {
  // objects
  cup: ['mug'], coffee: ['mug'], dish: ['plate'], apples: ['apple'],
  'milk carton': ['milk'], novel: ['book'], socks: ['sock'], 't-shirt': ['shirt'],
  tshirt: ['shirt'], 'tv remote': ['remote'], controller: ['remote'], computer: ['laptop'],
  'car keys': ['keys'], key: ['keys'], cushion: ['pillow'],
  // furniture
  couch: ['sofa'], settee: ['sofa'], bookcase: ['bookshelf'], shelf: ['bookshelf'],
  shelves: ['bookshelf'], refrigerator: ['fridge'], 'kitchen sink': ['sink'],
  tub: ['bathtub'], bath: ['bathtub'], rack: ['towel rack'], 'wash basin': ['basin'],
  'bathroom sink': ['basin'], closet: ['wardrobe'], cupboard: ['wardrobe'],
  'bedside table': ['nightstand'], hamper: ['laundry basket'], basket: ['laundry basket'],
  washer: ['washing machine'], 'kitchen counter': ['counter'], worktop: ['counter'],
  table: ['dining table', 'coffee table', 'desk'],
  // rooms
  lounge: ['living room'], 'sitting room': ['living room'], 'family room': ['living room'],
  washroom: ['bathroom'], toilet: ['bathroom'], study: ['office'], 'laundry': ['laundry room'],
  dining: ['dining room'], 'master bedroom': ['bedroom'],
};

export const ALL_ROOMS = [...REQUIRED_ROOMS, ...EXTRA_ROOMS];
export const ALL_FURNITURE = Object.keys(FURNITURE_ROOM);
export const ALL_OBJECTS = Object.keys(OBJECTS);

// "in the sink" vs "on the sofa"
const INSIDE = new Set(['sink', 'fridge', 'wardrobe', 'bathtub', 'basin', 'washing machine', 'laundry basket']);
export const onOrIn = (furniture) => (INSIDE.has(furniture) ? 'in' : 'on');
