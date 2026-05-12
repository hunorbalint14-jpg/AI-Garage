export type DefaultProduct = {
  name: string;
  category: string;
  unit_price: number;
  cost_price?: number;
};

export const PRODUCT_CATEGORIES = [
  "Engine",
  "Brakes",
  "Suspension",
  "Tyres",
  "Electrical",
  "Filters",
  "Consumables",
  "Exhaust",
  "Cooling",
  "Bodywork",
  "Other",
] as const;

export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

// Default UK garage parts. Prices are typical RRP — garages adjust to their margins.
export const DEFAULT_PRODUCTS: DefaultProduct[] = [
  // Engine oils
  { name: "Engine oil 5W-30 (5L)",  category: "Consumables", unit_price: 35.00, cost_price: 22.00 },
  { name: "Engine oil 5W-40 (5L)",  category: "Consumables", unit_price: 38.00, cost_price: 24.00 },
  { name: "Engine oil 10W-40 (5L)", category: "Consumables", unit_price: 30.00, cost_price: 18.00 },
  { name: "Engine oil 0W-30 (5L)",  category: "Consumables", unit_price: 45.00, cost_price: 28.00 },

  // Filters
  { name: "Oil filter (standard)",  category: "Filters", unit_price: 12.00, cost_price: 5.00 },
  { name: "Air filter (standard)",  category: "Filters", unit_price: 18.00, cost_price: 7.00 },
  { name: "Cabin filter (pollen)",  category: "Filters", unit_price: 22.00, cost_price: 9.00 },
  { name: "Fuel filter (diesel)",   category: "Filters", unit_price: 35.00, cost_price: 18.00 },
  { name: "Fuel filter (petrol)",   category: "Filters", unit_price: 28.00, cost_price: 12.00 },

  // Brakes
  { name: "Front brake pads",       category: "Brakes", unit_price: 55.00, cost_price: 25.00 },
  { name: "Rear brake pads",        category: "Brakes", unit_price: 50.00, cost_price: 22.00 },
  { name: "Front brake discs (pair)",category: "Brakes", unit_price: 95.00, cost_price: 48.00 },
  { name: "Rear brake discs (pair)", category: "Brakes", unit_price: 85.00, cost_price: 42.00 },
  { name: "Brake fluid DOT 4 (1L)",  category: "Brakes", unit_price: 12.00, cost_price: 5.00 },
  { name: "Brake calliper (front)",  category: "Brakes", unit_price: 145.00, cost_price: 80.00 },

  // Suspension
  { name: "Front shock absorber",   category: "Suspension", unit_price: 85.00, cost_price: 45.00 },
  { name: "Rear shock absorber",    category: "Suspension", unit_price: 75.00, cost_price: 40.00 },
  { name: "Front coil spring",      category: "Suspension", unit_price: 65.00, cost_price: 32.00 },
  { name: "Control arm (front)",    category: "Suspension", unit_price: 95.00, cost_price: 48.00 },
  { name: "Anti-roll bar link",     category: "Suspension", unit_price: 25.00, cost_price: 10.00 },

  // Tyres
  { name: "Tyre 195/65 R15 (budget)", category: "Tyres", unit_price: 65.00, cost_price: 38.00 },
  { name: "Tyre 205/55 R16 (budget)", category: "Tyres", unit_price: 75.00, cost_price: 45.00 },
  { name: "Tyre 225/45 R17 (premium)",category: "Tyres", unit_price: 145.00, cost_price: 95.00 },
  { name: "Tyre 245/40 R18 (premium)",category: "Tyres", unit_price: 175.00, cost_price: 115.00 },
  { name: "TPMS sensor",              category: "Tyres", unit_price: 45.00, cost_price: 22.00 },
  { name: "Wheel balance weights (set)", category: "Tyres", unit_price: 8.00, cost_price: 3.00 },

  // Electrical
  { name: "Car battery 063",        category: "Electrical", unit_price: 85.00, cost_price: 48.00 },
  { name: "Car battery 096 (large)",category: "Electrical", unit_price: 110.00, cost_price: 68.00 },
  { name: "Headlight bulb H7",      category: "Electrical", unit_price: 15.00, cost_price: 5.00 },
  { name: "Headlight bulb H4",      category: "Electrical", unit_price: 14.00, cost_price: 5.00 },
  { name: "Wiper blade pair (front)",category: "Electrical", unit_price: 28.00, cost_price: 12.00 },
  { name: "Wiper blade (rear)",     category: "Electrical", unit_price: 14.00, cost_price: 6.00 },
  { name: "Spark plug (set of 4)",  category: "Electrical", unit_price: 35.00, cost_price: 18.00 },

  // Engine bay
  { name: "Timing belt kit",        category: "Engine", unit_price: 165.00, cost_price: 95.00 },
  { name: "Aux belt",               category: "Engine", unit_price: 32.00, cost_price: 14.00 },
  { name: "Water pump",             category: "Engine", unit_price: 75.00, cost_price: 38.00 },

  // Cooling
  { name: "Antifreeze G12+ (5L)",   category: "Cooling", unit_price: 22.00, cost_price: 12.00 },
  { name: "Thermostat",             category: "Cooling", unit_price: 28.00, cost_price: 12.00 },
  { name: "Radiator (standard)",    category: "Cooling", unit_price: 145.00, cost_price: 85.00 },

  // Exhaust
  { name: "Exhaust mid-box",        category: "Exhaust", unit_price: 95.00, cost_price: 55.00 },
  { name: "Exhaust rear box",       category: "Exhaust", unit_price: 110.00, cost_price: 65.00 },
  { name: "Exhaust mount/bracket",  category: "Exhaust", unit_price: 12.00, cost_price: 5.00 },
  { name: "Exhaust paste",          category: "Exhaust", unit_price: 8.00, cost_price: 3.00 },

  // Consumables
  { name: "Screenwash concentrate (5L)",category: "Consumables", unit_price: 10.00, cost_price: 4.00 },
  { name: "AdBlue (10L)",            category: "Consumables", unit_price: 18.00, cost_price: 9.00 },
  { name: "Grease cartridge",         category: "Consumables", unit_price: 6.00, cost_price: 2.50 },
  { name: "Brake cleaner (500ml)",    category: "Consumables", unit_price: 7.00, cost_price: 3.00 },
];

// UK parts supplier deep-link templates. ${name} replaced with URL-encoded query.
export type Supplier = {
  id: string;
  name: string;
  searchUrl: (query: string) => string;
};

export const SUPPLIERS: Supplier[] = [
  {
    id: "ecp",
    name: "Euro Car Parts",
    searchUrl: (q) => `https://www.eurocarparts.com/search?searchTerm=${encodeURIComponent(q)}`,
  },
  {
    id: "gsf",
    name: "GSF Car Parts",
    searchUrl: (q) => `https://www.gsfcarparts.com/search?Type=Search&keyword=${encodeURIComponent(q)}`,
  },
  {
    id: "halfords",
    name: "Halfords Trade",
    searchUrl: (q) => `https://www.halfordstradesupplies.com/search?searchKeywords=${encodeURIComponent(q)}`,
  },
  {
    id: "carparts4less",
    name: "CarParts4Less",
    searchUrl: (q) => `https://www.carparts4less.co.uk/search?searchTerm=${encodeURIComponent(q)}`,
  },
];
