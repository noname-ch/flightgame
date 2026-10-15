// Random events. Each one returns a newspaper story (or null if it doesn't fit right now)
// and may add timed effects through the ctx helpers from game.js:
//   ctx.slotAirport()  random airport where you have a slot (or null)
//   ctx.pick(list), ctx.rand(min, max)   random helpers (rand gives an integer)
//   ctx.effect({ label, hours, where, demandMult, costMult, noFlights })
//     where: { all: true } | { airport: 'ZRH' } | { country: 'FR' } | { near: {lat, lon}, radiusKm }
//   ctx.money(amount, logText), ctx.fmtMoney(n), ctx.state
// Story: { kind: 'good' | 'bad', picture, headline, sub, body }.
// picture is one of: crash, incident, strike, storm, volcano, fuel, party, crowd, chart.

FG.data.newspapers = ['The Daily Contrail', 'Tarmac Tribune', 'The Holding Pattern Herald', 'Alpine Evening Post', 'The Jetstream Journal'];

// Countries not listed in countryNames get their English name from the browser.
FG.regionName = function (code) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch (e) { return code; }
};

FG.data.countryNames = {
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', CH: 'Switzerland', CZ: 'Czechia', DE: 'Germany',
  DK: 'Denmark', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'Britain', GR: 'Greece',
  HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IS: 'Iceland', IT: 'Italy', LV: 'Latvia',
  NL: 'the Netherlands', NO: 'Norway', PL: 'Poland', PT: 'Portugal', RO: 'Romania', RS: 'Serbia',
  SE: 'Sweden', TR: 'Türkiye',
};

