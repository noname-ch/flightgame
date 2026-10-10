// Aircraft factories. New planes are flown from here to the delivery airport.
// Factories outside the map area (America, Asia) sit as stand-ins in a line across Libya.
// If a code matches a normal airport, the delivery simply starts at that airport.
(function () {
  const LIBYA_LAT = 29.0;
  const libyaLon = (i) => 12.0 + i * 1.1; // west to east, i = 0..11

  FG.data.factories = [
    // Europe (real locations)
    { code: 'TLS', name: 'Airbus Toulouse-Blagnac', country: 'FR', lat: 43.629, lon: 1.364,
      types: ['A320', 'A320neo', 'A330-200', 'A330-300', 'A330-900', 'A350-900', 'A350-1000', 'A380-800', 'ATR42-600', 'ATR72-600', 'CONCORDE'] },
    { code: 'XFW', name: 'Airbus Hamburg-Finkenwerder', country: 'DE', lat: 53.535, lon: 9.835,
      types: ['A318', 'A319', 'A321', 'A321neo', 'A321XLR'] },
    { code: 'OBF', name: 'Dornier Oberpfaffenhofen', country: 'DE', lat: 48.081, lon: 11.283, types: ['DO228NG', 'DO328'] },
    { code: 'LPI', name: 'Saab Linköping', country: 'SE', lat: 58.406, lon: 15.680, types: ['SAAB340', 'SAAB2000'] },
    { code: 'AMS', name: 'Fokker Schiphol', country: 'NL', lat: 52.310, lon: 4.768, types: ['F100'] },
    { code: 'WFD', name: 'BAE Woodford', country: 'GB', lat: 53.338, lon: -2.149, types: ['RJ100'] },
    { code: 'DES', name: 'Junkers Dessau', country: 'DE', lat: 51.832, lon: 12.191, types: ['JU52'] },

    // Outside Europe: stand-ins in Libya
    { code: 'SMO', name: 'Douglas Santa Monica', country: 'US', standIn: true, lat: LIBYA_LAT, lon: libyaLon(0), types: ['DC-3'] },
    { code: 'LGB', name: 'McDonnell Douglas Long Beach', country: 'US', standIn: true, lat: LIBYA_LAT, lon: libyaLon(1), types: ['MD-82'] },
    { code: 'PAE', name: 'Boeing Everett', country: 'US', standIn: true, lat: LIBYA_LAT, lon: libyaLon(2),
      types: ['B747-400', 'B747-8', 'B767-300ER', 'B777-200ER', 'B777-300ER', 'B777-9', 'B787-8', 'B787-9'] },
    { code: 'RNT', name: 'Boeing Renton', country: 'US', standIn: true, lat: LIBYA_LAT, lon: libyaLon(3),
      types: ['B737-700', 'B737-800', 'B737-8', 'B737-9', 'B757-200'] },
    { code: 'CHS', name: 'Boeing Charleston', country: 'US', standIn: true, lat: LIBYA_LAT, lon: libyaLon(4), types: ['B787-10'] },
    { code: 'ICT', name: 'Beechcraft Wichita', country: 'US', standIn: true, lat: LIBYA_LAT, lon: libyaLon(5), types: ['B1900D'] },
    { code: 'YMX', name: 'Mirabel (Airbus Canada / Bombardier)', country: 'CA', standIn: true, lat: LIBYA_LAT, lon: libyaLon(6),
      types: ['A220-100', 'A220-300', 'CRJ200', 'CRJ900'] },
    { code: 'YZD', name: 'De Havilland Downsview', country: 'CA', standIn: true, lat: LIBYA_LAT, lon: libyaLon(7), types: ['Q400'] },
    { code: 'YYC', name: 'De Havilland Calgary', country: 'CA', standIn: true, lat: LIBYA_LAT, lon: libyaLon(8), types: ['DHC6-400'] },
    { code: 'SJK', name: 'Embraer São José dos Campos', country: 'BR', standIn: true, lat: LIBYA_LAT, lon: libyaLon(9),
      types: ['ERJ145', 'E175', 'E190', 'E195', 'E190-E2', 'E195-E2'] },
    { code: 'PVG', name: 'COMAC Shanghai', country: 'CN', standIn: true, lat: LIBYA_LAT, lon: libyaLon(10), types: ['C919'] },
    { code: 'KXK', name: 'Sukhoi Komsomolsk-on-Amur', country: 'RU', standIn: true, lat: LIBYA_LAT, lon: libyaLon(11), types: ['SSJ100'] },
  ];
})();
