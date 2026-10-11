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

  // Map view: the whole world, starting over Europe.
  map: {
    center: [49, 10],
    zoom: 5,
    minZoom: 2,
    maxZoom: 17,            // runways are drawn from runwayZoom on
    runwayZoom: 11,
    bounds: [[-80, -220], [85, 220]],
    labelZoom: 10,          // airport code shown from zoom (labelZoom - size); own slots always
  },

  // Demand model
  catchmentRadiusKm: 150,   // towns within this radius feed an airport
  demandFactor: 0.000028,   // daily pax per direction = factor * sqrt(catchA * catchB) * distanceFactor
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

  // Airports as investments: shares, dividends and construction projects
  airports: {
    paxPerHead: [0, 0.3, 1, 2, 3, 4], // passengers per year per catchment inhabitant, by size
    minorFactor: 0.3,         // airfields without an IATA code (size 1) draw fewer passengers
    profitPerPax: 4,          // airport operating profit per passenger
    peRatio: 2,               // value = yearly profit * this + share of what was invested (low, so dividends matter)
    investedValue: 0.7,
    payout: 0.8,              // share of weekly profit paid out as dividend
    shareStep: 5,             // percent bought or sold per click
    buyPremium: 1.05,
    sellDiscount: 0.95,
    boardStake: 25,           // stake needed to order construction
    majorityStake: 50,        // from here you pay no weekly slot fee at the airport
    // Construction. Costs in CHF, durations in weeks.
    runwayLengths: [1200, 1800, 2500, 3200, 4000],
    runwayCost: { base: 2000000, perM: 4000 }, runwayWeeks: { base: 4, perKm: 2 },
    extendBy: 500, extendCost: 3000000, extendWeeks: 6, maxRunwayM: 4500,
    terminalCost: [0, 0, 10000000, 30000000, 80000000, 200000000], // by new size
    terminalWeeks: [0, 0, 8, 12, 20, 30],
    terminalRunway: [0, 0, 1200, 1800, 2500, 3000], // longest paved runway needed for that size
    terminalDemand: 0.25,     // each terminal expansion adds this much passenger demand
    newAirportCost: 15000000, newAirportWeeks: 12, newAirportRunway: 1200, newAirportMinKm: 8,
  },

  bankruptcyLimit: -500000,

  // Game modes, picked when starting a new game. makerCrashMult multiplies the crash
  // chance for planes of that maker (11 = +1000%).
  modes: {
    arcade: { name: 'Arcade', desc: 'Normal accident rates, like the real world.', makerCrashMult: {} },
    realistic: { name: 'Realistic', desc: 'Boeing aircraft crash 1000% more often.', makerCrashMult: { Boeing: 11 } },
  },
  defaultMode: 'arcade',

  // Difficulty, picked on the start screen. demandMult scales passenger demand, costMult the
  // operating cost of every flight; bankruptcy hits below bankruptcyLimit.
  difficulties: {
    easy: { name: 'Easy', desc: 'CHF 5M to start, more passengers, cheaper flights.',
      startMoney: 5000000, demandMult: 1.25, costMult: 0.85, bankruptcyLimit: -2000000 },
    normal: { name: 'Normal', desc: 'CHF 1.5M to start, the standard game.',
      startMoney: 1500000, demandMult: 1, costMult: 1, bankruptcyLimit: -500000 },
    hard: { name: 'Hard', desc: 'CHF 750k, fewer passengers, dearer flights.',
      startMoney: 750000, demandMult: 0.85, costMult: 1.15, bankruptcyLimit: -250000 },
  },
  defaultDifficulty: 'normal',
  // Home airports offered on the start screen, by region.
  startAirports: {
    Europe: ['BRN', 'ZRH', 'GVA', 'LHR', 'CDG', 'FRA', 'AMS', 'MAD', 'FCO', 'IST'],
    'North America': ['JFK', 'LAX', 'ATL', 'YYZ', 'MEX'],
    'South America': ['GRU', 'EZE', 'BOG'],
    'Middle East & Africa': ['DXB', 'DOH', 'JNB', 'NBO'],
    Asia: ['HND', 'ICN', 'PEK', 'SIN', 'HKG', 'DEL'],
    Oceania: ['SYD', 'AKL'],
  },
  // Aircraft offered as the first (leased) plane on the start screen.
  starterAircraft: ['ATR72-600', 'Q400', 'E190', 'A220-300', 'A320neo', 'B737-800'],

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
