// Aircraft types. Add new entries here; the key is used in save games.
FG.data.aircraft = {
  'A220-300': {
    name: 'Airbus A220-300',
    seats: 145,
    rangeKm: 6300,
    speedKmh: 830,
    costPerBlockHour: 3200, // fuel + maintenance
    leasePerWeek: 35000,
  },
  'E195-E2': {
    name: 'Embraer E195-E2',
    seats: 132,
    rangeKm: 4800,
    speedKmh: 830,
    costPerBlockHour: 3000,
    leasePerWeek: 30000,
  },
  'A320neo': {
    name: 'Airbus A320neo',
    seats: 180,
    rangeKm: 6300,
    speedKmh: 840,
    costPerBlockHour: 3800,
    leasePerWeek: 45000,
  },
};

// Crew templates. One crew operates one aircraft.
FG.data.crewTemplates = {
  standard: { pilots: 2, cabin: 4, weeklySalary: 14000 },
};
