import React, { useMemo, useState } from 'react';
import { BedDouble, Check, Eye, EyeOff, Pencil, Plus, Search, Ticket, UserRound, Users, X } from 'lucide-react';
import { Agent } from '../types/hotel';
import { api } from '../utils/api';
import { formatLongDate } from '../utils/hotelHelpers';
import { Language } from '../i18n/translations';
import { Dialog, PageHeader, Pager, toast } from './ui';

const TONES = ['bg-accent-soft text-accent-strong', 'bg-info-soft text-info', 'bg-ok-soft text-ok', 'bg-warn-soft text-warn', 'bg-canvas text-ink-2'];
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
const tone = (n: string) => TONES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

/**
 * Agents — file maintenance list. New names typed in New Booking (room or vouchers) are added
 * automatically by the server; this page is for adding, renaming and hiding them.
 */
export const AgentsMaintenance: React.FC<{
  agents: Agent[];
  setAgents: (a: Agent[]) => void;
  language: Language;
}> = ({ agents, setAgents, language }) => {
  const en = language === 'en';
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'shown' | 'hidden'>('all');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<Agent[]>, title: string, detail: string, t?: 'bad' | 'info') => {
    setBusy(true);
    try {
      setAgents(await fn());
      toast(title, detail, t);
      return true;
    } catch (e) {
      toast(en ? 'Not saved' : '저장 실패', e instanceof Error ? e.message : String(e), 'bad');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const exists = (n: string, exceptId?: number) => agents.some((a) => a.id !== exceptId && a.name.toLowerCase() === n.trim().toLowerCase());

  const add = async () => {
    const n = newName.trim().replace(/\s+/g, ' ');
    if (!n || exists(n)) return;
    if (await run(() => api.createAgent(n), en ? 'Agent added' : '에이전트 추가됨', n)) {
      setNewName('');
      setAdding(false);
    }
  };
  const rename = async (a: Agent) => {
    const n = editName.trim().replace(/\s+/g, ' ');
    if (!n || n === a.name) return setEditId(null);
    if (exists(n, a.id)) return toast(en ? 'Name already used' : '이미 사용 중인 이름', n, 'bad');
    if (await run(() => api.updateAgent(a.id, { name: n }), en ? 'Agent renamed' : '에이전트 이름 변경됨', `${a.name} → ${n}`)) setEditId(null);
  };
  const toggle = (a: Agent) =>
    run(
      () => api.updateAgent(a.id, { active: !a.active }),
      a.active ? (en ? 'Agent hidden' : '에이전트 숨김') : en ? 'Agent shown' : '에이전트 표시',
      a.name,
      a.active ? 'bad' : undefined
    );

  const totals = useMemo(
    () => ({
      shown: agents.filter((a) => a.active).length,
      bookings: agents.reduce((s, a) => s + a.bookings, 0),
      vouchers: agents.reduce((s, a) => s + (a.vouchers || 0), 0),
    }),
    [agents]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents
      .filter((a) => (show === 'all' ? true : show === 'shown' ? a.active : !a.active))
      .filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [agents, search, show]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const pageRows = rows.slice(cur * size, cur * size + size);

  return (
    <div>
      <PageHeader
        title={en ? 'Agents' : '에이전트'}
        lede={en ? 'Names typed in New Booking are saved here and suggested next time.' : '예약 시 입력한 이름이 자동 저장되어 다음에 추천됩니다.'}
        actions={
          <button onClick={() => setAdding(true)} className="btn btn-primary">
            <Plus className="w-4 h-4" />
            {en ? 'Add agent' : '에이전트 추가'}
          </button>
        }
      />

      {/* summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat Icon={Users} label={en ? 'Agents' : '에이전트'} value={agents.length} tone="text-ink bg-canvas" />
        <Stat Icon={Eye} label={en ? 'Shown in suggestions' : '추천 표시'} value={totals.shown} sub={en ? `${agents.length - totals.shown} hidden` : `숨김 ${agents.length - totals.shown}`} tone="text-ok bg-ok-soft" />
        <Stat Icon={BedDouble} label={en ? 'Room bookings' : '객실 예약'} value={totals.bookings} tone="text-info bg-info-soft" />
        <Stat Icon={Ticket} label={en ? 'Voucher purchases' : '바우처 구매'} value={totals.vouchers} tone="text-warn bg-warn-soft" />
      </div>

      <div className="card overflow-hidden">
        <div className="card-head flex-col md:flex-row md:items-center items-stretch">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder={en ? 'Search agent name…' : '에이전트 이름 검색…'}
              className="input input-sm pl-8 !rounded-full"
            />
          </div>
          <div className="seg">
            {(['all', 'shown', 'hidden'] as const).map((k) => (
              <button
                key={k}
                data-active={show === k}
                onClick={() => {
                  setShow(k);
                  setPage(0);
                }}
              >
                {k === 'all' ? (en ? `All (${agents.length})` : `전체 (${agents.length})`) : k === 'shown' ? (en ? `Shown (${totals.shown})` : `표시 (${totals.shown})`) : en ? `Hidden (${agents.length - totals.shown})` : `숨김 (${agents.length - totals.shown})`}
              </button>
            ))}
          </div>
        </div>

        <table className="dtable">
          <thead>
            <tr>
              <th>{en ? 'Agent' : '에이전트'}</th>
              <th className="c">{en ? 'Room bookings' : '객실 예약'}</th>
              <th className="c">{en ? 'Voucher purchases' : '바우처 구매'}</th>
              <th>{en ? 'Last activity' : '최근 이용'}</th>
              <th className="c">{en ? 'Status' : '상태'}</th>
              <th className="w-[96px]" />
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="!py-14 text-center">
                  <div className="mx-auto w-10 h-10 rounded-full bg-canvas grid place-items-center text-faint mb-2">
                    <UserRound className="w-5 h-5" />
                  </div>
                  <div className="text-muted text-[13px]">
                    {agents.length === 0
                      ? en
                        ? 'No agents yet. Type one in New Booking, or click Add agent.'
                        : '아직 에이전트가 없습니다. 예약에서 입력하거나 추가를 누르세요.'
                      : en
                      ? 'No agents match.'
                      : '일치하는 에이전트가 없습니다.'}
                  </div>
                </td>
              </tr>
            )}
            {pageRows.map((a) => {
              const editing = editId === a.id;
              return (
                <tr key={a.id} className={a.active ? '' : 'opacity-60'}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold ${tone(a.name)}`}>{initials(a.name)}</span>
                      {editing ? (
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') rename(a);
                            if (e.key === 'Escape') setEditId(null);
                          }}
                          className="input input-sm w-full max-w-xs"
                        />
                      ) : (
                        <div className="leading-tight min-w-0">
                          <div className="font-medium text-ink truncate">{a.name}</div>
                          {a.createdAt && <div className="text-[11px] text-muted">{en ? 'Added' : '등록'} {formatLongDate(a.createdAt)}</div>}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="c num">{a.bookings ? <span className="text-ink font-medium">{a.bookings}</span> : <span className="text-faint">0</span>}</td>
                  <td className="c num">{a.vouchers ? <span className="text-ink font-medium">{a.vouchers}</span> : <span className="text-faint">0</span>}</td>
                  <td className="text-ink-2 whitespace-nowrap">{a.lastDate ? formatLongDate(a.lastDate) : <span className="text-faint">—</span>}</td>
                  <td className="c">
                    {a.active ? <span className="badge badge-ok badge-dot">{en ? 'Shown' : '표시'}</span> : <span className="badge badge-neutral">{en ? 'Hidden' : '숨김'}</span>}
                  </td>
                  <td className="r whitespace-nowrap">
                    {editing ? (
                      <>
                        <button onClick={() => rename(a)} disabled={busy} className="icon-btn hover:!text-ok" title={en ? 'Save' : '저장'}>
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditId(null)} className="icon-btn" title={en ? 'Cancel' : '취소'}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditId(a.id);
                            setEditName(a.name);
                          }}
                          className="icon-btn hover:!text-accent"
                          title={en ? 'Rename' : '이름 변경'}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggle(a)} disabled={busy} className="icon-btn" title={a.active ? (en ? 'Hide from suggestions' : '추천에서 숨기기') : en ? 'Show in suggestions' : '추천에 표시'}>
                          {a.active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 0 && (
          <Pager page={cur} pages={pages} total={rows.length} size={size} onPage={setPage} onSize={setSize} en={en} unitLabel={en ? 'agents' : '명'} />
        )}
      </div>

      {adding && (
        <Dialog width="max-w-sm" title={en ? 'Add agent' : '에이전트 추가'} onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="px-6 py-5">
              <label className="field-label">{en ? 'Agent name' : '에이전트 이름'}</label>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} placeholder={en ? 'e.g. Mr. Kim' : '예: 김 실장'} className="input" />
              {newName.trim() && exists(newName) && <div className="text-[11.5px] text-bad mt-1">{en ? 'Already in the list' : '이미 등록되어 있습니다'}</div>}
            </div>
            <div className="px-6 py-4 border-t border-line bg-sunken flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost">
                {en ? 'Cancel' : '취소'}
              </button>
              <button type="submit" disabled={busy || !newName.trim() || exists(newName)} className="btn btn-primary">
                <Plus className="w-4 h-4" />
                {en ? 'Add' : '추가'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
};

const Stat: React.FC<{ Icon: React.ElementType; label: string; value: number; sub?: string; tone: string }> = ({ Icon, label, value, sub, tone }) => (
  <div className="card p-4 flex items-center gap-3">
    <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${tone}`}>
      <Icon className="w-5 h-5" />
    </span>
    <div className="min-w-0">
      <div className="text-[12px] text-muted truncate">{label}</div>
      <div className="num text-[20px] font-semibold text-ink leading-tight">{value.toLocaleString()}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  </div>
);