// World events: rolled once per day (chance FG.config.events.perDay), picked by weight.
FG.data.worldEvents = [
  {
    id: 'airportStrike', weight: 3,
    make(ctx) {
      const a = ctx.slotAirport();
      if (!a) return null;
      const days = ctx.rand(1, 2);
      ctx.effect({ label: `Ground staff strike at ${a.code}`, hours: days * 24, where: { airport: a.code }, noFlights: true });
      return {
        kind: 'bad', picture: 'strike',
        headline: `${a.city.toUpperCase()} AIRPORT PARALYSED BY STRIKE`,
        sub: `Baggage handlers and ground staff walk out for ${days === 1 ? 'one day' : `${days} days`}`,
        body: `Travellers at ${a.name} faced empty check-in desks this morning as ground staff downed tools over pay. ` +
          `"Nothing moves until management listens," a union spokesperson told reporters outside Terminal 1. ` +
          `All departures and arrivals are cancelled.`,
      };
    },
  },
  {
    id: 'atcStrike', weight: 2,
    make(ctx) {
      const a = ctx.slotAirport((x) => x.country !== 'CH') || ctx.slotAirport();
      if (!a) return null;
      const country = FG.data.countryNames[a.country] || FG.regionName(a.country);
      ctx.effect({ label: `Air traffic control strike in ${country}`, hours: 24, where: { country: a.country }, noFlights: true });
      return {
        kind: 'bad', picture: 'strike',
        headline: `CONTROLLERS STRIKE: ${country.toUpperCase()}'S SKIES EMPTY`,
        sub: 'Air traffic controllers walk out for 24 hours',
        body: `Air traffic control in ${country} ground to a halt at dawn. No flights may take off or land at any airport ` +
          `in the country until tomorrow. Airlines called the strike "the ${ctx.rand(3, 9)}th this year" and demanded compensation.`,
      };
    },
  },
  {
    id: 'pilotStrike', weight: 1,
    make(ctx) {
      const s = ctx.state;
      if (!s.crews.length) return null;
      for (const c of s.crews) c.weeklySalary = Math.round(c.weeklySalary * 1.04);
      ctx.effect({ label: 'Your pilots are on strike', hours: 24, where: { all: true }, noFlights: true });
      return {
        kind: 'bad', picture: 'strike',
        headline: `${s.company.toUpperCase()} PILOTS STRIKE`,
        sub: 'Entire fleet grounded for a day – management concedes 4% pay rise',
        body: `Pilots of ${s.company} gathered on the apron with hand-painted signs reading "Fair pay for fair skies". ` +
          `After a tense night of negotiations the airline agreed to raise all crew salaries by 4%. Flights resume tomorrow.`,
      };
    },
  },
  {
    id: 'volcano', weight: 1,
    make(ctx) {
      const days = ctx.rand(2, 4);
      ctx.effect({ label: 'Volcanic ash cloud over the North Atlantic', hours: days * 24,
        where: { near: { lat: 60, lon: -8 }, radiusKm: 1500 }, noFlights: true });
      return {
        kind: 'bad', picture: 'volcano',
        headline: 'ICELANDIC VOLCANO ERUPTS – ASH CLOSES NORTHERN SKIES',
        sub: `Airspace over Iceland, Britain, Ireland and Scandinavia shut for ${days} days`,
        body: 'A towering plume of ash rose from an Icelandic volcano overnight. Aviation authorities closed airspace across ' +
          'the North Atlantic and northern Europe as the cloud drifted south-east. Volcanologists could not say how long it will last.',
      };
    },
  },
  {
    id: 'storm', weight: 3,
    make(ctx) {
      const a = ctx.slotAirport();
      if (!a) return null;
      const name = ctx.pick(['Anna', 'Bruno', 'Ciara', 'Dieter', 'Elsa', 'Franz', 'Greta', 'Hugo', 'Ingrid', 'Jules']);
      const winter = (ctx.state.time / 1440) % 365 > 270 || (ctx.state.time / 1440) % 365 < 60;
      ctx.effect({ label: `Storm ${name}`, hours: 18, where: { near: a, radiusKm: 400 }, noFlights: true, weather: 'storm' });
      return {
        kind: 'bad', picture: 'storm',
        headline: `STORM ${name.toUpperCase()} BATTERS ${a.city.toUpperCase()}`,
        sub: winter ? 'Blizzard closes runways across the region' : 'Hurricane-force gusts ground all flights',
        body: `Storm ${name} swept in with gusts of up to ${ctx.rand(110, 160)} km/h. Airports within 400 km of ${a.city} ` +
          'suspended operations as crews struggled to keep runways clear. Forecasters expect calmer weather by tomorrow.',
      };
    },
  },
  {
    id: 'fuelSpike', weight: 2,
    make(ctx) {
      const pct = ctx.rand(15, 35);
      ctx.effect({ label: `Fuel price +${pct}%`, hours: 7 * 24, where: { all: true }, costMult: 1 + pct / 100 });
      return {
        kind: 'bad', picture: 'fuel',
        headline: `OIL SHOCK: JET FUEL UP ${pct}%`,
        sub: 'Airlines brace for a costly week',
        body: `Crude prices surged after producers announced surprise output cuts. Jet fuel now costs ${pct}% more, ` +
          'and analysts warn that thin-margin airlines will feel it in their operating costs all week.',
      };
    },
  },
  {
    id: 'fuelDrop', weight: 2,
    make(ctx) {
      const pct = ctx.rand(10, 20);
      ctx.effect({ label: `Fuel price −${pct}%`, hours: 7 * 24, where: { all: true }, costMult: 1 - pct / 100 });
      return {
        kind: 'good', picture: 'chart',
        headline: `JET FUEL PRICES TUMBLE ${pct}%`,
        sub: 'Good week for airline accountants',
        body: `A glut of crude oil sent fuel prices sliding. Operating costs for airlines across Europe drop by about ${pct}% ` +
          'this week, though experts doubt the relief will last.',
      };
    },
  },
  {
    id: 'festival', weight: 3,
    make(ctx) {
      const a = ctx.slotAirport();
      if (!a) return null;
      const what = ctx.pick(['music festival', 'film festival', 'wine fair', 'marathon', 'trade fair', 'royal wedding']);
      ctx.effect({ label: `${what[0].toUpperCase()}${what.slice(1)} in ${a.city}`, hours: 5 * 24, where: { airport: a.code }, demandMult: 1.6 });
      return {
        kind: 'good', picture: 'party',
        headline: `${a.city.toUpperCase()} ${what.toUpperCase()} DRAWS RECORD CROWDS`,
        sub: 'Hotels fully booked, flights selling out',
        body: `Visitors are pouring into ${a.city} for this year's ${what}. Demand for flights to and from ${a.name} is up ` +
          'by around 60% for the next five days, and travel agents report a rush on last-minute tickets.',
      };
    },
  },
  {
    id: 'football', weight: 2,
    make(ctx) {
      const a = ctx.slotAirport((x) => x.size >= 3) || ctx.slotAirport();
      if (!a) return null;
      ctx.effect({ label: `Cup final in ${a.city}`, hours: 2 * 24, where: { airport: a.code }, demandMult: 2 });
      return {
        kind: 'good', picture: 'crowd',
        headline: `CUP FINAL FEVER GRIPS ${a.city.toUpperCase()}`,
        sub: 'Tens of thousands of fans on their way',
        body: `With the European cup final kicking off in ${a.city} on Saturday, supporters are booking every seat they can find. ` +
          'Airlines serving the city expect twice the usual traffic for two days.',
      };
    },
  },
  {
    id: 'rivalBankrupt', weight: 1,
    make(ctx) {
      // One of the game's rival airlines (js/data/rivals.js) goes under: its routes disappear for good.
      const gone = ctx.bustRival ? ctx.bustRival() : null;
      const rival = gone ? gone.name : ctx.pick(['Air Edelweissbrot', 'FlyCheapo', 'Alpenwind Airways', 'SkyBudget', 'Eurojumbo']);
      const what = gone ? { flag: 'Flag carrier', low: 'Low-cost carrier', regional: 'Regional airline' }[gone.kind] : 'Low-cost carrier';
      ctx.effect({ label: `${rival} collapsed – more passengers for you`, hours: 10 * 24, where: { all: true }, demandMult: 1.25 });
      return {
        kind: 'good', picture: 'chart',
        headline: `${rival.toUpperCase()} GOES BUST`,
        sub: 'Thousands of passengers stranded – rivals step in',
        body: `${what} ${rival} ceased operations overnight after failing to find new investors` +
          `${gone ? ` – its ${gone.routes.length} routes are gone` : ''}. ` +
          `${ctx.state.company} and other airlines expect about 25% more bookings over the next ten days.`,
      };
    },
  },
  {
    id: 'flu', weight: 1,
    make(ctx) {
      ctx.effect({ label: 'Flu wave – fewer travellers', hours: 7 * 24, where: { all: true }, demandMult: 0.65 });
      return {
        kind: 'bad', picture: 'chart',
        headline: 'FLU WAVE SWEEPS EUROPE',
        sub: 'Holidaymakers cancel trips by the thousand',
        body: 'Health authorities report the worst flu season in a decade. Travel bookings have dropped by a third, ' +
          'and airlines are flying half-empty planes across the continent.',
      };
    },
  },
  {
    id: 'influencer', weight: 2,
    make(ctx) {
      const a = ctx.slotAirport();
      if (!a) return null;
      ctx.effect({ label: `${a.city} is trending online`, hours: 7 * 24, where: { airport: a.code }, demandMult: 1.35 });
      return {
        kind: 'good', picture: 'party',
        headline: `"HIDDEN GEM": ${a.city.toUpperCase()} GOES VIRAL`,
        sub: 'A travel video with 40 million views sends tourists flocking',
        body: `A famous travel influencer called ${a.city} "the most underrated city in Europe". ` +
          `Bookings to ${a.code} jumped 35% within hours. Locals are less impressed.`,
      };
    },
  },
];

