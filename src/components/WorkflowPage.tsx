import React, { useState } from 'react';
import { AlertTriangle, BookOpenText, Building2, CheckCircle2, Lightbulb, Maximize2, SlidersHorizontal, Users, Wallet } from 'lucide-react';
import { ActiveModule, CasinoRatesConfig, HotelPurchase, Reservation, Settlement, VoucherSale } from '../types/hotel';
import { folioOf, peso, settlementOf, todayISO, voucherTotals } from '../utils/billing';
import { formatMonth } from '../utils/hotelHelpers';
import { buildStock, purchaseTotal } from '../utils/inventory';
import { Language } from '../i18n/translations';
import { Dialog, PageHeader } from './ui';
import jupiterLogo from '../logo.jpg';

/** soft tint of a step (its page-button colours without the hover fill) */
const tint = (s: { soft: string }) => s.soft.split(' ').filter((c) => !c.startsWith('hover:')).join(' ');

type Step = {
  Icon: React.ElementType;
  /** solid colour (icon, numbers) and soft colour (page button) */
  color: string;
  soft: string;
  title: string;
  /** what staff do, in order */
  /** what staff do, in order: [short action, small detail] */
  do: [string, string][];
  /** what it changes, one line */
  result: string;
  /** the detail staff usually miss */
  tip: string;
  to: ActiveModule;
  page: string;
  /** one process, two sides of the same form (Hotel | Guest), shown side by side — the card is 2 columns wide */
  sides?: { label: string; sub: string; tone: string; do: [string, string][] }[];
  /** actions after the sides */
  then?: [string, string][];
};

/**
 * System Workflow (sidebar → Guide): Hilton ↔ Jupiter ↔ Guest at a glance and the 4 steps staff
 * follow, each in two actions. A step's page button opens that page itself in a pop-up
 * (no leaving this page).
 */
