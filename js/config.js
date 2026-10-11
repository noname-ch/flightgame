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
    labelZoom: 10,          // airport code shown from zoom (labelZoom - size); own slots always
  },

  // Demand model
  catchmentRadiusKm: 150,   // towns within this radius feed an airport
  demandFactor: 0.00004,    // daily pax per direction = factor * sqrt(catchA * catchB) * distanceFactor
  ticket: {
    base: 60, perKm: 0.11,    // standard fare = base + perKm * distance
    elasticity: 1.5,          // demand = standard demand * priceFactor ^ -elasticity
    minFactor: 0.5, maxFactor: 2, step: 0.05, // player's price factor per route
  },
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

  // Aircraft market
  market: {
    priceWeeks: 110,          // new price = this many weeks of lease (unless the type sets price)
    leaseDepositWeeks: 2,     // paid upfront when leasing, not refunded
    returnFeeWeeks: 2,        // fee for handing a leased plane back
    resaleFactor: 0.9,        // you get this share of the current value when selling
    depreciationPerYear: 0.07,
    agingCostPerYear: 0.012,  // older planes burn more fuel and need more maintenance
    usedListings: 8,          // refreshed every Monday
    usedAge: [3, 28],         // years
    registrationPrefix: 'HB-',
    pilotSalary: 4000,        // per week
    cabinSalary: 1500,
  },

  bankruptcyLimit: -500000,

  // Game modes, picked when starting a new game. makerCrashMult multiplies the crash
  // chance for planes of that maker (11 = +1000%).
  modes: {
    arcade: { name: 'Arcade', desc: 'Normal accident rates, like the real world.', makerCrashMult: {} },
    realistic: { name: 'Realistic', desc: 'Boeing aircraft crash 1000% more often.', makerCrashMult: { Boeing: 11 } },
  },
  defaultMode: 'arcade',

  // Random events (catalogue in js/data/events.js). Real accident rates (~1 per 5M flights)
  // would never show up in a game, so they are scaled up here.
  events: {
    crashPerFlight: 1 / 6000,     // hull loss chance per flight
    incidentPerFlight: 1 / 400,   // minor incident (bird strike, tech fault…) chance per flight
    perDay: 0.2,                  // chance of a world event (strike, weather, fuel…) each day
    crashPaxCompensation: 25000,  // per passenger on board, after insurance
    crashInvestigation: 300000,
    crashInsuranceShare: 0.6,     // insurance pays this share of an owned plane's value
    crashLeasePenaltyWeeks: 20,   // owed to the lessor for a leased hull loss
    crashReputation: { demandMult: 0.7, days: 21 }, // all routes, after a crash
  },
};
