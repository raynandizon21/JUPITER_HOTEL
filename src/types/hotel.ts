// Casino Room Rates & Vouchers (Image 2)
export interface CasinoRoomItem {
  id: string;
  name: string;
  singleDoubleWeekday: number;
  tripleWeekday: number;
  singleDoubleWeekend: number;
  tripleWeekend: number;
}

export interface CasinoRatesConfig {
  rooms: CasinoRoomItem[];
  vouchers: {
    breakfast: number;
    dinner: number;
    extraBed: number;
  };
}

export type PaymentStatus = '결제완료' | '미결제';

export interface Reservation {
  id: string;
  guestName: string;
  roomType: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  nights: number;
  amount: number;
  currency: 'PHP' | 'KRW';
  referenceMonth: string; // YYYY-MM
  remarks: string;
  paymentStatus: PaymentStatus;
  occupancy?: 'singleDouble' | 'triple';
  isJupiterGuest?: boolean;
  holidayDates?: string[]; // nights charged at the weekend (holiday) rate
  compDates?: string[]; // complimentary (free) nights — charged ₱0
  /** Confirmation number given by the hotel (typed in by staff; unique across bookings). */
  confirmationNo?: string;
  /** Agent who sent the guest (from the Agents list; new names are added on save). */
  agentName?: string;
  oic?: string; // hotel officer-in-charge who handled the booking
  charges?: FolioCharge[]; // extra charges on the guest folio (room charge = amount)
  payments?: FolioPayment[]; // payments received from the guest
}

export type PaymentMethod = 'Cash' | 'Bank Transfer' | 'GCash' | 'Credit Card' | 'Junket Account';

export interface FolioCharge {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  qty: number;
  unitPrice: number;
  /** Complimentary: shown on the bill but charged ₱0. */
  free?: boolean;
  category?: 'buffet' | 'extraBed' | 'other' | 'breakfast' | 'dinner'; // breakfast / dinner: voucher-only purchases
}

export interface FolioPayment {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  method: PaymentMethod;
  reference: string;
  /** Person in charge who handled the payment (payments to the hotel). */
  oic?: string;
  remarks?: string;
}

/**
 * Vouchers bought without a room booking (breakfast / dinner / other).
 * Kept for the record: shown in the Guest Ledger and Daily Settlement, not in the hotel settlement totals.
 */
export interface VoucherSale {
  id: string;
  date: string; // YYYY-MM-DD (purchase date; its month is the month it is listed under)
  guestName: string;
  agentName?: string;
  remarks: string;
  items: FolioCharge[]; // qty × unitPrice each
  payments: FolioPayment[];
}

/** Payments Jupiter makes to the hotel for one reference month. */
export interface Settlement {
  month: string; // YYYY-MM
  payments: FolioPayment[];
}

export type ActiveModule = 'dashboard' | 'daily' | 'ledger' | 'calendar' | 'maintenance' | 'calculator' | 'agents' | 'fund';

/** Philippine holiday (table `holidays`). */
export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  type: 'regular' | 'special'; // regular holiday / special non-working day
  active: boolean;
}

/** Fund (Pondo): a manual cash out or opening balance of the room / voucher fund. Never deleted — voided instead. */
export interface FundTxn {
  id: string;
  fund: 'room' | 'voucher';
  type: 'out' | 'opening';
  date: string; // YYYY-MM-DD
  amount: number;
  method: PaymentMethod;
  purpose: 'withdrawal' | 'expense' | 'remit' | 'other' | 'opening';
  releasedBy: string;
  receivedBy: string;
  reference: string;
  remarks: string;
  voided: boolean;
  voidReason: string;
}

/** Agents file maintenance (table `agents`). */
export interface Agent {
  id: number;
  name: string;
  active: boolean; // false = hidden from suggestions
  bookings: number; // active room bookings
  vouchers: number; // active voucher-only purchases
  lastDate: string; // latest check-in / purchase date, '' if none
  createdAt: string;
}
