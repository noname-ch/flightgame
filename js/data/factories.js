// Aircraft factories. New planes are flown from here to the delivery airport.
// If a code matches a normal airport, the delivery simply starts at that airport.
(function () {
  FG.data.factories = [
    // Europe (real locations)
    { code: 'TLS', name: 'Airbus Toulouse-Blagnac', country: 'FR', lat: 43.629, lon: 1.364,
      types: ['A320', 'A320neo', 'A330-200', 'A330-300', 'A330-900', 'A340-600', 'A350-900', 'A350-1000', 'A380-800', 'ATR42-600', 'ATR72-600', 'CONCORDE'] },
    { code: 'XFW', name: 'Airbus Hamburg-Finkenwerder', country: 'DE', lat: 53.535, lon: 9.835,
      types: ['A318', 'A319', 'A321', 'A321neo', 'A321XLR'] },
    { code: 'OBF', name: 'Dornier Oberpfaffenhofen', country: 'DE', lat: 48.081, lon: 11.283, types: ['DO228NG', 'DO328'] },
    { code: 'LPI', name: 'Saab Linköping', country: 'SE', lat: 58.406, lon: 15.680, types: ['SAAB340', 'SAAB2000'] },
    { code: 'AMS', name: 'Fokker Schiphol', country: 'NL', lat: 52.310, lon: 4.768, types: ['F100'] },
    { code: 'WFD', name: 'BAE Woodford', country: 'GB', lat: 53.338, lon: -2.149, types: ['RJ100'] },
    { code: 'DES', name: 'Junkers Dessau', country: 'DE', lat: 51.832, lon: 12.191, types: ['JU52'] },

    // Outside Europe
    { code: 'SMO', name: 'Douglas Santa Monica', country: 'US', lat: 34.016, lon: -118.451, types: ['DC-3'] },
    { code: 'LGB', name: 'McDonnell Douglas Long Beach', country: 'US', lat: 33.818, lon: -118.152, types: ['MD-82'] },
    { code: 'PAE', name: 'Boeing Everett', country: 'US', lat: 47.906, lon: -122.282,
      types: ['B747-400', 'B747-8', 'B767-300ER', 'B777-200ER', 'B777-300ER', 'B777-9', 'B787-8', 'B787-9'] },
    { code: 'RNT', name: 'Boeing Renton', country: 'US', lat: 47.493, lon: -122.216,
      types: ['B737-700', 'B737-800', 'B737-8', 'B737-9', 'B757-200'] },
    { code: 'CHS', name: 'Boeing Charleston', country: 'US', lat: 32.899, lon: -80.04, types: ['B787-10'] },
    { code: 'ICT', name: 'Beechcraft Wichita', country: 'US', lat: 37.65, lon: -97.433, types: ['B1900D'] },
    { code: 'YMX', name: 'Mirabel (Airbus Canada / Bombardier)', country: 'CA', lat: 45.68, lon: -74.039,
      types: ['A220-100', 'A220-300', 'CRJ200', 'CRJ900'] },
    { code: 'YZD', name: 'De Havilland Downsview', country: 'CA', lat: 43.742, lon: -79.466, types: ['Q400'] },
    { code: 'YYC', name: 'De Havilland Calgary', country: 'CA', lat: 51.131, lon: -114.01, types: ['DHC6-400'] },
    { code: 'SJK', name: 'Embraer São José dos Campos', country: 'BR', lat: -23.229, lon: -45.871,
      types: ['ERJ145', 'E175', 'E190', 'E195', 'E190-E2', 'E195-E2'] },
    { code: 'PVG', name: 'COMAC Shanghai', country: 'CN', lat: 31.143, lon: 121.805, types: ['C919'] },
    { code: 'KXK', name: 'Sukhoi Komsomolsk-on-Amur', country: 'RU', lat: 50.409, lon: 136.934, types: ['SSJ100'] },
  ];
})();
