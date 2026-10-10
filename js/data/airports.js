// Airports. size: 1 (regional) .. 5 (major hub) – drives slot price and landing fees.
// To expand the world, just append entries (and towns nearby in towns.js).
FG.data.airports = [
  // Switzerland
  { code: 'BRN', name: 'Bern-Belp', city: 'Bern', country: 'CH', lat: 46.914, lon: 7.499, size: 1 },
  { code: 'ZRH', name: 'Zurich', city: 'Zurich', country: 'CH', lat: 47.464, lon: 8.549, size: 4 },
  { code: 'GVA', name: 'Geneva', city: 'Geneva', country: 'CH', lat: 46.238, lon: 6.109, size: 3 },
  { code: 'BSL', name: 'EuroAirport Basel-Mulhouse', city: 'Basel', country: 'CH', lat: 47.590, lon: 7.529, size: 2 },
  { code: 'LUG', name: 'Lugano', city: 'Lugano', country: 'CH', lat: 46.004, lon: 8.911, size: 1 },
  // UK & Ireland
  { code: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB', lat: 51.470, lon: -0.454, size: 5 },
  { code: 'LGW', name: 'London Gatwick', city: 'London', country: 'GB', lat: 51.148, lon: -0.190, size: 4 },
  { code: 'MAN', name: 'Manchester', city: 'Manchester', country: 'GB', lat: 53.354, lon: -2.275, size: 3 },
  { code: 'EDI', name: 'Edinburgh', city: 'Edinburgh', country: 'GB', lat: 55.950, lon: -3.373, size: 3 },
  { code: 'DUB', name: 'Dublin', city: 'Dublin', country: 'IE', lat: 53.421, lon: -6.270, size: 4 },
  // France
  { code: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'FR', lat: 49.010, lon: 2.548, size: 5 },
  { code: 'ORY', name: 'Paris Orly', city: 'Paris', country: 'FR', lat: 48.723, lon: 2.379, size: 4 },
  { code: 'LYS', name: 'Lyon Saint-Exupéry', city: 'Lyon', country: 'FR', lat: 45.726, lon: 5.091, size: 2 },
  { code: 'NCE', name: 'Nice Côte d\'Azur', city: 'Nice', country: 'FR', lat: 43.658, lon: 7.216, size: 3 },
  { code: 'MRS', name: 'Marseille Provence', city: 'Marseille', country: 'FR', lat: 43.437, lon: 5.215, size: 2 },
  // Benelux
  { code: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'NL', lat: 52.310, lon: 4.768, size: 5 },
  { code: 'BRU', name: 'Brussels', city: 'Brussels', country: 'BE', lat: 50.901, lon: 4.484, size: 4 },
  // Germany & Austria
  { code: 'FRA', name: 'Frankfurt', city: 'Frankfurt', country: 'DE', lat: 50.033, lon: 8.570, size: 5 },
  { code: 'MUC', name: 'Munich', city: 'Munich', country: 'DE', lat: 48.354, lon: 11.786, size: 5 },
  { code: 'BER', name: 'Berlin Brandenburg', city: 'Berlin', country: 'DE', lat: 52.366, lon: 13.503, size: 4 },
  { code: 'HAM', name: 'Hamburg', city: 'Hamburg', country: 'DE', lat: 53.630, lon: 9.988, size: 3 },
  { code: 'DUS', name: 'Düsseldorf', city: 'Düsseldorf', country: 'DE', lat: 51.289, lon: 6.767, size: 3 },
  { code: 'STR', name: 'Stuttgart', city: 'Stuttgart', country: 'DE', lat: 48.690, lon: 9.222, size: 3 },
  { code: 'VIE', name: 'Vienna', city: 'Vienna', country: 'AT', lat: 48.110, lon: 16.570, size: 4 },
  // Central & Eastern Europe
  { code: 'PRG', name: 'Prague', city: 'Prague', country: 'CZ', lat: 50.101, lon: 14.260, size: 3 },
  { code: 'WAW', name: 'Warsaw Chopin', city: 'Warsaw', country: 'PL', lat: 52.166, lon: 20.967, size: 3 },
  { code: 'KRK', name: 'Kraków', city: 'Kraków', country: 'PL', lat: 50.078, lon: 19.785, size: 2 },
  { code: 'BUD', name: 'Budapest', city: 'Budapest', country: 'HU', lat: 47.437, lon: 19.256, size: 3 },
  { code: 'ZAG', name: 'Zagreb', city: 'Zagreb', country: 'HR', lat: 45.743, lon: 16.069, size: 1 },
  { code: 'BEG', name: 'Belgrade', city: 'Belgrade', country: 'RS', lat: 44.818, lon: 20.309, size: 2 },
  { code: 'OTP', name: 'Bucharest Otopeni', city: 'Bucharest', country: 'RO', lat: 44.572, lon: 26.102, size: 3 },
  { code: 'SOF', name: 'Sofia', city: 'Sofia', country: 'BG', lat: 42.697, lon: 23.411, size: 2 },
  { code: 'RIX', name: 'Riga', city: 'Riga', country: 'LV', lat: 56.924, lon: 23.971, size: 2 },
  // Nordics
  { code: 'CPH', name: 'Copenhagen', city: 'Copenhagen', country: 'DK', lat: 55.618, lon: 12.656, size: 4 },
  { code: 'ARN', name: 'Stockholm Arlanda', city: 'Stockholm', country: 'SE', lat: 59.652, lon: 17.919, size: 4 },
  { code: 'OSL', name: 'Oslo Gardermoen', city: 'Oslo', country: 'NO', lat: 60.194, lon: 11.100, size: 4 },
  { code: 'HEL', name: 'Helsinki', city: 'Helsinki', country: 'FI', lat: 60.317, lon: 24.963, size: 3 },
  { code: 'KEF', name: 'Reykjavík Keflavík', city: 'Reykjavík', country: 'IS', lat: 63.985, lon: -22.605, size: 2 },
  // Iberia
  { code: 'MAD', name: 'Madrid Barajas', city: 'Madrid', country: 'ES', lat: 40.472, lon: -3.561, size: 5 },
  { code: 'BCN', name: 'Barcelona El Prat', city: 'Barcelona', country: 'ES', lat: 41.297, lon: 2.078, size: 4 },
  { code: 'PMI', name: 'Palma de Mallorca', city: 'Palma', country: 'ES', lat: 39.552, lon: 2.739, size: 3 },
  { code: 'AGP', name: 'Málaga', city: 'Málaga', country: 'ES', lat: 36.675, lon: -4.499, size: 3 },
  { code: 'LIS', name: 'Lisbon', city: 'Lisbon', country: 'PT', lat: 38.774, lon: -9.134, size: 4 },
  { code: 'OPO', name: 'Porto', city: 'Porto', country: 'PT', lat: 41.248, lon: -8.681, size: 2 },
  // Italy
  { code: 'FCO', name: 'Rome Fiumicino', city: 'Rome', country: 'IT', lat: 41.800, lon: 12.239, size: 5 },
  { code: 'MXP', name: 'Milan Malpensa', city: 'Milan', country: 'IT', lat: 45.630, lon: 8.723, size: 4 },
  { code: 'VCE', name: 'Venice Marco Polo', city: 'Venice', country: 'IT', lat: 45.505, lon: 12.352, size: 2 },
  { code: 'NAP', name: 'Naples', city: 'Naples', country: 'IT', lat: 40.886, lon: 14.291, size: 2 },
  // Southeast
  { code: 'ATH', name: 'Athens', city: 'Athens', country: 'GR', lat: 37.936, lon: 23.947, size: 4 },
  { code: 'IST', name: 'Istanbul', city: 'Istanbul', country: 'TR', lat: 41.262, lon: 28.742, size: 5 },
];
