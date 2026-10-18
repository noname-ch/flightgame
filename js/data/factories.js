// Aircraft factories. New planes are flown from here to the delivery airport.
// If a code matches a normal airport, the delivery simply starts at that airport.
(function () {
  FG.data.factories = [
    // Europe (real locations)
    { code: 'TLS', name: 'Airbus Toulouse-Blagnac', country: 'FR', lat: 43.629, lon: 1.364,
      types: ['A320', 'A320neo', 'A330-200', 'A330-300', 'A330-900', 'A340-600', 'A350-900', 'A350-1000', 'A350-900ULR', 'A350-1000ULR', 'A380-800', 'ATR42-600', 'ATR72-600', 'CONCORDE', 'CARAVELLE', 'A300', 'A310', 'A340-300', 'ATR42-300', 'ATR72-500'] },
    { code: 'XFW', name: 'Airbus Hamburg-Finkenwerder', country: 'DE', lat: 53.535, lon: 9.835,
      types: ['A318', 'A319', 'A321', 'A321neo', 'A321XLR'] },
    { code: 'OBF', name: 'Dornier Oberpfaffenhofen', country: 'DE', lat: 48.081, lon: 11.283, types: ['DO228NG', 'DO328'] },
    { code: 'LPI', name: 'Saab Linköping', country: 'SE', lat: 58.406, lon: 15.680, types: ['SAAB340', 'SAAB2000'] },
    { code: 'AMS', name: 'Fokker Schiphol', country: 'NL', lat: 52.310, lon: 4.768, types: ['F100', 'F27', 'F28', 'F50', 'F70'] },
    { code: 'WFD', name: 'BAE Woodford', country: 'GB', lat: 53.338, lon: -2.149, types: ['RJ100', 'HS748'] },
    { code: 'DES', name: 'Junkers Dessau', country: 'DE', lat: 51.832, lon: 12.191, types: ['JU52'] },
    { code: 'XBK', name: 'Vickers Brooklands, Weybridge', country: 'GB', lat: 51.351, lon: -0.475, types: ['VC-700', 'VC10'] },
    { code: 'FZO', name: 'Bristol Filton', country: 'GB', lat: 51.519, lon: -2.590, types: ['BRIT-310'] },
    { code: 'HTF', name: 'de Havilland / Hawker Siddeley Hatfield', country: 'GB', lat: 51.765, lon: -0.248, types: ['COMET4', 'TRIDENT', 'BAE146'] },
    { code: 'BOH', name: 'BAC Hurn', country: 'GB', lat: 50.780, lon: -1.840, types: ['BAC111'] },
    { code: 'BRE', name: 'VFW-Fokker Bremen', country: 'DE', lat: 53.047, lon: 8.787, types: ['VFW614'] },
    { code: 'XMZ', name: 'Ilyushin Znamya Truda, Moscow', country: 'RU', lat: 55.790, lon: 37.530, types: ['IL-18'] },
    { code: 'KZN', name: 'Kazan Aircraft Plant', country: 'RU', lat: 55.606, lon: 49.279, types: ['IL-62'] },
    { code: 'VOZ', name: 'Voronezh Aircraft Plant', country: 'RU', lat: 51.814, lon: 39.231, types: ['IL-86', 'TU-144'] },
    { code: 'HRK', name: 'Kharkiv Aircraft Plant', country: 'UA', lat: 49.927, lon: 36.291, types: ['TU-104', 'TU-134'] },
    { code: 'XKB', name: 'Aviakor Kuibyshev (Samara)', country: 'RU', lat: 53.250, lon: 50.320, types: ['TU-114', 'TU-154'] },
    { code: 'RTW', name: 'Saratov Aviation Plant', country: 'RU', lat: 51.565, lon: 46.047, types: ['YAK-40'] },

    // Outside Europe
    { code: 'SMO', name: 'Douglas Santa Monica', country: 'US', lat: 34.016, lon: -118.451, types: ['DC-3', 'DC-4', 'DC-6B', 'DC-7C'] },
    { code: 'LGB', name: 'McDonnell Douglas Long Beach', country: 'US', lat: 33.818, lon: -118.152, types: ['MD-82', 'DC-8-50', 'DC-8-63', 'DC-9-30', 'DC-9-50', 'DC-10-10', 'DC-10-30', 'MD-81', 'MD-11', 'B717'] },
    { code: 'PAE', name: 'Boeing Everett', country: 'US', lat: 47.906, lon: -122.282,
      types: ['B747-400', 'B747-8', 'B767-300ER', 'B777-200ER', 'B777-300ER', 'B777-9', 'B787-8', 'B787-9', 'B747-100', 'B747-200B', 'B747SP', 'B767-200'] },
    { code: 'RNT', name: 'Boeing Renton', country: 'US', lat: 47.493, lon: -122.216,
      types: ['B737-700', 'B737-800', 'B737-8', 'B737-9', 'B757-200', 'B707-120', 'B707-320B', 'B720', 'B727-100', 'B727-200', 'B737-200', 'B737-300'] },
    { code: 'CHS', name: 'Boeing Charleston', country: 'US', lat: 32.899, lon: -80.04, types: ['B787-10'] },
    { code: 'ICT', name: 'Beechcraft Wichita', country: 'US', lat: 37.65, lon: -97.433, types: ['B1900D'] },
    { code: 'YMX', name: 'Mirabel (Airbus Canada / Bombardier)', country: 'CA', lat: 45.68, lon: -74.039,
      types: ['A220-100', 'A220-300', 'CRJ200', 'CRJ900', 'CRJ100', 'CRJ700'] },
    { code: 'YZD', name: 'De Havilland Downsview', country: 'CA', lat: 43.742, lon: -79.466, types: ['Q400', 'DHC6', 'DHC7', 'DASH8-100'] },
    { code: 'YYC', name: 'De Havilland Calgary', country: 'CA', lat: 51.131, lon: -114.01, types: ['DHC6-400'] },
    { code: 'SJK', name: 'Embraer São José dos Campos', country: 'BR', lat: -23.229, lon: -45.871,
      types: ['ERJ145', 'E175', 'E190', 'E195', 'E190-E2', 'E195-E2', 'EMB110', 'EMB120', 'E170'] },
    { code: 'SAN', name: 'Convair San Diego', country: 'US', lat: 32.734, lon: -117.190, types: ['CV-340', 'CV-880'] },
    { code: 'BUR', name: 'Lockheed Burbank', country: 'US', lat: 34.203, lon: -118.358, types: ['L-1049G', 'L-188'] },
    { code: 'PMD', name: 'Lockheed Palmdale', country: 'US', lat: 34.629, lon: -118.085, types: ['L-1011'] },
    { code: 'NKM', name: 'NAMC / Mitsubishi Komaki', country: 'JP', lat: 35.256, lon: 136.924, types: ['YS-11'] },
    { code: 'PVG', name: 'COMAC Shanghai', country: 'CN', lat: 31.143, lon: 121.805, types: ['C919'] },
    { code: 'KXK', name: 'Sukhoi Komsomolsk-on-Amur', country: 'RU', lat: 50.409, lon: 136.934, types: ['SSJ100'] },
  ];
})();
