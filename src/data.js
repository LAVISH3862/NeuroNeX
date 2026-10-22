// Simulated travel world for the ReRoute prototype.
// All bookings, schedules and prices are made up for demo purposes.
// In production these would come from booking APIs (IRCTC, airlines, KSRTC, hotel channel managers).

const traveller = {
  name: 'Sathvik Shetty',
  home: 'Bengaluru',
  destination: 'Mangaluru',
  purpose: "Cousin's wedding in Udupi",
  languages: ['en', 'kn', 'hi'],
};

// The moment the demo "happens"
const NOW = '2026-10-24T17:30';

const defaultConstraints = {
  extraBudget: 3000, // max extra money the traveller is OK spending (after refunds)
  arriveBy: '2026-10-25T09:00', // must reach Mangaluru by this time
  priority: 'balanced', // cheapest | fastest | comfort | balanced
  notes: '',
};

// Bookings form a dependency chain: train -> hotel -> cab -> wedding.
const bookings = [
  {
    id: 'TRN',
    type: 'train',
    title: 'Train 16511, KSR Bengaluru to Mangaluru Central',
    provider: 'Indian Railways (IRCTC)',
    ref: 'PNR 452 187 9330',
    start: '2026-10-24T20:00',
    end: '2026-10-25T06:40',
    from: 'KSR Bengaluru',
    to: 'Mangaluru Central',
    price: 1165,
    detail: '3A, coach B2, berth 34',
    dependsOn: null,
  },
  {
    id: 'HTL',
    type: 'hotel',
    title: 'Hotel Sea Breeze Residency, Mangaluru',
    provider: 'Hotel direct booking',
    ref: 'HSB-77812',
    start: '2026-10-25T07:00', // early check-in arranged
    end: '2026-10-26T11:00',
    price: 2400,
    detail: 'Deluxe room, early check-in 7:00 AM',
    dependsOn: 'TRN',
  },
  {
    id: 'CAB',
    type: 'cab',
    title: 'Cab to wedding venue, Udupi',
    provider: 'Coastal Cabs',
    ref: 'CAB-3391',
    start: '2026-10-25T09:15',
    end: '2026-10-25T10:30',
    durationMin: 75,
    price: 1400,
    detail: 'Pickup at hotel, sedan',
    dependsOn: 'HTL',
  },
  {
    id: 'EVT',
    type: 'event',
    title: 'Wedding muhurtham, Udupi',
    provider: 'Personal commitment',
    ref: 'Cannot be moved',
    start: '2026-10-25T11:00',
    end: '2026-10-25T14:00',
    price: 0,
    detail: 'Hard deadline, reach 15 min early',
    dependsOn: 'CAB',
  },
  {
    id: 'RET',
    type: 'flight',
    title: 'Flight IX 2793, Mangaluru to Bengaluru',
    provider: 'Air India Express',
    ref: 'PNR K7QX2M',
    start: '2026-10-26T18:20',
    end: '2026-10-26T19:25',
    price: 3950,
    detail: 'Return trip',
    dependsOn: null,
  },
];

// Disruptions the demo can simulate
const scenarios = [
  {
    id: 'train-cancelled',
    label: 'Train cancelled',
    bookingId: 'TRN',
    kind: 'cancel',
    at: '2026-10-24T17:30',
    headline: 'Train 16511 has been cancelled',
    cause: 'Track maintenance between Sakleshpur and Subrahmanya Road',
    refund: { amount: 1165, how: 'Automatic full refund for cancelled e-tickets, credited in 3 to 7 days' },
  },
  {
    id: 'train-delayed',
    label: 'Train delayed by 4.5 hours',
    bookingId: 'TRN',
    kind: 'delay',
    delayMin: 270,
    at: '2026-10-24T17:30',
    headline: 'Train 16511 is running 4 h 30 min late',
    cause: 'Late arrival of the incoming rake',
    refund: { amount: 1165, how: 'File a TDR on IRCTC before departure (train delayed more than 3 hours) for a full fare refund' },
  },
  {
    id: 'hotel-overbooked',
    label: 'Hotel overbooked',
    bookingId: 'HTL',
    kind: 'cancel',
    at: '2026-10-24T18:00',
    headline: 'Hotel Sea Breeze Residency cancelled your room',
    cause: 'Property overbooked for the wedding season',
    refund: { amount: 2400, how: 'Hotel refunds the full amount to the original payment method' },
  },
];

