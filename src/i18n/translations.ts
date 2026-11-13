export type Language = 'en' | 'ko';

export const translations = {
  en: {
    // Navigation
    navDashboard: 'Dashboard',
    navDaily: 'Daily Settlement',
    navLedger: 'Guest Ledger',
    navCalendar: 'Reservation Calendar',
    navMaintenance: 'Room Rates',
    navCalculator: 'Rate Calculator',

    nightsUnit: 'nights',

    // Ledger
    ledgerTitle: 'Guest Ledger',
    ledgerNote: 'All reservations and their payment status.',
    btnExportCSV: 'Export CSV',
    btnNewReservation: 'New Reservation',
    searchLedgerPlaceholder: 'Search guest name, room, remarks...',
    allMonths: 'All Months',
    filterAll: 'All',
    filterPaid: 'Paid',
    filterUnpaid: 'Unpaid',
    thGuestName: 'Guest Name',
    thRoomType: 'Room Type',
    thNightsAuto: 'Nights (Auto)',
    thAmountPHP: 'Payment Amount (PHP)',
    thRemarks: 'Remarks / Notes',
    thPaymentStatus: 'Payment Status',
    thManage: 'Actions',
    noReservationsFound: 'No reservations found. Click "New Reservation" to add one.',
    statusPaid: 'Paid',
    statusUnpaid: 'Unpaid',
    edit: 'Edit',
    delete: 'Delete',
    confirmDelete: 'Are you sure you want to delete reservation for guest',

    // Add / Edit Modal
    modalTitleNew: 'New Reservation',
    modalTitleEdit: 'Edit Reservation',
    lblGuestName: 'Guest Name *',
    lblRoomType: 'Room Type',
    lblCheckIn: 'Check-in Date *',
    lblCheckOut: 'Check-out Date *',
    lblTotalStayDuration: 'Total Stay Duration:',
    lblPaymentAmount: 'Payment Amount (PHP) *',
    lblRemarks: 'Remarks / Special Requests',
    btnCancel: 'Cancel',
    btnSaveReservation: 'Save Reservation',
    btnUpdateReservation: 'Update Reservation',

    // Calendar
    statusCheckIn: 'Check-in',
    statusStaying: 'Staying',
    statusCheckOut: 'Check-out',
  },
  ko: {
    // Navigation
    navDashboard: '대시보드',
    navDaily: '일별 정산',
    navLedger: '손님별 예약 관리부',
    navCalendar: '예약 현황 달력',
    navMaintenance: '객실 요금표',
    navCalculator: '숙박 요금 계산기',

    nightsUnit: '박',

    // Ledger
    ledgerTitle: '예약 관리부',
    ledgerNote: '모든 예약과 결제 현황.',
    btnExportCSV: 'CSV 내보내기',
    btnNewReservation: '새 예약 등록',
    searchLedgerPlaceholder: '예약자명, 객실, 비고 검색...',
    allMonths: '전체 (All)',
    filterAll: '전체',
    filterPaid: '결제완료',
    filterUnpaid: '미결제',
    thGuestName: '예약자명',
    thRoomType: '객실 타입',
    thNightsAuto: '박수 (자동)',
    thAmountPHP: '결제 금액 (페소)',
    thRemarks: '비고 / 특이사항',
    thPaymentStatus: '결제 상태',
    thManage: '관리',
    noReservationsFound: '등록된 예약 내역이 없습니다. 새 예약을 등록해보세요.',
    statusPaid: '결제완료',
    statusUnpaid: '미결제',
    edit: '수정',
    delete: '삭제',
    confirmDelete: '고객의 예약 건을 삭제하시겠습니까?',

    // Add / Edit Modal
    modalTitleNew: '새 예약 등록 (New Reservation)',
    modalTitleEdit: '예약 내역 수정',
    lblGuestName: '예약자명 (Guest Name) *',
    lblRoomType: '객실 타입 (Room Type)',
    lblCheckIn: '체크인 날짜 (Check-in) *',
    lblCheckOut: '체크아웃 날짜 (Check-out) *',
    lblTotalStayDuration: '총 숙박 기간:',
    lblPaymentAmount: '결제 금액 (페소/PHP) *',
    lblRemarks: '비고 / 특이사항 (Remarks)',
    btnCancel: '취소',
    btnSaveReservation: '예약 등록하기',
    btnUpdateReservation: '수정 완료',

    // Calendar
    statusCheckIn: '입실',
    statusStaying: '체류',
    statusCheckOut: '퇴실',
  },
};
