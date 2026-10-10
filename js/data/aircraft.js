// Aircraft types. Add new entries here; the key is used in save games.
// costPerBlockHour = fuel + maintenance, leasePerWeek = lease rate on the market.
// price = new purchase price; if left out it is leasePerWeek * FG.config.market.priceWeeks.
// minAirport = smallest airport size (1-5) the type can operate from.
FG.data.aircraftCategories = {
  turboprop: 'Turboprop',
  regional: 'Regional jet',
  narrowbody: 'Narrowbody',
  widebody: 'Widebody',
  classic: 'Classic',
};

FG.data.aircraft = {
  // ---------- turboprops ----------
  'DHC6-400': { name: 'DHC-6 Twin Otter 400', maker: 'De Havilland Canada', category: 'turboprop', seats: 19, rangeKm: 1480, speedKmh: 300, costPerBlockHour: 700, leasePerWeek: 5000, minAirport: 1 },
  'DO228NG': { name: 'Dornier 228NG', maker: 'RUAG', category: 'turboprop', seats: 19, rangeKm: 1100, speedKmh: 400, costPerBlockHour: 750, leasePerWeek: 5500, minAirport: 1 },
  'B1900D': { name: 'Beechcraft 1900D', maker: 'Beechcraft', category: 'turboprop', seats: 19, rangeKm: 1200, speedKmh: 520, costPerBlockHour: 900, leasePerWeek: 6000, minAirport: 1 },
  'DO328': { name: 'Dornier 328', maker: 'Dornier', category: 'turboprop', seats: 33, rangeKm: 1300, speedKmh: 620, costPerBlockHour: 1100, leasePerWeek: 8000, minAirport: 1 },
  'SAAB340': { name: 'Saab 340B', maker: 'Saab', category: 'turboprop', seats: 34, rangeKm: 1700, speedKmh: 500, costPerBlockHour: 1100, leasePerWeek: 7500, minAirport: 1 },
  'SAAB2000': { name: 'Saab 2000', maker: 'Saab', category: 'turboprop', seats: 50, rangeKm: 2800, speedKmh: 665, costPerBlockHour: 1500, leasePerWeek: 9500, minAirport: 1 },
  'ATR42-600': { name: 'ATR 42-600', maker: 'ATR', category: 'turboprop', seats: 48, rangeKm: 1300, speedKmh: 540, costPerBlockHour: 1300, leasePerWeek: 10000, minAirport: 1 },
  'ATR72-600': { name: 'ATR 72-600', maker: 'ATR', category: 'turboprop', seats: 72, rangeKm: 1500, speedKmh: 510, costPerBlockHour: 1600, leasePerWeek: 13000, minAirport: 1 },
  'Q400': { name: 'De Havilland Dash 8-400', maker: 'De Havilland Canada', category: 'turboprop', seats: 78, rangeKm: 2000, speedKmh: 660, costPerBlockHour: 1900, leasePerWeek: 16000, minAirport: 1 },

  // ---------- regional jets ----------
  'ERJ145': { name: 'Embraer ERJ 145', maker: 'Embraer', category: 'regional', seats: 50, rangeKm: 2900, speedKmh: 830, costPerBlockHour: 2100, leasePerWeek: 11000, minAirport: 1 },
  'CRJ200': { name: 'Bombardier CRJ200', maker: 'Bombardier', category: 'regional', seats: 50, rangeKm: 3000, speedKmh: 810, costPerBlockHour: 2200, leasePerWeek: 12000, minAirport: 1 },
  'CRJ900': { name: 'Bombardier CRJ900', maker: 'Bombardier', category: 'regional', seats: 90, rangeKm: 2900, speedKmh: 830, costPerBlockHour: 2700, leasePerWeek: 20000, minAirport: 1 },
  'E175': { name: 'Embraer E175', maker: 'Embraer', category: 'regional', seats: 88, rangeKm: 3700, speedKmh: 830, costPerBlockHour: 2600, leasePerWeek: 21000, minAirport: 1 },
  'E190': { name: 'Embraer E190', maker: 'Embraer', category: 'regional', seats: 100, rangeKm: 4500, speedKmh: 830, costPerBlockHour: 2800, leasePerWeek: 24000, minAirport: 1 },
  'E195': { name: 'Embraer E195', maker: 'Embraer', category: 'regional', seats: 120, rangeKm: 4200, speedKmh: 830, costPerBlockHour: 3000, leasePerWeek: 26000, minAirport: 1 },
  'E190-E2': { name: 'Embraer E190-E2', maker: 'Embraer', category: 'regional', seats: 104, rangeKm: 5300, speedKmh: 830, costPerBlockHour: 2600, leasePerWeek: 27000, minAirport: 1 },
  'E195-E2': { name: 'Embraer E195-E2', maker: 'Embraer', category: 'regional', seats: 132, rangeKm: 4800, speedKmh: 830, costPerBlockHour: 3000, leasePerWeek: 30000, minAirport: 1 },
  'SSJ100': { name: 'Sukhoi Superjet 100', maker: 'Sukhoi', category: 'regional', seats: 98, rangeKm: 4500, speedKmh: 830, costPerBlockHour: 2900, leasePerWeek: 17000, minAirport: 1 },
  'F100': { name: 'Fokker 100', maker: 'Fokker', category: 'regional', seats: 100, rangeKm: 3100, speedKmh: 780, costPerBlockHour: 3000, leasePerWeek: 13000, minAirport: 1 },
  'RJ100': { name: 'Avro RJ100', maker: 'BAE Systems', category: 'regional', seats: 100, rangeKm: 2900, speedKmh: 760, costPerBlockHour: 3100, leasePerWeek: 13000, minAirport: 1 },

  // ---------- narrowbodies ----------
  'A220-100': { name: 'Airbus A220-100', maker: 'Airbus', category: 'narrowbody', seats: 120, rangeKm: 6300, speedKmh: 830, costPerBlockHour: 2900, leasePerWeek: 31000, minAirport: 1 },
  'A220-300': { name: 'Airbus A220-300', maker: 'Airbus', category: 'narrowbody', seats: 145, rangeKm: 6300, speedKmh: 830, costPerBlockHour: 3200, leasePerWeek: 35000, minAirport: 1 },
  'A318': { name: 'Airbus A318', maker: 'Airbus', category: 'narrowbody', seats: 120, rangeKm: 5700, speedKmh: 830, costPerBlockHour: 3300, leasePerWeek: 25000, minAirport: 1 },
  'A319': { name: 'Airbus A319', maker: 'Airbus', category: 'narrowbody', seats: 140, rangeKm: 6900, speedKmh: 830, costPerBlockHour: 3500, leasePerWeek: 32000, minAirport: 1 },
  'A320': { name: 'Airbus A320ceo', maker: 'Airbus', category: 'narrowbody', seats: 170, rangeKm: 6100, speedKmh: 830, costPerBlockHour: 3900, leasePerWeek: 38000, minAirport: 1 },
  'A320neo': { name: 'Airbus A320neo', maker: 'Airbus', category: 'narrowbody', seats: 180, rangeKm: 6300, speedKmh: 840, costPerBlockHour: 3800, leasePerWeek: 45000, minAirport: 1 },
  'A321': { name: 'Airbus A321ceo', maker: 'Airbus', category: 'narrowbody', seats: 200, rangeKm: 5900, speedKmh: 830, costPerBlockHour: 4500, leasePerWeek: 44000, minAirport: 2 },
  'A321neo': { name: 'Airbus A321neo', maker: 'Airbus', category: 'narrowbody', seats: 220, rangeKm: 7400, speedKmh: 840, costPerBlockHour: 4300, leasePerWeek: 52000, minAirport: 2 },
  'A321XLR': { name: 'Airbus A321XLR', maker: 'Airbus', category: 'narrowbody', seats: 200, rangeKm: 8700, speedKmh: 840, costPerBlockHour: 4400, leasePerWeek: 58000, minAirport: 2 },
  'B737-700': { name: 'Boeing 737-700', maker: 'Boeing', category: 'narrowbody', seats: 140, rangeKm: 6300, speedKmh: 830, costPerBlockHour: 3500, leasePerWeek: 30000, minAirport: 1 },
  'B737-800': { name: 'Boeing 737-800', maker: 'Boeing', category: 'narrowbody', seats: 189, rangeKm: 5400, speedKmh: 840, costPerBlockHour: 4000, leasePerWeek: 40000, minAirport: 1 },
  'B737-8': { name: 'Boeing 737 MAX 8', maker: 'Boeing', category: 'narrowbody', seats: 189, rangeKm: 6500, speedKmh: 840, costPerBlockHour: 3700, leasePerWeek: 46000, minAirport: 1 },
  'B737-9': { name: 'Boeing 737 MAX 9', maker: 'Boeing', category: 'narrowbody', seats: 210, rangeKm: 6500, speedKmh: 840, costPerBlockHour: 4000, leasePerWeek: 50000, minAirport: 2 },
  'B757-200': { name: 'Boeing 757-200', maker: 'Boeing', category: 'narrowbody', seats: 200, rangeKm: 7200, speedKmh: 850, costPerBlockHour: 5200, leasePerWeek: 36000, minAirport: 2 },
  'C919': { name: 'COMAC C919', maker: 'COMAC', category: 'narrowbody', seats: 164, rangeKm: 4100, speedKmh: 830, costPerBlockHour: 3800, leasePerWeek: 36000, minAirport: 1 },
  'MD-82': { name: 'McDonnell Douglas MD-82', maker: 'McDonnell Douglas', category: 'narrowbody', seats: 155, rangeKm: 3800, speedKmh: 810, costPerBlockHour: 4300, leasePerWeek: 17000, minAirport: 1 },

  // ---------- widebodies ----------
  'B767-300ER': { name: 'Boeing 767-300ER', maker: 'Boeing', category: 'widebody', seats: 220, rangeKm: 11000, speedKmh: 850, costPerBlockHour: 6900, leasePerWeek: 60000, minAirport: 3 },
  'A330-200': { name: 'Airbus A330-200', maker: 'Airbus', category: 'widebody', seats: 250, rangeKm: 13400, speedKmh: 870, costPerBlockHour: 7200, leasePerWeek: 80000, minAirport: 3 },
  'A330-300': { name: 'Airbus A330-300', maker: 'Airbus', category: 'widebody', seats: 290, rangeKm: 11700, speedKmh: 870, costPerBlockHour: 7600, leasePerWeek: 85000, minAirport: 3 },
  'A330-900': { name: 'Airbus A330-900neo', maker: 'Airbus', category: 'widebody', seats: 290, rangeKm: 13300, speedKmh: 870, costPerBlockHour: 6900, leasePerWeek: 100000, minAirport: 3 },
  'B787-8': { name: 'Boeing 787-8', maker: 'Boeing', category: 'widebody', seats: 240, rangeKm: 13600, speedKmh: 900, costPerBlockHour: 6400, leasePerWeek: 95000, minAirport: 3 },
  'B787-9': { name: 'Boeing 787-9', maker: 'Boeing', category: 'widebody', seats: 290, rangeKm: 14000, speedKmh: 900, costPerBlockHour: 7000, leasePerWeek: 110000, minAirport: 3 },
  'B787-10': { name: 'Boeing 787-10', maker: 'Boeing', category: 'widebody', seats: 330, rangeKm: 11900, speedKmh: 900, costPerBlockHour: 7600, leasePerWeek: 125000, minAirport: 4 },
  'A340-600': { name: 'Airbus A340-600', maker: 'Airbus', category: 'widebody', seats: 380, rangeKm: 14400, speedKmh: 870, costPerBlockHour: 13000, leasePerWeek: 70000, minAirport: 4 },
  'A350-900': { name: 'Airbus A350-900', maker: 'Airbus', category: 'widebody', seats: 320, rangeKm: 15000, speedKmh: 900, costPerBlockHour: 7800, leasePerWeek: 125000, minAirport: 4 },
  'A350-1000': { name: 'Airbus A350-1000', maker: 'Airbus', category: 'widebody', seats: 370, rangeKm: 16100, speedKmh: 900, costPerBlockHour: 8800, leasePerWeek: 145000, minAirport: 4 },
  'B777-200ER': { name: 'Boeing 777-200ER', maker: 'Boeing', category: 'widebody', seats: 300, rangeKm: 13000, speedKmh: 890, costPerBlockHour: 9000, leasePerWeek: 90000, minAirport: 4 },
  'B777-300ER': { name: 'Boeing 777-300ER', maker: 'Boeing', category: 'widebody', seats: 370, rangeKm: 13600, speedKmh: 890, costPerBlockHour: 10500, leasePerWeek: 120000, minAirport: 4 },
  'B777-9': { name: 'Boeing 777-9', maker: 'Boeing', category: 'widebody', seats: 420, rangeKm: 13500, speedKmh: 890, costPerBlockHour: 11000, leasePerWeek: 165000, minAirport: 5 },
  'B747-400': { name: 'Boeing 747-400', maker: 'Boeing', category: 'widebody', seats: 416, rangeKm: 13400, speedKmh: 910, costPerBlockHour: 14500, leasePerWeek: 85000, minAirport: 5 },
  'B747-8': { name: 'Boeing 747-8I', maker: 'Boeing', category: 'widebody', seats: 410, rangeKm: 14300, speedKmh: 910, costPerBlockHour: 13500, leasePerWeek: 170000, minAirport: 5 },
  'A380-800': { name: 'Airbus A380-800', maker: 'Airbus', category: 'widebody', seats: 520, rangeKm: 15000, speedKmh: 900, costPerBlockHour: 14000, leasePerWeek: 210000, minAirport: 5 },

  // ---------- classics ----------
  'JU52': { name: 'Junkers Ju 52/3m', maker: 'Junkers', category: 'classic', seats: 17, rangeKm: 900, speedKmh: 210, costPerBlockHour: 1000, leasePerWeek: 3500, price: 900000, minAirport: 1 },
  'DC-3': { name: 'Douglas DC-3', maker: 'Douglas', category: 'classic', seats: 28, rangeKm: 2400, speedKmh: 260, costPerBlockHour: 1200, leasePerWeek: 4000, price: 700000, minAirport: 1 },
  'CONCORDE': { name: 'Aérospatiale/BAC Concorde', maker: 'Aérospatiale/BAC', category: 'classic', seats: 100, rangeKm: 7200, speedKmh: 2150, costPerBlockHour: 25000, leasePerWeek: 150000, price: 25000000, minAirport: 4 },
};

// Crew templates. One crew operates one aircraft.
// Crews for planes from the market are sized by seats (see FG.game.crewFor).
FG.data.crewTemplates = {
  standard: { pilots: 2, cabin: 4, weeklySalary: 14000 },
};
