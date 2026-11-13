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
  category?: 'buffet' | 'extraBed' | 'other';
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

/** Payments Jupiter makes to the hotel for one reference month. */
export interface Settlement {
  month: string; // YYYY-MM
  payments: FolioPayment[];
}

export type ActiveModule = 'dashboard' | 'daily' | 'ledger' | 'calendar' | 'maintenance' | 'calculator';
