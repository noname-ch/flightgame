// Aircraft types. Add new entries here; the key is used in save games.
// costPerBlockHour = fuel + maintenance, leasePerWeek = lease rate on the market.
// price = new purchase price; if left out it is leasePerWeek * FG.config.market.priceWeeks.
// minAirport = smallest airport size (1-5) the type can operate from.
// year = first year in airline service, endYear = last year it was built (story mode: js/data/story.js).
// Optional: runwayM (runway it needs), cruiseFt, pilots (3 = with a flight engineer), and its flight performance
// where it differs from its category's (js/game.js perf): climbFpm near the ground, vLofKmh lift-off and vAppKmh
// approach speed, bankDeg.
FG.data.aircraftCategories = {
  turboprop: 'Turboprop',
  regional: 'Regional jet',
  narrowbody: 'Narrowbody',
  widebody: 'Widebody',
  classic: 'Classic',
};

FG.data.aircraft = {
  // ---------- turboprops ----------
  'DHC6-400': { name: 'DHC-6 Twin Otter 400', maker: 'De Havilland Canada', category: 'turboprop', seats: 19, rangeKm: 1480, speedKmh: 300, costPerBlockHour: 700, leasePerWeek: 5000, minAirport: 1, year: 2010, climbFpm: 1600, vLofKmh: 130, vAppKmh: 145 },
  'DO228NG': { name: 'Dornier 228NG', maker: 'RUAG', category: 'turboprop', seats: 19, rangeKm: 1100, speedKmh: 400, costPerBlockHour: 750, leasePerWeek: 5500, minAirport: 1, year: 2010, climbFpm: 1900, vLofKmh: 150, vAppKmh: 170 },
  'B1900D': { name: 'Beechcraft 1900D', maker: 'Beechcraft', category: 'turboprop', seats: 19, rangeKm: 1200, speedKmh: 520, costPerBlockHour: 900, leasePerWeek: 6000, minAirport: 1, year: 1991, endYear: 2002, climbFpm: 2600, vLofKmh: 190, vAppKmh: 200 },
  'DO328': { name: 'Dornier 328', maker: 'Dornier', category: 'turboprop', seats: 33, rangeKm: 1300, speedKmh: 620, costPerBlockHour: 1100, leasePerWeek: 8000, minAirport: 1, year: 1993, endYear: 2000, climbFpm: 2500, vLofKmh: 200, vAppKmh: 210 },
  'SAAB340': { name: 'Saab 340B', maker: 'Saab', category: 'turboprop', seats: 34, rangeKm: 1700, speedKmh: 500, costPerBlockHour: 1100, leasePerWeek: 7500, minAirport: 1, year: 1989, endYear: 1999, climbFpm: 2000, vLofKmh: 190, vAppKmh: 200 },
  'SAAB2000': { name: 'Saab 2000', maker: 'Saab', category: 'turboprop', seats: 50, rangeKm: 2800, speedKmh: 665, costPerBlockHour: 1500, leasePerWeek: 9500, minAirport: 1, year: 1994, endYear: 1999, climbFpm: 2250, vLofKmh: 220, vAppKmh: 230 },
  'ATR42-600': { name: 'ATR 42-600', maker: 'ATR', category: 'turboprop', seats: 48, rangeKm: 1300, speedKmh: 540, costPerBlockHour: 1300, leasePerWeek: 10000, minAirport: 1, year: 2012, climbFpm: 1600, vLofKmh: 190, vAppKmh: 200 },
  'ATR72-600': { name: 'ATR 72-600', maker: 'ATR', category: 'turboprop', seats: 72, rangeKm: 1500, speedKmh: 510, costPerBlockHour: 1600, leasePerWeek: 13000, minAirport: 1, year: 2011, climbFpm: 1350, vLofKmh: 200, vAppKmh: 210 },
  'Q400': { name: 'De Havilland Dash 8-400', maker: 'De Havilland Canada', category: 'turboprop', seats: 78, rangeKm: 2000, speedKmh: 660, costPerBlockHour: 1900, leasePerWeek: 16000, minAirport: 1, year: 2000, climbFpm: 2400, vLofKmh: 220, vAppKmh: 230 },

  // from the story years
  'VC-700': { name: 'Vickers Viscount 700', maker: 'Vickers', category: 'turboprop', seats: 48, rangeKm: 2200, speedKmh: 510, costPerBlockHour: 1500, leasePerWeek: 7000, minAirport: 1, runwayM: 1300, year: 1953, endYear: 1959, climbFpm: 1200, vLofKmh: 190, vAppKmh: 200 },
  'BRIT-310': { name: 'Bristol Britannia 310', maker: 'Bristol', category: 'turboprop', seats: 120, rangeKm: 6800, speedKmh: 575, costPerBlockHour: 3200, leasePerWeek: 11000, minAirport: 3, runwayM: 2000, pilots: 3, year: 1957, endYear: 1960, climbFpm: 1400, vLofKmh: 230, vAppKmh: 240 },
  'F27': { name: 'Fokker F27 Friendship', maker: 'Fokker', category: 'turboprop', seats: 48, rangeKm: 1900, speedKmh: 460, costPerBlockHour: 1200, leasePerWeek: 6000, minAirport: 1, runwayM: 1100, year: 1958, endYear: 1987, climbFpm: 1400, vLofKmh: 190, vAppKmh: 200 },
  'L-188': { name: 'Lockheed L-188 Electra', maker: 'Lockheed', category: 'turboprop', seats: 98, rangeKm: 4000, speedKmh: 600, costPerBlockHour: 2600, leasePerWeek: 9000, minAirport: 2, runwayM: 1600, pilots: 3, year: 1959, endYear: 1961, climbFpm: 1700, vLofKmh: 230, vAppKmh: 235 },
  'IL-18': { name: 'Ilyushin Il-18', maker: 'Ilyushin', category: 'turboprop', seats: 100, rangeKm: 5000, speedKmh: 625, costPerBlockHour: 2800, leasePerWeek: 8000, minAirport: 2, runwayM: 1800, pilots: 3, year: 1959, endYear: 1978, climbFpm: 1500, vLofKmh: 230, vAppKmh: 240 },
  'TU-114': { name: 'Tupolev Tu-114', maker: 'Tupolev', category: 'turboprop', seats: 170, rangeKm: 8900, speedKmh: 770, costPerBlockHour: 5500, leasePerWeek: 14000, minAirport: 4, runwayM: 2500, cruiseFt: 30000, pilots: 3, year: 1961, endYear: 1963, climbFpm: 1500, vLofKmh: 280, vAppKmh: 280 },
  'HS748': { name: 'Hawker Siddeley HS 748', maker: 'Hawker Siddeley', category: 'turboprop', seats: 48, rangeKm: 1700, speedKmh: 450, costPerBlockHour: 1250, leasePerWeek: 5800, minAirport: 1, runwayM: 1100, year: 1962, endYear: 1988, climbFpm: 1300, vLofKmh: 180, vAppKmh: 190 },
  'YS-11': { name: 'NAMC YS-11', maker: 'NAMC', category: 'turboprop', seats: 60, rangeKm: 1400, speedKmh: 470, costPerBlockHour: 1500, leasePerWeek: 6500, minAirport: 1, runwayM: 1200, year: 1965, endYear: 1974, climbFpm: 1200, vLofKmh: 190, vAppKmh: 200 },
  'EMB110': { name: 'Embraer EMB 110 Bandeirante', maker: 'Embraer', category: 'turboprop', seats: 18, rangeKm: 1900, speedKmh: 400, costPerBlockHour: 700, leasePerWeek: 4000, minAirport: 1, year: 1973, endYear: 1990, climbFpm: 1500, vLofKmh: 160, vAppKmh: 170 },
  'DHC6': { name: 'DHC-6 Twin Otter', maker: 'De Havilland Canada', category: 'turboprop', seats: 19, rangeKm: 1400, speedKmh: 300, costPerBlockHour: 650, leasePerWeek: 4000, minAirport: 1, year: 1966, endYear: 1988, climbFpm: 1600, vLofKmh: 130, vAppKmh: 145 },
  'DHC7': { name: 'De Havilland Canada Dash 7', maker: 'De Havilland Canada', category: 'turboprop', seats: 50, rangeKm: 1300, speedKmh: 430, costPerBlockHour: 1500, leasePerWeek: 7000, minAirport: 1, runwayM: 800, year: 1978, endYear: 1988, climbFpm: 1200, vLofKmh: 150, vAppKmh: 155 },
  'DASH8-100': { name: 'De Havilland Canada Dash 8-100', maker: 'De Havilland Canada', category: 'turboprop', seats: 37, rangeKm: 1900, speedKmh: 490, costPerBlockHour: 1100, leasePerWeek: 7500, minAirport: 1, year: 1984, endYear: 2005, climbFpm: 1800, vLofKmh: 180, vAppKmh: 180 },
  'EMB120': { name: 'Embraer EMB 120 Brasília', maker: 'Embraer', category: 'turboprop', seats: 30, rangeKm: 1750, speedKmh: 550, costPerBlockHour: 1000, leasePerWeek: 6500, minAirport: 1, year: 1985, endYear: 2001, climbFpm: 2000, vLofKmh: 200, vAppKmh: 210 },
  'ATR42-300': { name: 'ATR 42-300', maker: 'ATR', category: 'turboprop', seats: 48, rangeKm: 1300, speedKmh: 490, costPerBlockHour: 1350, leasePerWeek: 8000, minAirport: 1, year: 1985, endYear: 1996, climbFpm: 1600, vLofKmh: 190, vAppKmh: 200 },
  'F50': { name: 'Fokker 50', maker: 'Fokker', category: 'turboprop', seats: 56, rangeKm: 2000, speedKmh: 520, costPerBlockHour: 1450, leasePerWeek: 9000, minAirport: 1, year: 1987, endYear: 1997, climbFpm: 1500, vLofKmh: 195, vAppKmh: 205 },
  'ATR72-500': { name: 'ATR 72-500', maker: 'ATR', category: 'turboprop', seats: 70, rangeKm: 1500, speedKmh: 510, costPerBlockHour: 1650, leasePerWeek: 11000, minAirport: 1, year: 1997, endYear: 2011, climbFpm: 1350, vLofKmh: 200, vAppKmh: 210 },
  // ---------- regional jets ----------
  'ERJ145': { name: 'Embraer ERJ 145', maker: 'Embraer', category: 'regional', seats: 50, rangeKm: 2900, speedKmh: 830, costPerBlockHour: 2100, leasePerWeek: 11000, minAirport: 1, year: 1996, endYear: 2020 },
  'CRJ200': { name: 'Bombardier CRJ200', maker: 'Bombardier', category: 'regional', seats: 50, rangeKm: 3000, speedKmh: 810, costPerBlockHour: 2200, leasePerWeek: 12000, minAirport: 1, year: 1996, endYear: 2006 },
  'CRJ900': { name: 'Bombardier CRJ900', maker: 'Bombardier', category: 'regional', seats: 90, rangeKm: 2900, speedKmh: 830, costPerBlockHour: 2700, leasePerWeek: 20000, minAirport: 1, year: 2003, endYear: 2020 },
  'E175': { name: 'Embraer E175', maker: 'Embraer', category: 'regional', seats: 88, rangeKm: 3700, speedKmh: 830, costPerBlockHour: 2600, leasePerWeek: 21000, minAirport: 1, year: 2005, climbFpm: 3000, vLofKmh: 260, vAppKmh: 240 },
  'E190': { name: 'Embraer E190', maker: 'Embraer', category: 'regional', seats: 100, rangeKm: 4500, speedKmh: 830, costPerBlockHour: 2800, leasePerWeek: 24000, minAirport: 1, year: 2005, climbFpm: 2900, vLofKmh: 265, vAppKmh: 245 },
  'E195': { name: 'Embraer E195', maker: 'Embraer', category: 'regional', seats: 120, rangeKm: 4200, speedKmh: 830, costPerBlockHour: 3000, leasePerWeek: 26000, minAirport: 1, year: 2006, climbFpm: 2800, vLofKmh: 270, vAppKmh: 250 },
  'E190-E2': { name: 'Embraer E190-E2', maker: 'Embraer', category: 'regional', seats: 104, rangeKm: 5300, speedKmh: 830, costPerBlockHour: 2600, leasePerWeek: 27000, minAirport: 1, year: 2018 },
  'E195-E2': { name: 'Embraer E195-E2', maker: 'Embraer', category: 'regional', seats: 132, rangeKm: 4800, speedKmh: 830, costPerBlockHour: 3000, leasePerWeek: 30000, minAirport: 1, year: 2019 },
  'SSJ100': { name: 'Sukhoi Superjet 100', maker: 'Sukhoi', category: 'regional', seats: 98, rangeKm: 4500, speedKmh: 830, costPerBlockHour: 2900, leasePerWeek: 17000, minAirport: 1, year: 2011 },
  'F100': { name: 'Fokker 100', maker: 'Fokker', category: 'regional', seats: 100, rangeKm: 3100, speedKmh: 780, costPerBlockHour: 3000, leasePerWeek: 13000, minAirport: 1, year: 1988, endYear: 1997 },
  'RJ100': { name: 'Avro RJ100', maker: 'BAE Systems', category: 'regional', seats: 100, rangeKm: 2900, speedKmh: 760, costPerBlockHour: 3100, leasePerWeek: 13000, minAirport: 1, year: 1993, endYear: 2002 },

  // from the story years
  'BAC111': { name: 'BAC One-Eleven 200', maker: 'BAC', category: 'regional', seats: 79, rangeKm: 2200, speedKmh: 770, costPerBlockHour: 3200, leasePerWeek: 8000, minAirport: 1, runwayM: 1700, year: 1965, endYear: 1982 },
  'TU-134': { name: 'Tupolev Tu-134', maker: 'Tupolev', category: 'regional', seats: 76, rangeKm: 2000, speedKmh: 850, costPerBlockHour: 3600, leasePerWeek: 7500, minAirport: 2, runwayM: 2200, pilots: 3, year: 1967, endYear: 1984, climbFpm: 2300, vLofKmh: 290, vAppKmh: 265 },
  'YAK-40': { name: 'Yakovlev Yak-40', maker: 'Yakovlev', category: 'regional', seats: 32, rangeKm: 1800, speedKmh: 550, costPerBlockHour: 1700, leasePerWeek: 5000, minAirport: 1, runwayM: 1100, pilots: 3, year: 1968, endYear: 1981 },
  'F28': { name: 'Fokker F28 Fellowship', maker: 'Fokker', category: 'regional', seats: 65, rangeKm: 2000, speedKmh: 780, costPerBlockHour: 2600, leasePerWeek: 7000, minAirport: 1, runwayM: 1500, year: 1969, endYear: 1987 },
  'VFW614': { name: 'VFW-Fokker 614', maker: 'VFW-Fokker', category: 'regional', seats: 44, rangeKm: 1200, speedKmh: 700, costPerBlockHour: 2000, leasePerWeek: 5500, minAirport: 1, runwayM: 1300, year: 1975, endYear: 1977 },
  'BAE146': { name: 'BAe 146-200', maker: 'BAe', category: 'regional', seats: 95, rangeKm: 2000, speedKmh: 750, costPerBlockHour: 3000, leasePerWeek: 11000, minAirport: 1, runwayM: 1400, year: 1983, endYear: 1993 },
  'CRJ100': { name: 'Canadair CRJ100', maker: 'Bombardier', category: 'regional', seats: 50, rangeKm: 2500, speedKmh: 810, costPerBlockHour: 2300, leasePerWeek: 11000, minAirport: 1, year: 1992, endYear: 1996 },
  'F70': { name: 'Fokker 70', maker: 'Fokker', category: 'regional', seats: 80, rangeKm: 3300, speedKmh: 780, costPerBlockHour: 2700, leasePerWeek: 13000, minAirport: 1, year: 1995, endYear: 1997 },
  'CRJ700': { name: 'Bombardier CRJ700', maker: 'Bombardier', category: 'regional', seats: 70, rangeKm: 3100, speedKmh: 830, costPerBlockHour: 2400, leasePerWeek: 17000, minAirport: 1, year: 2001, endYear: 2020 },
  'E170': { name: 'Embraer E170', maker: 'Embraer', category: 'regional', seats: 72, rangeKm: 3900, speedKmh: 830, costPerBlockHour: 2400, leasePerWeek: 19000, minAirport: 1, year: 2004 },
  // ---------- narrowbodies ----------
  'A220-100': { name: 'Airbus A220-100', maker: 'Airbus', category: 'narrowbody', seats: 120, rangeKm: 6300, speedKmh: 830, costPerBlockHour: 2900, leasePerWeek: 31000, minAirport: 1, year: 2016, climbFpm: 3100, vLofKmh: 265, vAppKmh: 240 },
  'A220-300': { name: 'Airbus A220-300', maker: 'Airbus', category: 'narrowbody', seats: 145, rangeKm: 6300, speedKmh: 830, costPerBlockHour: 3200, leasePerWeek: 35000, minAirport: 1, year: 2016, climbFpm: 3000, vLofKmh: 270, vAppKmh: 245 },
  'A318': { name: 'Airbus A318', maker: 'Airbus', category: 'narrowbody', seats: 120, rangeKm: 5700, speedKmh: 830, costPerBlockHour: 3300, leasePerWeek: 25000, minAirport: 1, year: 2003, endYear: 2013, climbFpm: 3000, vLofKmh: 265, vAppKmh: 240 },
  'A319': { name: 'Airbus A319', maker: 'Airbus', category: 'narrowbody', seats: 140, rangeKm: 6900, speedKmh: 830, costPerBlockHour: 3500, leasePerWeek: 32000, minAirport: 1, year: 1996, climbFpm: 2800, vLofKmh: 270, vAppKmh: 245 },
  'A320': { name: 'Airbus A320ceo', maker: 'Airbus', category: 'narrowbody', seats: 170, rangeKm: 6100, speedKmh: 830, costPerBlockHour: 3900, leasePerWeek: 38000, minAirport: 1, year: 1988 },
  'A320neo': { name: 'Airbus A320neo', maker: 'Airbus', category: 'narrowbody', seats: 180, rangeKm: 6300, speedKmh: 840, costPerBlockHour: 3800, leasePerWeek: 45000, minAirport: 1, year: 2016 },
  'A321': { name: 'Airbus A321ceo', maker: 'Airbus', category: 'narrowbody', seats: 200, rangeKm: 5900, speedKmh: 830, costPerBlockHour: 4500, leasePerWeek: 44000, minAirport: 2, year: 1994, climbFpm: 2400, vLofKmh: 295, vAppKmh: 260 },
  'A321neo': { name: 'Airbus A321neo', maker: 'Airbus', category: 'narrowbody', seats: 220, rangeKm: 7400, speedKmh: 840, costPerBlockHour: 4300, leasePerWeek: 52000, minAirport: 2, year: 2017, climbFpm: 2500, vLofKmh: 295, vAppKmh: 260 },
  'A321XLR': { name: 'Airbus A321XLR', maker: 'Airbus', category: 'narrowbody', seats: 200, rangeKm: 8700, speedKmh: 840, costPerBlockHour: 4400, leasePerWeek: 58000, minAirport: 2, year: 2024, climbFpm: 2300, vLofKmh: 300, vAppKmh: 265 },
  'B737-700': { name: 'Boeing 737-700', maker: 'Boeing', category: 'narrowbody', seats: 140, rangeKm: 6300, speedKmh: 830, costPerBlockHour: 3500, leasePerWeek: 30000, minAirport: 1, year: 1998, endYear: 2019 },
  'B737-800': { name: 'Boeing 737-800', maker: 'Boeing', category: 'narrowbody', seats: 189, rangeKm: 5400, speedKmh: 840, costPerBlockHour: 4000, leasePerWeek: 40000, minAirport: 1, year: 1998, endYear: 2019 },
  'B737-8': { name: 'Boeing 737 MAX 8', maker: 'Boeing', category: 'narrowbody', seats: 189, rangeKm: 6500, speedKmh: 840, costPerBlockHour: 3700, leasePerWeek: 46000, minAirport: 1, year: 2017 },
  'B737-9': { name: 'Boeing 737 MAX 9', maker: 'Boeing', category: 'narrowbody', seats: 210, rangeKm: 6500, speedKmh: 840, costPerBlockHour: 4000, leasePerWeek: 50000, minAirport: 2, year: 2018, climbFpm: 2400, vLofKmh: 300, vAppKmh: 270 },
  'B757-200': { name: 'Boeing 757-200', maker: 'Boeing', category: 'narrowbody', seats: 200, rangeKm: 7200, speedKmh: 850, costPerBlockHour: 5200, leasePerWeek: 36000, minAirport: 2, year: 1983, endYear: 2004, climbFpm: 3500, vLofKmh: 290, vAppKmh: 250 },
  'C919': { name: 'COMAC C919', maker: 'COMAC', category: 'narrowbody', seats: 164, rangeKm: 4100, speedKmh: 830, costPerBlockHour: 3800, leasePerWeek: 36000, minAirport: 1, year: 2023 },
  'MD-82': { name: 'McDonnell Douglas MD-82', maker: 'McDonnell Douglas', category: 'narrowbody', seats: 155, rangeKm: 3800, speedKmh: 810, costPerBlockHour: 4300, leasePerWeek: 17000, minAirport: 1, year: 1981, endYear: 1999, climbFpm: 2200, vLofKmh: 290, vAppKmh: 265 },

  // from the story years
  'TU-104': { name: 'Tupolev Tu-104A', maker: 'Tupolev', category: 'narrowbody', seats: 70, rangeKm: 2650, speedKmh: 800, costPerBlockHour: 4200, leasePerWeek: 9000, minAirport: 3, runwayM: 2200, cruiseFt: 33000, pilots: 3, year: 1956, endYear: 1960, climbFpm: 2200, vLofKmh: 320, vAppKmh: 300 },
  'COMET4': { name: 'de Havilland Comet 4', maker: 'de Havilland', category: 'narrowbody', seats: 81, rangeKm: 5200, speedKmh: 800, costPerBlockHour: 4500, leasePerWeek: 12000, minAirport: 3, runwayM: 2100, pilots: 3, year: 1958, endYear: 1964, climbFpm: 2000, vLofKmh: 300, vAppKmh: 280 },
  'B707-120': { name: 'Boeing 707-120', maker: 'Boeing', category: 'narrowbody', seats: 140, rangeKm: 5000, speedKmh: 880, costPerBlockHour: 6200, leasePerWeek: 15000, minAirport: 3, runwayM: 2700, cruiseFt: 35000, pilots: 3, year: 1958, endYear: 1965, climbFpm: 2000, vLofKmh: 320, vAppKmh: 290 },
  'CARAVELLE': { name: 'Sud Aviation Caravelle III', maker: 'Sud Aviation', category: 'narrowbody', seats: 80, rangeKm: 2300, speedKmh: 780, costPerBlockHour: 3600, leasePerWeek: 9000, minAirport: 2, runwayM: 1800, cruiseFt: 33000, year: 1959, endYear: 1972, climbFpm: 2200, vLofKmh: 280, vAppKmh: 255 },
  'CV-880': { name: 'Convair 880', maker: 'Convair', category: 'narrowbody', seats: 110, rangeKm: 4600, speedKmh: 900, costPerBlockHour: 5600, leasePerWeek: 11000, minAirport: 3, runwayM: 2600, pilots: 3, year: 1960, endYear: 1962, climbFpm: 2300, vLofKmh: 320, vAppKmh: 290 },
  'B720': { name: 'Boeing 720', maker: 'Boeing', category: 'narrowbody', seats: 130, rangeKm: 5500, speedKmh: 880, costPerBlockHour: 5600, leasePerWeek: 13000, minAirport: 3, runwayM: 2300, pilots: 3, year: 1960, endYear: 1967, climbFpm: 2400, vLofKmh: 300, vAppKmh: 270 },
  'DC-8-50': { name: 'Douglas DC-8-50', maker: 'Douglas', category: 'narrowbody', seats: 150, rangeKm: 9000, speedKmh: 900, costPerBlockHour: 6500, leasePerWeek: 16000, minAirport: 4, runwayM: 2800, pilots: 3, year: 1961, endYear: 1968, climbFpm: 2200, vLofKmh: 320, vAppKmh: 285 },
  'B707-320B': { name: 'Boeing 707-320B', maker: 'Boeing', category: 'narrowbody', seats: 160, rangeKm: 9900, speedKmh: 900, costPerBlockHour: 7000, leasePerWeek: 18000, minAirport: 4, runwayM: 3000, pilots: 3, year: 1962, endYear: 1979, climbFpm: 2200, vLofKmh: 320, vAppKmh: 280 },
  'B727-100': { name: 'Boeing 727-100', maker: 'Boeing', category: 'narrowbody', seats: 120, rangeKm: 4100, speedKmh: 890, costPerBlockHour: 5000, leasePerWeek: 12000, minAirport: 2, runwayM: 1800, pilots: 3, year: 1964, endYear: 1972, climbFpm: 2800, vLofKmh: 280, vAppKmh: 250 },
  'VC10': { name: 'Vickers VC10', maker: 'Vickers', category: 'narrowbody', seats: 135, rangeKm: 9400, speedKmh: 900, costPerBlockHour: 7400, leasePerWeek: 15000, minAirport: 4, runwayM: 2500, pilots: 3, year: 1964, endYear: 1970, climbFpm: 2300, vLofKmh: 300, vAppKmh: 265 },
  'TRIDENT': { name: 'Hawker Siddeley Trident 1C', maker: 'Hawker Siddeley', category: 'narrowbody', seats: 100, rangeKm: 2400, speedKmh: 940, costPerBlockHour: 4300, leasePerWeek: 9500, minAirport: 2, runwayM: 2000, pilots: 3, year: 1964, endYear: 1978, climbFpm: 2400, vLofKmh: 310, vAppKmh: 280 },
  'DC-9-30': { name: 'Douglas DC-9-30', maker: 'Douglas', category: 'narrowbody', seats: 115, rangeKm: 2800, speedKmh: 810, costPerBlockHour: 3700, leasePerWeek: 10000, minAirport: 1, runwayM: 1800, year: 1967, endYear: 1982 },
  'B727-200': { name: 'Boeing 727-200', maker: 'Boeing', category: 'narrowbody', seats: 150, rangeKm: 3900, speedKmh: 880, costPerBlockHour: 5600, leasePerWeek: 13000, minAirport: 2, runwayM: 2000, pilots: 3, year: 1967, endYear: 1984, climbFpm: 2500, vLofKmh: 290, vAppKmh: 260 },
  'IL-62': { name: 'Ilyushin Il-62', maker: 'Ilyushin', category: 'narrowbody', seats: 168, rangeKm: 9200, speedKmh: 850, costPerBlockHour: 7600, leasePerWeek: 14000, minAirport: 4, runwayM: 3000, pilots: 3, year: 1967, endYear: 1995, climbFpm: 2000, vLofKmh: 320, vAppKmh: 285 },
  'DC-8-63': { name: 'Douglas DC-8-63', maker: 'Douglas', category: 'narrowbody', seats: 220, rangeKm: 7300, speedKmh: 870, costPerBlockHour: 8200, leasePerWeek: 20000, minAirport: 4, runwayM: 3000, pilots: 3, year: 1967, endYear: 1972, climbFpm: 2000, vLofKmh: 330, vAppKmh: 290 },
  'B737-200': { name: 'Boeing 737-200', maker: 'Boeing', category: 'narrowbody', seats: 115, rangeKm: 3500, speedKmh: 780, costPerBlockHour: 3500, leasePerWeek: 10000, minAirport: 1, runwayM: 1800, year: 1968, endYear: 1988 },
  'TU-154': { name: 'Tupolev Tu-154', maker: 'Tupolev', category: 'narrowbody', seats: 164, rangeKm: 3900, speedKmh: 900, costPerBlockHour: 6200, leasePerWeek: 12000, minAirport: 3, runwayM: 2300, pilots: 3, year: 1972, endYear: 1998, climbFpm: 2500, vLofKmh: 300, vAppKmh: 270 },
  'DC-9-50': { name: 'Douglas DC-9-50', maker: 'McDonnell Douglas', category: 'narrowbody', seats: 135, rangeKm: 3000, speedKmh: 800, costPerBlockHour: 4000, leasePerWeek: 12000, minAirport: 1, runwayM: 1900, year: 1975, endYear: 1981 },
  'MD-81': { name: 'McDonnell Douglas MD-81', maker: 'McDonnell Douglas', category: 'narrowbody', seats: 150, rangeKm: 2900, speedKmh: 810, costPerBlockHour: 4200, leasePerWeek: 15000, minAirport: 1, year: 1980, endYear: 1994, climbFpm: 2200, vLofKmh: 290, vAppKmh: 265 },
  'B737-300': { name: 'Boeing 737-300', maker: 'Boeing', category: 'narrowbody', seats: 140, rangeKm: 4200, speedKmh: 800, costPerBlockHour: 3700, leasePerWeek: 22000, minAirport: 1, year: 1984, endYear: 1999 },
  'B717': { name: 'Boeing 717-200', maker: 'Boeing', category: 'narrowbody', seats: 106, rangeKm: 3800, speedKmh: 810, costPerBlockHour: 3200, leasePerWeek: 24000, minAirport: 1, year: 1999, endYear: 2006, climbFpm: 2800, vLofKmh: 270, vAppKmh: 250 },
  // ---------- widebodies ----------
  'B767-300ER': { name: 'Boeing 767-300ER', maker: 'Boeing', category: 'widebody', seats: 220, rangeKm: 11000, speedKmh: 850, costPerBlockHour: 6900, leasePerWeek: 60000, minAirport: 3, year: 1988 },
  'A330-200': { name: 'Airbus A330-200', maker: 'Airbus', category: 'widebody', seats: 250, rangeKm: 13400, speedKmh: 870, costPerBlockHour: 7200, leasePerWeek: 80000, minAirport: 3, year: 1998 },
  'A330-300': { name: 'Airbus A330-300', maker: 'Airbus', category: 'widebody', seats: 290, rangeKm: 11700, speedKmh: 870, costPerBlockHour: 7600, leasePerWeek: 85000, minAirport: 3, year: 1994, climbFpm: 2000, vLofKmh: 300, vAppKmh: 265 },
  'A330-900': { name: 'Airbus A330-900neo', maker: 'Airbus', category: 'widebody', seats: 290, rangeKm: 13300, speedKmh: 870, costPerBlockHour: 6900, leasePerWeek: 100000, minAirport: 3, year: 2018 },
  'B787-8': { name: 'Boeing 787-8', maker: 'Boeing', category: 'widebody', seats: 240, rangeKm: 13600, speedKmh: 900, costPerBlockHour: 6400, leasePerWeek: 95000, minAirport: 3, year: 2011, climbFpm: 2700, vLofKmh: 290, vAppKmh: 255 },
  'B787-9': { name: 'Boeing 787-9', maker: 'Boeing', category: 'widebody', seats: 290, rangeKm: 14000, speedKmh: 900, costPerBlockHour: 7000, leasePerWeek: 110000, minAirport: 3, year: 2014, climbFpm: 2600, vLofKmh: 295, vAppKmh: 260 },
  'B787-10': { name: 'Boeing 787-10', maker: 'Boeing', category: 'widebody', seats: 330, rangeKm: 11900, speedKmh: 900, costPerBlockHour: 7600, leasePerWeek: 125000, minAirport: 4, year: 2018, climbFpm: 2400, vLofKmh: 305, vAppKmh: 270 },
  'A340-600': { name: 'Airbus A340-600', maker: 'Airbus', category: 'widebody', seats: 380, rangeKm: 14400, speedKmh: 870, costPerBlockHour: 13000, leasePerWeek: 70000, minAirport: 4, year: 2002, endYear: 2011, climbFpm: 1500, vLofKmh: 315, vAppKmh: 280 },
  'A350-900': { name: 'Airbus A350-900', maker: 'Airbus', category: 'widebody', seats: 320, rangeKm: 15000, speedKmh: 900, costPerBlockHour: 7800, leasePerWeek: 125000, minAirport: 4, year: 2015 },
  'A350-1000': { name: 'Airbus A350-1000', maker: 'Airbus', category: 'widebody', seats: 370, rangeKm: 16100, speedKmh: 900, costPerBlockHour: 8800, leasePerWeek: 145000, minAirport: 4, year: 2018, climbFpm: 2300, vLofKmh: 305, vAppKmh: 265 },
  'B777-200ER': { name: 'Boeing 777-200ER', maker: 'Boeing', category: 'widebody', seats: 300, rangeKm: 13000, speedKmh: 890, costPerBlockHour: 9000, leasePerWeek: 90000, minAirport: 4, year: 1997, endYear: 2013 },
  'B777-300ER': { name: 'Boeing 777-300ER', maker: 'Boeing', category: 'widebody', seats: 370, rangeKm: 13600, speedKmh: 890, costPerBlockHour: 10500, leasePerWeek: 120000, minAirport: 4, year: 2004, climbFpm: 2000, vLofKmh: 330, vAppKmh: 280 },
  'B777-9': { name: 'Boeing 777-9', maker: 'Boeing', category: 'widebody', seats: 420, rangeKm: 13500, speedKmh: 890, costPerBlockHour: 11000, leasePerWeek: 165000, minAirport: 5, year: 2027, climbFpm: 2000, vLofKmh: 330, vAppKmh: 280 },
  'B747-400': { name: 'Boeing 747-400', maker: 'Boeing', category: 'widebody', seats: 416, rangeKm: 13400, speedKmh: 910, costPerBlockHour: 14500, leasePerWeek: 85000, minAirport: 5, year: 1989, endYear: 2009, climbFpm: 2000, vLofKmh: 330, vAppKmh: 285 },
  'B747-8': { name: 'Boeing 747-8I', maker: 'Boeing', category: 'widebody', seats: 410, rangeKm: 14300, speedKmh: 910, costPerBlockHour: 13500, leasePerWeek: 170000, minAirport: 5, year: 2012, endYear: 2017, climbFpm: 1900, vLofKmh: 335, vAppKmh: 290 },
  'A380-800': { name: 'Airbus A380-800', maker: 'Airbus', category: 'widebody', seats: 520, rangeKm: 15000, speedKmh: 900, costPerBlockHour: 14000, leasePerWeek: 210000, minAirport: 5, year: 2007, endYear: 2021, climbFpm: 1800, vLofKmh: 300, vAppKmh: 255 },

  // from the story years
  'B747-100': { name: 'Boeing 747-100', maker: 'Boeing', category: 'widebody', seats: 366, rangeKm: 9800, speedKmh: 900, costPerBlockHour: 15000, leasePerWeek: 40000, minAirport: 5, runwayM: 3200, year: 1970, endYear: 1986, climbFpm: 1800, vLofKmh: 330, vAppKmh: 285 },
  'DC-10-10': { name: 'McDonnell Douglas DC-10-10', maker: 'McDonnell Douglas', category: 'widebody', seats: 270, rangeKm: 6100, speedKmh: 880, costPerBlockHour: 11000, leasePerWeek: 28000, minAirport: 4, runwayM: 2700, year: 1971, endYear: 1981 },
  'B747-200B': { name: 'Boeing 747-200B', maker: 'Boeing', category: 'widebody', seats: 400, rangeKm: 12700, speedKmh: 900, costPerBlockHour: 15500, leasePerWeek: 50000, minAirport: 5, runwayM: 3300, year: 1971, endYear: 1991, climbFpm: 1800, vLofKmh: 335, vAppKmh: 290 },
  'L-1011': { name: 'Lockheed L-1011 TriStar', maker: 'Lockheed', category: 'widebody', seats: 256, rangeKm: 6900, speedKmh: 890, costPerBlockHour: 11000, leasePerWeek: 27000, minAirport: 4, runwayM: 2600, year: 1972, endYear: 1984 },
  'DC-10-30': { name: 'McDonnell Douglas DC-10-30', maker: 'McDonnell Douglas', category: 'widebody', seats: 270, rangeKm: 10000, speedKmh: 880, costPerBlockHour: 11500, leasePerWeek: 32000, minAirport: 4, runwayM: 3000, year: 1972, endYear: 1988 },
  'A300': { name: 'Airbus A300', maker: 'Airbus', category: 'widebody', seats: 250, rangeKm: 5400, speedKmh: 850, costPerBlockHour: 8000, leasePerWeek: 26000, minAirport: 3, runwayM: 2400, year: 1974, endYear: 1984 },
  'B747SP': { name: 'Boeing 747SP', maker: 'Boeing', category: 'widebody', seats: 276, rangeKm: 10800, speedKmh: 905, costPerBlockHour: 13000, leasePerWeek: 35000, minAirport: 4, runwayM: 2800, year: 1976, endYear: 1987, climbFpm: 2300, vLofKmh: 310, vAppKmh: 270 },
  'IL-86': { name: 'Ilyushin Il-86', maker: 'Ilyushin', category: 'widebody', seats: 320, rangeKm: 3600, speedKmh: 900, costPerBlockHour: 12000, leasePerWeek: 22000, minAirport: 4, runwayM: 2700, year: 1980, endYear: 1994 },
  'B767-200': { name: 'Boeing 767-200', maker: 'Boeing', category: 'widebody', seats: 216, rangeKm: 7200, speedKmh: 850, costPerBlockHour: 6500, leasePerWeek: 50000, minAirport: 3, runwayM: 1900, pilots: 2, year: 1982, endYear: 1997 },
  'A310': { name: 'Airbus A310-200', maker: 'Airbus', category: 'widebody', seats: 220, rangeKm: 6800, speedKmh: 850, costPerBlockHour: 6800, leasePerWeek: 46000, minAirport: 3, runwayM: 2000, pilots: 2, year: 1983, endYear: 1998 },
  'MD-11': { name: 'McDonnell Douglas MD-11', maker: 'McDonnell Douglas', category: 'widebody', seats: 293, rangeKm: 12600, speedKmh: 880, costPerBlockHour: 10500, leasePerWeek: 50000, minAirport: 4, runwayM: 2900, pilots: 2, year: 1990, endYear: 2000 },
  'A340-300': { name: 'Airbus A340-300', maker: 'Airbus', category: 'widebody', seats: 295, rangeKm: 13500, speedKmh: 880, costPerBlockHour: 10000, leasePerWeek: 75000, minAirport: 4, year: 1993, endYear: 2011, climbFpm: 1600, vLofKmh: 300, vAppKmh: 270 },
  // ---------- classics ----------
  'JU52': { name: 'Junkers Ju 52/3m', maker: 'Junkers', category: 'classic', seats: 17, rangeKm: 900, speedKmh: 210, costPerBlockHour: 1000, leasePerWeek: 3500, price: 900000, minAirport: 1, year: 1932, endYear: 1952, climbFpm: 650, vLofKmh: 110, vAppKmh: 120 },
  'DC-3': { name: 'Douglas DC-3', maker: 'Douglas', category: 'classic', seats: 28, rangeKm: 2400, speedKmh: 260, costPerBlockHour: 1200, leasePerWeek: 4000, price: 700000, minAirport: 1, year: 1936, endYear: 1946, climbFpm: 1100, vLofKmh: 135, vAppKmh: 150 },
  'CONCORDE': { name: 'Aérospatiale/BAC Concorde', maker: 'Aérospatiale/BAC', category: 'classic', seats: 100, rangeKm: 7200, speedKmh: 2150, costPerBlockHour: 25000, leasePerWeek: 150000, price: 25000000, minAirport: 4, year: 1976, endYear: 1979, climbFpm: 5000, vLofKmh: 400, vAppKmh: 300 },
  'TU-144': { name: 'Tupolev Tu-144', maker: 'Tupolev', category: 'classic', seats: 140, rangeKm: 6200, speedKmh: 2200, costPerBlockHour: 30000, leasePerWeek: 120000, price: 20000000, minAirport: 4, runwayM: 3000, cruiseFt: 55000, pilots: 3, year: 1977, endYear: 1984, climbFpm: 4500, vLofKmh: 400, vAppKmh: 310 },
  // piston airliners
  'DC-4': { name: 'Douglas DC-4', maker: 'Douglas', category: 'classic', seats: 60, rangeKm: 4000, speedKmh: 365, costPerBlockHour: 2000, leasePerWeek: 5000, minAirport: 1, runwayM: 1500, cruiseFt: 15000, pilots: 3, year: 1946, endYear: 1947, climbFpm: 900, vLofKmh: 190, vAppKmh: 195 },
  'CV-340': { name: 'Convair CV-340', maker: 'Convair', category: 'classic', seats: 44, rangeKm: 2200, speedKmh: 450, costPerBlockHour: 1500, leasePerWeek: 5000, minAirport: 1, runwayM: 1300, cruiseFt: 16000, year: 1952, endYear: 1956, climbFpm: 1300, vLofKmh: 180, vAppKmh: 185 },
  'DC-6B': { name: 'Douglas DC-6B', maker: 'Douglas', category: 'classic', seats: 89, rangeKm: 4800, speedKmh: 500, costPerBlockHour: 2600, leasePerWeek: 8000, minAirport: 2, runwayM: 1700, cruiseFt: 22000, pilots: 3, year: 1951, endYear: 1958, climbFpm: 1100, vLofKmh: 200, vAppKmh: 205 },
  'L-1049G': { name: 'Lockheed L-1049G Super Constellation', maker: 'Lockheed', category: 'classic', seats: 95, rangeKm: 7400, speedKmh: 510, costPerBlockHour: 3400, leasePerWeek: 10000, minAirport: 2, runwayM: 1900, cruiseFt: 22000, pilots: 3, year: 1955, endYear: 1958, climbFpm: 1000, vLofKmh: 210, vAppKmh: 215 },
  'DC-7C': { name: 'Douglas DC-7C Seven Seas', maker: 'Douglas', category: 'classic', seats: 99, rangeKm: 9000, speedKmh: 570, costPerBlockHour: 4000, leasePerWeek: 12000, minAirport: 3, runwayM: 2000, cruiseFt: 23000, pilots: 3, year: 1956, endYear: 1958, climbFpm: 1000, vLofKmh: 215, vAppKmh: 220 },
};

// Crew templates. One crew operates one aircraft.
// Crews for planes from the market are sized by seats (see FG.game.crewFor).
FG.data.crewTemplates = {
  standard: { pilots: 2, cabin: 4, weeklySalary: 14000 },
};
