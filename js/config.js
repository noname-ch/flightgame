// Global game settings. Tweak balance here.
window.FG = window.FG || {};
FG.data = FG.data || {};

FG.config = {
  companyName: 'Bern Air',
  currency: 'CHF',
  startMoney: 1500000,
  startAirport: 'BRN',
  startAircraft: 'A220-300',
  startRegistration: 'HB-AEA',
  startCrew: 'standard',

  // Map view. Widen bounds when adding airports outside Europe.
  map: {
    center: [49, 10],
    zoom: 5,
    minZoom: 3,
    bounds: [[25, -40], [75, 50]],
  },

  // Demand model
  catchmentRadiusKm: 150,   // towns within this radius feed an airport
  demandFactor: 0.00004,    // daily pax per direction = factor * sqrt(catchA * catchB) * distanceFactor
  ticket: { base: 60, perKm: 0.11 },
  paxFee: 8,                // airport fee per passenger
  landingFee: { base: 300, perSize: 400 },

  // Slot prices by airport size (index 1..5)
  slot: {
    upfront: [0, 60000, 120000, 250000, 450000, 750000],
    weekly: [0, 1500, 4000, 9000, 18000, 32000],
  },

  // Operations
  taxiMin: 30,              // added to every flight for taxi/climb/approach
  turnaroundMin: 45,
  curfew: { start: 6 * 60, end: 22 * 60 }, // departures only allowed in this window
  crewMaxDutyMin: 12 * 60,  // max block time per crew per day

  bankruptcyLimit: -500000,
};
