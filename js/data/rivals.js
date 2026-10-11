// AI competitor airlines (all fictional). A new game starts the C.rivals.near ones whose hubs are
// closest to the player's home airport plus C.rivals.far others from elsewhere in the world.
// kind: flag = network carrier from its hub(s), long haul too; low = low-cost from several bases,
// cheap tickets; regional = small jets and turboprops on short routes.
FG.data.rivalTemplates = [
  // Europe
  { name: 'Alpina', kind: 'flag', hubs: ['ZRH'] },
  { name: 'Eurojumbo', kind: 'flag', hubs: ['FRA', 'MUC'] },
  { name: 'Lutèce Air', kind: 'flag', hubs: ['CDG'] },
  { name: 'Albion Airways', kind: 'flag', hubs: ['LHR'] },
  { name: 'Tulip Air', kind: 'flag', hubs: ['AMS'] },
  { name: 'Iberica', kind: 'flag', hubs: ['MAD'] },
  { name: 'Nordwind', kind: 'flag', hubs: ['CPH', 'ARN', 'OSL'] },
  { name: 'Bosporus Air', kind: 'flag', hubs: ['IST'] },
  { name: 'Olympia Airways', kind: 'flag', hubs: ['ATH'] },
  { name: 'SkyBudget', kind: 'low', hubs: ['BSL', 'BCN', 'LGW', 'MXP'] },
  { name: 'FlyCheapo', kind: 'low', hubs: ['DUB', 'STN', 'BGY', 'LIS'] },
  { name: 'Alpenwind Airways', kind: 'regional', hubs: ['GVA', 'VIE'] },
  { name: 'Air Edelweissbrot', kind: 'regional', hubs: ['LUG', 'SIR'] },
  { name: 'Vistula Air', kind: 'regional', hubs: ['WAW', 'PRG'] },
  // Middle East and Africa
  { name: 'Gulf Falcon', kind: 'flag', hubs: ['DXB'] },
  { name: 'Pearl Airways', kind: 'flag', hubs: ['DOH'] },
  { name: 'Nile Wings', kind: 'flag', hubs: ['CAI'] },
  { name: 'Sahara Wings', kind: 'regional', hubs: ['CMN'] },
  { name: 'Springbok Air', kind: 'flag', hubs: ['JNB'] },
  { name: 'Savanna Air', kind: 'regional', hubs: ['NBO', 'ADD'] },
  // Asia and Oceania
  { name: 'Sakura Air', kind: 'flag', hubs: ['HND'] },
  { name: 'Merlion Air', kind: 'flag', hubs: ['SIN'] },
  { name: 'Lotus Airways', kind: 'flag', hubs: ['PVG', 'HKG'] },
  { name: 'Hanbit Air', kind: 'flag', hubs: ['ICN'] },
  { name: 'Bengal Air', kind: 'flag', hubs: ['DEL', 'BOM'] },
  { name: 'Siam Skies', kind: 'low', hubs: ['BKK'] },
  { name: 'Southern Cross Air', kind: 'flag', hubs: ['SYD', 'MEL', 'AKL'] },
  // Americas
  { name: 'Liberty Airlines', kind: 'flag', hubs: ['JFK', 'ORD'] },
  { name: 'Peach State Air', kind: 'flag', hubs: ['ATL', 'DFW'] },
  { name: 'Pacific Coast Air', kind: 'low', hubs: ['LAX', 'SFO'] },
  { name: 'Maple Air', kind: 'flag', hubs: ['YYZ'] },
  { name: 'Azteca Air', kind: 'flag', hubs: ['MEX'] },
  { name: 'Carioca Air', kind: 'flag', hubs: ['GRU'] },
  { name: 'Andes Air', kind: 'flag', hubs: ['LIM', 'BOG', 'SCL'] },
  { name: 'Pampa Air', kind: 'low', hubs: ['EZE'] },
];

// Livery colours handed out to the rivals of a game (none of them close to the player's red or the route blue).
FG.data.rivalColors = ['#f97316', '#14b8a6', '#eab308', '#ec4899', '#84cc16', '#06b6d4', '#a16207', '#10b981',
  '#d946ef', '#78716c', '#fb7185', '#65a30d'];