// Minor in-flight incidents (chance FG.config.events.incidentPerFlight, times the mode's maker
// multiplier for doorPlug). The plane lands safely and is grounded for repairs.
FG.data.incidents = [
  {
    id: 'birdStrike', weight: 4, groundedHours: 36, repair: 80000,
    story: (x) => ({
      kind: 'bad', picture: 'incident',
      headline: 'BIRD STRIKE FORCES RETURN',
      sub: `${x.company} ${x.type} lands safely at ${x.airport}`,
      body: `Shortly after take-off from ${x.from}, flight ${x.id} flew through a flock of geese. The crew reported a ` +
        `damaged engine and landed safely at ${x.airport}. The aircraft is grounded for repairs costing ${x.repair}.`,
    }),
  },
  {
    id: 'techFault', weight: 4, groundedHours: 24, repair: 40000,
    story: (x) => ({
      kind: 'bad', picture: 'incident',
      headline: 'SMOKE IN THE CABIN',
      sub: `${x.company} jet evacuated at ${x.airport}`,
      body: `Passengers on ${x.id} slid down emergency chutes at ${x.airport} after an electrical fault filled the cabin with smoke. ` +
        `Nobody was seriously hurt. The ${x.type} is out of service for a day; repairs cost ${x.repair}.`,
    }),
  },
  {
    id: 'unruly', weight: 2, groundedHours: 3, repair: 15000,
    story: (x) => ({
      kind: 'bad', picture: 'incident',
      headline: 'PASSENGER DUCT-TAPED TO SEAT',
      sub: `Unruly traveller causes chaos on ${x.from}–${x.to} flight`,
      body: `A passenger on ${x.company} flight ${x.id} tried to open a door in mid-air, shouting about "the lizard people". ` +
        `Fellow travellers restrained the passenger until police met the plane at ${x.airport}. The airline faces cleaning and delay costs of ${x.repair}.`,
    }),
  },
  {
    id: 'doorPlug', weight: 2, groundedHours: 72, repair: 250000, maker: 'Boeing',
    story: (x) => ({
      kind: 'bad', picture: 'incident',
      headline: 'DOOR PANEL BLOWS OUT AT 16,000 FT',
      sub: `Terrifying moments aboard ${x.company} ${x.type}`,
      body: `A panel tore off the fuselage of ${x.id} minutes after leaving ${x.from}, leaving a gaping hole in the cabin. ` +
        `The crew made an emergency landing at ${x.airport}; everyone on board survived. Investigators found bolts missing. ` +
        `The plane is grounded for three days, repairs cost ${x.repair}.`,
    }),
  },
];

// Crash stories. x has id, company, type, maker, from, to, place, pax, survivors, cost.
FG.data.crashStory = (x) => {
  const allSurvived = x.survivors === x.pax;
  const none = x.survivors === 0;
  return {
    kind: 'bad', picture: 'crash',
    headline: allSurvived ? `MIRACLE NEAR ${x.place.toUpperCase()}: ALL ${x.pax} SURVIVE CRASH`
      : `${x.company.toUpperCase()} JET CRASHES NEAR ${x.place.toUpperCase()}`,
    sub: allSurvived ? `${x.type} ${x.id} destroyed in emergency landing`
      : none ? `No survivors among ${x.pax} on board flight ${x.from}–${x.to}`
        : `${x.survivors} of ${x.pax} on board survive`,
    body: `${x.company} flight ${x.id} from ${x.from} to ${x.to}, a ${x.type}, went down near ${x.place}. ` +
      (allSurvived ? 'Rescue teams found everyone alive in the wreckage, an outcome experts called "astonishing". '
        : 'Rescue teams are searching the crash site. ') +
      `Accident investigators have recovered the flight recorders. Bookings with ${x.company} are expected to slump ` +
      `for weeks; compensation, investigation and the lost aircraft cost the airline ${x.cost}.`,
  };
};