// Alternatives to get from Bengaluru to Mangaluru
const transportOptions = [
  {
    id: 'BUS-AIRAVAT',
    mode: 'bus',
    title: 'KSRTC Airavat Club Class (Volvo)',
    from: 'Shanthinagar bus stand',
    to: 'Mangaluru KSRTC bus stand, Bejai',
    dep: '2026-10-24T21:30',
    arr: '2026-10-25T06:15',
    price: 1250,
    comfort: 4,
    availability: '6 seats left',
    confirmed: true,
  },
  {
    id: 'BUS-RAJAHAMSA',
    mode: 'bus',
    title: 'KSRTC Rajahamsa Executive',
    from: 'Kempegowda bus station (Majestic)',
    to: 'Mangaluru KSRTC bus stand, Bejai',
    dep: '2026-10-24T22:15',
    arr: '2026-10-25T07:35',
    price: 790,
    comfort: 2,
    availability: '14 seats left',
    confirmed: true,
  },
  {
    id: 'BUS-SLEEPER',
    mode: 'bus',
    title: 'Private AC sleeper bus',
    from: 'Anand Rao Circle',
    to: 'Mangaluru, Jyothi Circle',
    dep: '2026-10-24T22:45',
    arr: '2026-10-25T08:05',
    price: 1150,
    comfort: 3,
    availability: '3 berths left',
    confirmed: true,
  },
  {
    id: 'FLT-EVENING',
    mode: 'flight',
    title: 'IndiGo 6E 5291 (tonight)',
    from: 'Bengaluru airport (BLR)',
    to: 'Mangaluru airport (IXE)',
    dep: '2026-10-24T20:55',
    arr: '2026-10-24T22:00',
    price: 5400,
    comfort: 5,
    availability: '9 seats left',
    confirmed: true,
  },
  {
    id: 'FLT-MORNING',
    mode: 'flight',
    title: 'Air India Express IX 2741 (early morning)',
    from: 'Bengaluru airport (BLR)',
    to: 'Mangaluru airport (IXE)',
    dep: '2026-10-25T06:15',
    arr: '2026-10-25T07:20',
    price: 3900,
    comfort: 5,
    availability: '4 seats left',
    confirmed: true,
  },
  {
    id: 'TRN-ALT',
    mode: 'train',
    title: 'Train 16575 Gomateshwara Express (Tatkal)',
    from: 'Yesvantpur',
    to: 'Mangaluru Junction',
    dep: '2026-10-24T23:00',
    arr: '2026-10-25T10:45',
    price: 980,
    comfort: 3,
    availability: 'Waitlist WL 12',
    confirmed: false,
  },
  {
    id: 'TAXI',
    mode: 'taxi',
    title: 'One-way outstation taxi',
    from: 'Your location, Bengaluru',
    to: 'Hotel, Mangaluru',
    dep: '2026-10-24T19:00',
    arr: '2026-10-25T02:30',
    price: 9500,
    comfort: 3,
    availability: 'Available',
    confirmed: true,
  },
];

// Alternatives if the hotel falls through
const hotelOptions = [
  {
    id: 'HTL-KADRI',
    title: 'Hotel Kadri Comforts, Mangaluru',
    city: 'Mangaluru',
    price: 2650,
    rating: 4.1,
    earlyCheckin: true,
    comfort: 4,
    availability: '2 rooms left',
  },
  {
    id: 'HTL-NANDINI',
    title: 'Nandini Residency, Mangaluru',
    city: 'Mangaluru',
    price: 1900,
    rating: 3.7,
    earlyCheckin: false,
    comfort: 3,
    availability: '5 rooms left',
  },
  {
    id: 'HTL-UDUPI',
    title: 'Udupi Bay Stay, near the venue',
    city: 'Udupi',
    price: 2300,
    rating: 4.3,
    earlyCheckin: true,
    comfort: 4,
    availability: '1 room left',
  },
  {
    id: 'HTL-GRAND',
    title: 'Grand Coastal Suites, Mangaluru',
    city: 'Mangaluru',
    price: 5800,
    rating: 4.7,
    earlyCheckin: true,
    comfort: 5,
    availability: '6 rooms left',
  },
];

module.exports = { traveller, NOW, defaultConstraints, bookings, scenarios, transportOptions, hotelOptions };
