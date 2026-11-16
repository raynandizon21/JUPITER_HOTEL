import { Holiday } from '../types/hotel';

/**
 * Philippine holidays used as the starting list (the server seeds them into the `holidays` table;
 * staff can add / fix dates on the Holidays page — the government proclaims each year's list,
 * and movable dates like Eid'l Fitr / Eid'l Adha are announced separately, so add those when proclaimed).
 * regular = regular holiday · special = special (non-working) day
 */
export const PH_HOLIDAYS: Omit<Holiday, 'active'>[] = [
  // 2026
  { date: '2026-01-01', name: "New Year's Day", type: 'regular' },
  { date: '2026-02-17', name: 'Chinese New Year', type: 'special' },
  { date: '2026-04-02', name: 'Maundy Thursday', type: 'regular' },
  { date: '2026-04-03', name: 'Good Friday', type: 'regular' },
  { date: '2026-04-04', name: 'Black Saturday', type: 'special' },
  { date: '2026-04-09', name: 'Araw ng Kagitingan', type: 'regular' },
  { date: '2026-05-01', name: 'Labor Day', type: 'regular' },
  { date: '2026-06-12', name: 'Independence Day', type: 'regular' },
  { date: '2026-08-21', name: 'Ninoy Aquino Day', type: 'special' },
  { date: '2026-08-31', name: 'National Heroes Day', type: 'regular' },
  { date: '2026-11-01', name: "All Saints' Day", type: 'special' },
  { date: '2026-11-02', name: "All Souls' Day", type: 'special' },
  { date: '2026-11-30', name: 'Bonifacio Day', type: 'regular' },
  { date: '2026-12-08', name: 'Feast of the Immaculate Conception', type: 'special' },
  { date: '2026-12-24', name: 'Christmas Eve', type: 'special' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'regular' },
  { date: '2026-12-30', name: 'Rizal Day', type: 'regular' },
  { date: '2026-12-31', name: 'Last Day of the Year', type: 'special' },
  // 2027
  { date: '2027-01-01', name: "New Year's Day", type: 'regular' },
  { date: '2027-02-06', name: 'Chinese New Year', type: 'special' },
  { date: '2027-03-25', name: 'Maundy Thursday', type: 'regular' },
  { date: '2027-03-26', name: 'Good Friday', type: 'regular' },
  { date: '2027-03-27', name: 'Black Saturday', type: 'special' },
  { date: '2027-04-09', name: 'Araw ng Kagitingan', type: 'regular' },
  { date: '2027-05-01', name: 'Labor Day', type: 'regular' },
  { date: '2027-06-12', name: 'Independence Day', type: 'regular' },
  { date: '2027-08-21', name: 'Ninoy Aquino Day', type: 'special' },
  { date: '2027-08-30', name: 'National Heroes Day', type: 'regular' },
  { date: '2027-11-01', name: "All Saints' Day", type: 'special' },
  { date: '2027-11-02', name: "All Souls' Day", type: 'special' },
  { date: '2027-11-30', name: 'Bonifacio Day', type: 'regular' },
  { date: '2027-12-08', name: 'Feast of the Immaculate Conception', type: 'special' },
  { date: '2027-12-24', name: 'Christmas Eve', type: 'special' },
  { date: '2027-12-25', name: 'Christmas Day', type: 'regular' },
  { date: '2027-12-30', name: 'Rizal Day', type: 'regular' },
  { date: '2027-12-31', name: 'Last Day of the Year', type: 'special' },
];