export const WorkflowPage: React.FC<{
  language: Language;
  renderModule: (m: ActiveModule) => React.ReactNode;
  purchases: HotelPurchase[];
  reservations: Reservation[];
  voucherSales: VoucherSale[];
  settlements: Settlement[];
  rates: CasinoRatesConfig;
}> = ({ language, renderModule, purchases, reservations, voucherSales, settlements, rates }) => {
  const en = language === 'en';
  const [openPage, setOpenPage] = useState<number | null>(null);

  const steps: Step[] = [
    {
      Icon: SlidersHorizontal,
      color: 'bg-ink',
      soft: 'bg-ink/10 text-ink hover:bg-ink hover:text-white',
      title: en ? 'Set guest prices' : '손님 가격 설정',
      do: en
        ? [['Open Settings', 'on the Room Rates page'], ['Type the room rates', 'Sun–Thu / Fri–Sat, 1–2 or 3 guests'], ['Set voucher prices → Save', 'breakfast, dinner, extra bed']]
        : [['설정 열기', '객실 요금 페이지'], ['객실 요금 입력', '일~목 / 금~토, 1~2인 / 3인'], ['바우처 가격 → 저장', '조식, 석식, 엑스트라 베드']],
      result: en ? 'New bookings are priced automatically' : '새 예약 요금 자동 계산',
      tip: en ? 'Holiday nights use the Fri–Sat rate (⚙ Holidays on the Guest Ledger).' : '공휴일은 금~토 요금 (예약 관리부 ⚙ 공휴일).',
      to: 'maintenance',
      page: en ? 'Room Rates' : '객실 요금',
    },
    {
      Icon: BookOpenText,
      color: 'bg-warn',
      soft: 'bg-warn-soft text-warn hover:bg-warn hover:text-white',
      title: en ? 'Book the guest + buy from Hilton' : '손님 예약 + 힐튼 구매',
      do: en ? [['New Booking', 'agent, guest, room type, stay dates']] : [['새 예약', '에이전트, 손님, 객실 타입, 숙박 기간']],
      sides: [
        {
          label: en ? 'Hotel' : '호텔',
          sub: en ? 'what Jupiter pays Hilton' : '주피터 → 힐튼',
          tone: 'bg-violet-soft text-violet border-violet-line',
          do: en
            ? [['Cost per night', 'last price paid is filled in'], ['Free night from Hilton?', 'tick its Complimentary box → ₱0']]
            : [['1박 원가', '최근 구매가 자동 입력'], ['힐튼 무료 숙박?', '무료 칸 체크 → ₱0']],
        },
        {
          label: en ? 'Guest' : '손님',
          sub: en ? 'what the guest pays' : '손님 → 주피터',
          tone: 'bg-ok-soft text-ok border-ok-line',
          do: en
            ? [['Amount', 'rate fills in · holiday = weekend rate'], ['Add vouchers', 'breakfast, dinner, extra bed · free ones too']]
            : [['금액', '요금 자동 · 공휴일 = 주말 요금'], ['바우처 추가', '조식, 석식, 엑스트라 베드 · 무료 포함']],
        },
      ],
      then: en ? [['Guest payment → Save', 'Paid in full now or Bill later']] : [['손님 결제 → 저장', '지금 결제 또는 나중에 청구']],
      result: en ? "One Save = guest bill + Hilton purchase (that month's Hilton bill) · margin shown" : '한 번 저장 = 손님 청구 + 힐튼 구매 (그 달 힐튼 청구액) · 마진 표시',
      tip: en ? 'Bulk buy with no guest yet? Hotel Purchases → New Purchase. Yellow warning = not enough bought; you can still save.' : '손님 없이 대량 구매는 호텔 구매 → 새 구매. 노란 경고 = 구매량 부족, 저장 가능.',
      to: 'ledger',
      page: en ? 'Guest Ledger' : '예약 관리부',
    },
    {
      Icon: Wallet,
      color: 'bg-ok',
      soft: 'bg-ok-soft text-ok hover:bg-ok hover:text-white',
      title: en ? 'Collect & pay' : '수금 · 지급',
      do: en
        ? [['Guest pays', 'Billing → Add payment'], ['Pay Hilton', 'Dashboard → Pay Hotel Bill'], ['Other money', 'Fund → Cash in / Cash out']]
        : [['손님 결제', '청구서 → 결제 추가'], ['힐튼 지급', '대시보드 → 호텔 청구 지급'], ['기타', '자금 → 입금 / 출금']],
      result: en ? 'Guest money in, Hilton money out of the Fund' : '손님 돈 입금, 힐튼 지급 출금',
      tip: en ? 'Pick Cash or Bank exactly as paid, so Cash on hand stays right.' : '현금/은행을 실제대로 선택해야 현금 보유가 맞습니다.',
      to: 'fund',
      page: en ? 'Fund' : '자금',
    },
    {
      Icon: CheckCircle2,
      color: 'bg-violet',
      soft: 'bg-violet-soft text-violet hover:bg-violet hover:text-white',
      title: en ? 'Close the month' : '월 마감',
      do: en
        ? [['Check every day', 'Daily Settlement: Hotel / Junket rate vs Hilton report'], ['Pick the month', 'on the Dashboard'], ['Pay the balance', 'then Print statement / Excel']]
        : [['매일 확인', '일일 정산: 호텔/정킷 요금 vs 힐튼 보고서'], ['월 선택', '대시보드에서'], ['잔액 지급', '정산서 인쇄 / 엑셀']],
      result: en ? 'Balance due ₱0 → Settled' : '잔액 ₱0 → 정산 완료',
      tip: en ? 'The Hilton bill is the purchases dated that month.' : '힐튼 청구액 = 그 달 구매일의 구매액.',
      to: 'dashboard',
      page: en ? 'Dashboard' : '대시보드',
    },
  ];

  return (
    <div>
      <PageHeader title={en ? 'System Workflow' : '시스템 워크플로'} lede={en ? 'Buy from Hilton, sell to guests, keep the difference' : '힐튼에서 사고, 손님에게 팔고, 차액을 남깁니다'} />

      {/* ---------------- the deal, one strip ---------------- */}
      <div className="card p-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.3fr_auto_1.3fr_1fr] items-center gap-3">
          <Party Icon={Building2} className="bg-accent-soft border-accent-line text-accent" title="Hilton Hotel" sub={en ? 'sells wholesale' : '도매 판매'} />
          <Lanes
            out={{ label: en ? 'Rooms & vouchers' : '객실·바우처', tag: '₱4,500', color: '#3567d6' }}
            back={{ label: en ? 'Payment to hotel' : '호텔 지급', tag: en ? 'Fund out' : '출금', color: '#2e7a57' }}
          />
          {/* Jupiter = the logo (its black background blends with the box) */}
          {/* same height as the Hilton / Guest cards (66px) */}
          <div className="h-[66px] rounded-2xl bg-black px-3 flex flex-col items-center justify-center overflow-hidden shadow-[0_10px_30px_-14px_rgb(0_0_0/0.6)]">
            <img src={jupiterLogo} alt="Jupiter" className="h-[50px] w-auto object-contain -mt-1" />
            {/* the logo image has black padding — pull the word up under the wordmark */}
            <span className="-mt-[13px] text-[8.5px] font-semibold tracking-[0.45em] pl-[0.45em] text-[#e9c46a]">JUNKET</span>
          </div>
          <Lanes
            out={{ label: en ? 'Booking / vouchers' : '예약·바우처', tag: '₱6,050', color: '#c0662b' }}
            back={{ label: en ? 'Guest payment' : '손님 결제', tag: en ? 'Fund in' : '입금', color: '#2e7a57' }}
          />
          <Party Icon={Users} className="bg-warn-soft border-warn-line text-warn" title={en ? 'Guest' : '손님'} sub={en ? 'pays retail' : '소매가 지불'} />
        </div>
      </div>

      {/* ---------------- 4 steps (booking + Hilton purchase = 1 step, 2 columns wide) ---------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
        {steps.map((s, i) => (
          <div key={s.title} className={`card relative overflow-hidden p-4 flex flex-col ${s.sides ? 'sm:col-span-2' : ''}`}>
            {/* big step number in the corner */}
            <span className="absolute -right-1 -top-4 num text-[84px] font-bold text-ink/[0.04] select-none pointer-events-none">{i + 1}</span>
            <div className="flex items-center gap-3">
              <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${tint(s)}`}>
                <s.Icon className="w-[18px] h-[18px]" />
              </span>
              <div className="leading-tight">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                  {en ? 'Step' : '단계'} {i + 1}
                </div>
                <div className="font-semibold text-ink text-[14.5px]">{s.title}</div>
              </div>
            </div>

            {(() => {
              const Item = ({ n, action, detail, dot }: { n: number; action: string; detail: string; dot: string }) => (
                <li className="flex items-start gap-2.5">
                  <span className={`w-5 h-5 rounded-full text-[10.5px] font-bold grid place-items-center shrink-0 mt-px ${dot}`}>{n}</span>
                  <div className="leading-tight min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{action}</div>
                    <div className="text-[11.5px] text-muted mt-0.5">{detail}</div>
                  </div>
                </li>
              );
              const after = s.do.length + (s.sides ? 1 : 0);
              return (
                <div className="mt-4 space-y-2 flex-1">
                  <ol className="space-y-2">
                    {s.do.map(([action, detail], n) => (
                      <Item key={action} n={n + 1} action={action} detail={detail} dot={tint(s)} />
                    ))}
                  </ol>
                  {s.sides && (
                    <div className="grid grid-cols-2 gap-2">
                      {s.sides.map((side) => (
                        <div key={side.label} className={`rounded-lg border ${side.tone.split(' ').filter((c) => c.startsWith('border')).join(' ')} overflow-hidden`}>
                          <div className={`px-3 py-1.5 flex items-baseline gap-2 ${side.tone}`}>
                            <span className="text-[11px] font-bold uppercase tracking-wider">
                              {s.do.length + 1} · {side.label}
                            </span>
                            <span className="text-[11px] opacity-75 truncate">{side.sub}</span>
                          </div>
                          <ul className="p-2.5 space-y-2">
                            {side.do.map(([action, detail]) => (
                              <li key={action} className="leading-tight">
                                <div className="text-[13px] font-semibold text-ink">{action}</div>
                                <div className="text-[11.5px] text-muted mt-0.5">{detail}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                  {s.then && (
                    <ol className="space-y-2">
                      {s.then.map(([action, detail], n) => (
                        <Item key={action} n={after + n + 1} action={action} detail={detail} dot={tint(s)} />
                      ))}
                    </ol>
                  )}
                </div>
              );
            })()}

            <div className="mt-4 flex items-start gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[12px] text-ok font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
              {s.result}
            </div>
            <div className="mt-2 flex items-start gap-2 px-1 text-[11.5px] text-muted leading-snug">
              <Lightbulb className="w-3.5 h-3.5 text-warn shrink-0 mt-px" />
              {s.tip}
            </div>

            <button
              onClick={() => setOpenPage(i)}
              className={`mt-3 self-start inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors ${s.soft}`}
            >
              {en ? `Open ${s.page}` : `${s.page} 열기`}
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* ---------------- today's to-do, from the real data (green = nothing to do) ---------------- */}
      {(() => {
        const short = buildStock(purchases, reservations, voucherSales, rates, en).filter((r) => (r.bought || r.used) && r.left <= 0);
        const owing = [
          ...reservations.map((r) => folioOf(r).balance),
          ...voucherSales.map((v) => voucherTotals(v).balance),
        ].filter((b) => b > 0);
        const month = todayISO().slice(0, 7);
        const hotelDue = Math.max(
          purchases.filter((p) => p.date.slice(0, 7) === month).reduce((a, p) => a + purchaseTotal(p), 0) - settlementOf(settlements, month).paid,
          0
        );
        const cards = [
          {
            step: 1,
            ok: short.length === 0,
            title: short.length ? (en ? `${short.length} running out` : `${short.length}개 소진`) : en ? 'Rooms & vouchers OK' : '객실·바우처 충분',
            text: short.length
              ? short
                  .slice(0, 2)
                  .map((r) => `${r.label} ${Math.max(r.left, 0)}`)
                  .join(' · ') + (short.length > 2 ? ' …' : '')
              : purchases.length
              ? en ? 'Everything still available' : '모두 가용'
              : en ? 'Nothing bought from Hilton yet' : '아직 힐튼 구매 없음',
          },
          {
            step: 2,
            ok: owing.length === 0,
            title: owing.length ? (en ? `${owing.length} ${owing.length === 1 ? 'unpaid guest' : 'unpaid guests'}` : `손님 ${owing.length}명 미결제`) : en ? 'All guests paid' : '모든 손님 결제 완료',
            text: owing.length ? `${peso(owing.reduce((a, b) => a + b, 0))} ${en ? 'to collect' : '수금 필요'}` : en ? 'Nothing to collect' : '수금할 금액 없음',
          },
          {
            step: 4,
            ok: hotelDue === 0,
            title: hotelDue
              ? en ? 'Hilton bill open' : '힐튼 미지급'
              : !purchases.some((p) => p.date.slice(0, 7) === month)
              ? en ? 'No Hilton bill yet' : '힐튼 청구 없음'
              : en ? 'Hilton bill settled' : '힐튼 정산 완료',
            text: hotelDue
              ? `${peso(hotelDue)} ${en ? 'due' : '미지급'} · ${formatMonth(month)}`
              : !purchases.some((p) => p.date.slice(0, 7) === month)
              ? `${formatMonth(month)} · ${en ? 'no purchases recorded' : '구매 기록 없음'}`
              : formatMonth(month),
          },
        ];
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {cards.map((c) => (
              <button
                key={c.step}
                onClick={() => setOpenPage(c.step)}
                className={`card px-4 py-3 flex gap-3 items-center text-left cursor-pointer transition-colors ${c.ok ? 'hover:bg-ok-soft/50' : '!bg-bad-soft !border-bad-line hover:brightness-[0.98]'}`}
              >
                <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 text-white ${c.ok ? 'bg-ok' : 'bg-bad'}`}>
                  {c.ok ? <CheckCircle2 className="w-[18px] h-[18px]" /> : <AlertTriangle className="w-[18px] h-[18px]" />}
                </span>
                <div className="leading-tight min-w-0 flex-1">
                  <div className={`font-semibold text-[13px] ${c.ok ? 'text-ink' : 'text-bad'}`}>{c.title}</div>
                  <div className="text-[12px] text-muted mt-0.5 truncate">{c.text}</div>
                </div>
                {!c.ok && <span className="text-[11.5px] font-semibold text-bad whitespace-nowrap">{en ? 'Fix →' : '처리 →'}</span>}
              </button>
            ))}
          </div>
        );
      })()}

      {/* the step's page itself, in a pop-up — staff stay on the workflow */}
      {openPage !== null && (
        <Dialog
          title={
            <span className="flex items-center gap-2.5">
              <span className={`w-8 h-8 rounded-xl grid place-items-center ${tint(steps[openPage])}`}>
                {React.createElement(steps[openPage].Icon, { className: 'w-4 h-4' })}
              </span>
              {steps[openPage].page}
            </span>
          }
          subtitle={`${en ? 'Step' : '단계'} ${openPage + 1} · ${steps[openPage].title}`}
          onClose={() => setOpenPage(null)}
          width="max-w-none"
        >
          {/* full width of the screen and the rest of its height, so the page fits like it does in the main area */}
          <div className="h-[calc(97vh-100px)] overflow-x-hidden overflow-y-auto bg-canvas">
            <div className="min-h-full flex flex-col px-4 pt-1 pb-4">{renderModule(steps[openPage].to)}</div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

const Party: React.FC<{ Icon: React.ElementType; className: string; title: string; sub: string }> = ({ Icon, className, title, sub }) => (
  <div className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${className}`}>
    {/* soft tint: the colour comes from the text colour in className */}
    <span className="w-10 h-10 rounded-xl bg-surface/80 grid place-items-center shrink-0">
      <Icon className="w-5 h-5" />
    </span>
    <div className="leading-tight">
      <div className="font-semibold text-[14.5px]">{title}</div>
      <div className="text-[11.5px] text-muted">{sub}</div>
    </div>
  </div>
);

type Lane = { label: string; tag: string; color: string };

/** Two moving arrows: goods go right (→), money comes back left (←). */
const Lanes: React.FC<{ out: Lane; back: Lane }> = ({ out, back }) => (
  <div className="flex flex-col gap-2">
    <LaneRow lane={out} dir="right" />
    <LaneRow lane={back} dir="left" />
  </div>
);

const LaneRow: React.FC<{ lane: Lane; dir: 'left' | 'right' }> = ({ lane, dir }) => (
  <div>
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11.5px] font-semibold" style={{ color: lane.color }}>
        {lane.label}
      </span>
      <span className="num text-[10.5px] px-1.5 rounded font-semibold" style={{ color: lane.color, background: `${lane.color}14` }}>
        {lane.tag}
      </span>
    </div>
    <svg viewBox="0 0 200 10" preserveAspectRatio="none" className="w-full h-2.5 mt-0.5" aria-hidden="true">
      <line x1={dir === 'right' ? 2 : 12} y1="5" x2={dir === 'right' ? 188 : 198} y2="5" stroke={lane.color} strokeWidth="2.5" className={`flow-dash ${dir === 'left' ? 'reverse' : ''}`} vectorEffect="non-scaling-stroke" />
      <path d={dir === 'right' ? 'M188 0 L199 5 L188 10 Z' : 'M12 0 L1 5 L12 10 Z'} fill={lane.color} />
    </svg>
  </div>
);
