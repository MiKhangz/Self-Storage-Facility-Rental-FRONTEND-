import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accessCodesApi, handoversApi, contractsApi, reservationsApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd, todayIso } from '../../customer/components/format.js';
import { PageHeader, Stat, Status } from '../components/ui.jsx';
import { useContracts, useInvoices, useReservations, useUnits } from '../queries.js';
import { esc, printDocument } from '../print.js';
import { useT } from '../../i18n/I18n.jsx';

/** Checked at the desk before anyone walks to the unit. */
const CHECKS = [
    { key: 'identity', title: 'Verify identity', text: 'Citizen ID (CCCD) matches the renter name' },
    { key: 'payment', title: 'Verify payment', text: 'The deposit is paid (handover is refused until it is)' },
];

/** Staff walk the customer to the unit. They like it, want another of the same size, or call the booking off. */
function ViewUnit({ reservation, viewed, onViewed }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const [picking, setPicking] = useState(false);
    const [unitId, setUnitId] = useState('');
    const others = (useUnits({ facilityId: reservation.facilityId, unitTypeId: reservation.unitTypeId, status: 'Available' }).data ?? [])
        .filter((u) => u.storageUnitId !== reservation.storageUnitId);
    const refresh = () => ['reservations', 'contracts', 'storage-units'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    const swap = useMutation({
        mutationFn: () => reservationsApi.changeUnit(reservation.reservationId, { storageUnitId: Number(unitId) }),
        onSuccess: () => { setPicking(false); setUnitId(''); refresh(); },
    });
    const cancel = useMutation({
        mutationFn: () => reservationsApi.cancel(reservation.reservationId, { reason: 'Customer did not take a unit at the handover' }),
        onSuccess: refresh,
    });
    const error = swap.error ?? cancel.error;

    return (
        <li className={viewed ? 'done' : ''}>
            <span><strong>{tr('Show the customer unit {code}', { code: reservation.unitCode })}</strong>
                <small>{viewed ? tr('The customer likes the unit.') : tr('Walk them to the unit. Sign nothing until they are happy with it.')}</small></span>
            {!viewed && !picking && (
                <div className="sa-form-actions">
                    <button type="button" className="se-btn se-btn-ghost se-btn-sm" disabled={cancel.isPending}
                        onClick={() => window.confirm(tr('Cancel this booking? The unit is freed and the full deposit is owed back to the customer.')) && cancel.mutate()}>
                        {tr('Cancel booking')}
                    </button>
                    <button type="button" className="se-btn se-btn-ghost se-btn-sm" onClick={() => setPicking(true)}>{tr('Show another unit')}</button>
                    <button type="button" className="se-btn se-btn-primary se-btn-sm" onClick={onViewed}>{tr('Customer likes it')}</button>
                </div>
            )}
            {picking && (
                <div className="sa-inline-form">
                    <label><span className="se-label">{tr('Another free {size} unit', { size: reservation.unitTypeName })}</span>
                        <div className="se-input"><select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                            <option value="">{others.length ? tr('Choose a unit') : tr('No other free unit of this size')}</option>
                            {others.map((u) => <option key={u.storageUnitId} value={u.storageUnitId}>{u.unitCode}{u.floorName ? ` · ${u.floorName}` : ''}{u.zone ? ` · ${tr('zone')} ${u.zone}` : ''}</option>)}
                        </select></div></label>
                    <p className="se-hint">{tr('If the contract was already signed, it must be signed again for the new unit.')}</p>
                    <div className="sa-form-actions">
                        <button type="button" className="se-btn se-btn-ghost se-btn-sm" onClick={() => setPicking(false)}>{tr('Back')}</button>
                        <button type="button" className="se-btn se-btn-primary se-btn-sm" disabled={!unitId || swap.isPending} onClick={() => swap.mutate()}>
                            {swap.isPending ? tr('Switching…') : tr('Switch to this unit')}
                        </button>
                    </div>
                </div>
            )}
            {error && <div className="se-alert" role="alert">{errorMessage(error)}</div>}
        </li>
    );
}

const dateTime = (iso) => iso && new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The paper contract the customer signs at the desk: who, which unit, for how long, at what price. */
function contractHtml(reservation, contract, customer) {
    const row = (label, value) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;
    return `<h1>HỢP ĐỒNG THUÊ KHO</h1><p class="sub">Số ${esc(contract.contractNumber)} · StorEase ${esc(reservation.facilityName)}</p>
        <h2>1. Bên thuê</h2><table>${row('Họ và tên', contract.customerName)}${row('Số điện thoại', customer?.customerPhone)}${row('Số CCCD', customer?.citizenId)}</table>
        <h2>2. Kho thuê</h2><table>${row('Cơ sở', reservation.facilityName)}${row('Mã kho', contract.unitCode)}${row('Loại kho', reservation.unitTypeName)}</table>
        <h2>3. Thời hạn và giá thuê</h2><table>
            ${row('Ngày bắt đầu', formatDate(contract.startDate))}${row('Ngày kết thúc', formatDate(contract.endDate))}
            ${row('Thời hạn', `${reservation.rentalMonths} tháng`)}${row('Tiền thuê mỗi tháng', formatVnd(contract.monthlyRent))}
            ${row('Tiền cọc', formatVnd(contract.depositAmount))}${row('Hạn đóng tiền thuê', `Ngày ${contract.paymentDay} hằng tháng`)}</table>
        <h2>4. Điều khoản chính</h2><ol>
            <li>Hóa đơn tiền thuê được gửi trước hạn đóng; trễ hạn có thể bị tính phí trễ hạn và tạm khóa quyền ra vào theo chính sách giá đang áp dụng cho hợp đồng.</li>
            <li>Mỗi lần ra vào cơ sở, bên thuê đọc mã ra vào cho nhân viên. Mã đổi sau mỗi lần ra về và luôn xem được trong tài khoản.</li>
            <li>Khi trả kho, bên thuê có tối đa 15 ngày kể từ ngày yêu cầu để dọn kho; sau hạn này quyền ra vào bị khóa.</li>
            <li>Tiền cọc được hoàn sau khi kiểm tra kho lúc trả, trừ chi phí hư hỏng, hóa đơn còn nợ và phí trả kho trước hạn (nếu có).</li>
        </ol>
        <div class="sign"><div><p>BÊN THUÊ</p>${esc(contract.customerName)}</div><div><p>ĐẠI DIỆN STOREASE</p>&nbsp;</div></div>`;
}

const METHOD_VI = { Cash: 'Tiền mặt', BankTransfer: 'Chuyển khoản', Gateway: 'Thanh toán online', Card: 'Thẻ' };

/** The bill for the deposit: what was paid, when and how. */
function receiptHtml(reservation, deposit) {
    const paid = (deposit.payments ?? []).filter((p) => p.status === 'Succeeded');
    const lines = paid.map((p) => `<tr><td>${esc(dateTime(p.paidAt) ?? '—')}</td><td>${esc(formatVnd(p.amount))} · ${esc(METHOD_VI[p.method] ?? p.method)}${p.referenceNo ? ` · ${esc(p.referenceNo)}` : ''}</td></tr>`).join('');
    return `<h1>BIÊN LAI TIỀN CỌC</h1><p class="sub">Số ${esc(deposit.invoiceNumber)} · StorEase ${esc(reservation.facilityName)}</p>
        <table><tr><td>Khách hàng</td><td>${esc(reservation.customerName)}</td></tr><tr><td>Đơn đặt kho</td><td>${esc(reservation.reservationCode)}</td></tr>
            <tr><td>Kho</td><td>${esc(reservation.unitCode)} · ${esc(reservation.unitTypeName)}</td></tr>
            <tr><td>Số tiền cọc</td><td>${esc(formatVnd(deposit.totalAmount))}</td></tr>
            <tr><td>Đã thanh toán</td><td class="total">${esc(formatVnd(deposit.paidAmount))}</td></tr>
            <tr><td>Trạng thái</td><td>${deposit.status === 'Paid' ? 'Đã thanh toán đủ' : 'Chưa thanh toán đủ'}</td></tr></table>
        ${lines ? `<h2>Các lần thanh toán</h2><table>${lines}</table>` : ''}
        <p>Tiền cọc được hoàn lại khi trả kho, sau khi kiểm tra tình trạng kho.</p>
        <div class="sign"><div><p>KHÁCH HÀNG</p>${esc(reservation.customerName)}</div><div><p>NHÂN VIÊN THU</p>&nbsp;</div></div>`;
}

/** The contract is drafted once the customer likes the unit, then signed on paper in front of staff. */
function SignContract({ reservation, contract, locked }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const [paymentDay, setPaymentDay] = useState(Math.min(Number(reservation.moveInDate.slice(8, 10)), 28));
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['contracts'] });
    const draft = useMutation({ mutationFn: () => contractsApi.create({ reservationId: reservation.reservationId, paymentDay }), onSuccess: refresh });
    const sign = useMutation({ mutationFn: () => contractsApi.signAtDesk(contract.contractId), onSuccess: refresh });
    const error = draft.error ?? sign.error;
    // Phone and citizen ID for the paper contract; the deposit invoice is the bill the customer takes home.
    const customer = useQuery({ queryKey: ['reservations', reservation.reservationId, 'handover'], queryFn: () => reservationsApi.handover(reservation.reservationId), enabled: !!contract }).data;
    const deposit = (useInvoices().data ?? []).find((i) => i.reservationId === reservation.reservationId && !i.contractId);
    const [blocked, setBlocked] = useState(false);
    const print = (title, html) => setBlocked(!printDocument(title, html));

    return (
        <li className={contract?.signedAt ? 'done' : ''}>
            <span><strong>{tr('Customer signs the contract')}</strong>
                <small>{locked ? tr('After the customer has seen and accepted the unit.')
                    : contract?.signedAt ? tr('{number} signed {date}', { number: contract.contractNumber, date: formatDate(contract.signedAt) })
                    : contract ? tr('Go through the terms below with the customer, print {number} and let them sign the paper copy.', { number: contract.contractNumber })
                    : tr('Draft the contract for this unit, then print it for signing.')}</small></span>
            {!locked && !contract && (
                <div className="sa-inline-form">
                    <label><span className="se-label">{tr("Rent due on day of month (1–28)")}</span>
                        <div className="se-input"><input type="number" min={1} max={28} value={paymentDay} onChange={(e) => setPaymentDay(Number(e.target.value))} /></div></label>
                    <button type="button" className="se-btn se-btn-ghost se-btn-sm" disabled={draft.isPending || !(paymentDay >= 1 && paymentDay <= 28)} onClick={() => draft.mutate()}>
                        {draft.isPending ? tr('Drafting…') : tr('Draft contract')}
                    </button>
                </div>
            )}
            {!locked && contract && (
                <div className="sa-contract-summary">
                    <dl className="se-kv">
                        <div><dt>{tr('Unit')}</dt><dd>{contract.unitCode} · {reservation.unitTypeName}</dd></div>
                        <div><dt>{tr('Term')}</dt><dd>{formatDate(contract.startDate)} → {formatDate(contract.endDate)} ({tr('{n} month{n:s}', { n: reservation.rentalMonths })})</dd></div>
                        <div><dt>{tr('Monthly rent')}</dt><dd>{formatVnd(contract.monthlyRent)}</dd></div>
                        <div><dt>{tr('Deposit')}</dt><dd>{formatVnd(contract.depositAmount)}</dd></div>
                        <div><dt>{tr('Rent due')}</dt><dd>{tr('Day {day} of each month', { day: contract.paymentDay })}</dd></div>
                        <div><dt>{tr('Deposit bill')}</dt><dd>{deposit ? `${deposit.invoiceNumber} · ${deposit.status === 'Paid' ? tr('paid') : tr('not paid')} ${formatVnd(deposit.paidAmount)}` : tr('No deposit was due')}</dd></div>
                    </dl>
                    <div className="sa-form-actions">
                        <button type="button" className="se-btn se-btn-ghost se-btn-sm" onClick={() => print(contract.contractNumber, contractHtml(reservation, contract, customer))}>
                            <Icon name="file" size={14} /> {tr('Print contract')}</button>
                        {deposit && <button type="button" className="se-btn se-btn-ghost se-btn-sm" onClick={() => print(deposit.invoiceNumber, receiptHtml(reservation, deposit))}>
                            <Icon name="card" size={14} /> {tr('Print deposit receipt')}</button>}
                        {!contract.signedAt && (
                            <button type="button" className="se-btn se-btn-primary se-btn-sm" disabled={sign.isPending}
                                onClick={() => window.confirm(tr('Confirm the customer signed the paper contract in front of you?')) && sign.mutate()}>
                                {tr('Customer signed on paper')}
                            </button>
                        )}
                    </div>
                    {blocked && <div className="se-alert" role="alert">{tr('The browser blocked the print window. Allow pop-ups for this site and press Print again.')}</div>}
                </div>
            )}
            {error && <div className="se-alert" role="alert">{errorMessage(error)}</div>}
        </li>
    );
}

function HandoverWizard({ reservation, contract, onCompleted }) {
    const tr = useT();
    const [ticks, setTicks] = useState({});
    // Seeing the unit is a conversation, not a record: it lives here, and switching units resets it.
    const [viewedUnit, setViewedUnit] = useState(null);
    const viewed = viewedUnit === reservation.storageUnitId;
    // Each unit's disc lock is named after the unit, so staff confirm they gave that one; a unit switch resets it.
    const [lockFor, setLockFor] = useState(null);
    const lockGiven = lockFor === reservation.storageUnitId;
    const [form, setForm] = useState({ conditionNote: '' });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const handover = useMutation({
        mutationFn: () => handoversApi.create({ reservationId: reservation.reservationId, contractId: contract.contractId, lockSerial: reservation.unitCode, ...form }),
        onSuccess: onCompleted,
    });

    const checked = CHECKS.every((c) => ticks[c.key]);
    const signed = !!contract?.signedAt;
    const ready = checked && viewed && signed && lockGiven;
    return (
        <div className="se-panel">
            <div className="sa-card-title">
                <h2>{tr('Handover')} · {reservation.customerName} → {tr('Kho')} {reservation.unitCode}</h2>
                <span className="sa-muted">{reservation.reservationCode}{contract ? ` · ${contract.contractNumber}` : ''}</span>
            </div>
            <ol className="sa-steps">
                {CHECKS.map((c) => (
                    <li key={c.key} className={ticks[c.key] ? 'done' : ''}>
                        <label className="se-check"><input type="checkbox" checked={!!ticks[c.key]} onChange={(e) => setTicks({ ...ticks, [c.key]: e.target.checked })} />
                            <span><strong>{tr(c.title)}</strong><small>{tr(c.text)}</small></span></label>
                    </li>
                ))}
                <ViewUnit reservation={reservation} viewed={viewed} onViewed={() => setViewedUnit(reservation.storageUnitId)} />
                <SignContract reservation={reservation} contract={contract} locked={!viewed} />
                <li>
                    <span><strong>{tr('Hand over the disc lock and keys')}</strong><small>{tr('Give the customer the lock named after their unit')}</small></span>
                    <div>
                        <div><span className="se-label">{tr('Lock name')}</span>
                            <div className="sa-lock-row">
                                <div className={`sa-lock ${lockGiven ? 'given' : ''}`}><Icon name="key" size={16} /> {reservation.unitCode}</div>
                                {lockGiven
                                    ? <button type="button" className="se-btn se-btn-ghost" onClick={() => setLockFor(null)}>{tr('Undo')}</button>
                                    : <button type="button" className="se-btn se-btn-primary" onClick={() => setLockFor(reservation.storageUnitId)}>{tr('Confirm lock given')}</button>}
                            </div>
                            {lockGiven && <small className="sa-muted">{tr('Lock {code} given to the customer.', { code: reservation.unitCode })}</small>}
                        </div>
                    </div>
                    <label><span className="se-label">{tr("Condition note (optional, shown again at the return inspection)")}</span><textarea className="se-textarea" rows={2} maxLength={300} value={form.conditionNote} onChange={(e) => set({ conditionNote: e.target.value })} /></label>
                </li>
            </ol>
            {handover.isError && <div className="se-alert" role="alert">{errorMessage(handover.error)}</div>}
            <div className="sa-form-actions">
                <span className="sa-muted">{tr('Completing activates the contract, occupies the unit and issues the access code.')}</span>
                <button type="button" className="se-btn se-btn-primary" disabled={!ready || handover.isPending} onClick={() => handover.mutate()}>
                    {handover.isPending ? tr('Completing…') : tr('Complete handover')}
                </button>
            </div>
        </div>
    );
}

function HandoverDesk() {
    const tr = useT();
    const today = todayIso();
    const reservations = useReservations({ status: 'Confirmed' });
    const drafts = useContracts({ status: 'Draft' });
    const [selected, setSelected] = useState(null);
    // Held here, not in the wizard: the lists refresh on their own and drop the handed-over booking from the queue,
    // which would otherwise close this screen before staff read the code out.
    const [done, setDone] = useState(null);
    const queryClient = useQueryClient();
    // A Confirmed booking without a unit (its handover was undone) is assigned on Reservations first.
    const queue = [...(reservations.data ?? [])].filter((r) => r.storageUnitId).sort((a, b) => a.moveInDate.localeCompare(b.moveInDate));
    const current = queue.find((r) => r.reservationId === selected) ?? queue[0];
    const contract = current && (drafts.data ?? []).find((c) => c.reservationId === current.reservationId);

    return (
        <div className="sa-split open sa-desk">
            <section className="se-panel">
                <div className="sa-card-title"><h2>{tr('Waiting for handover')}</h2><span className="se-count">{queue.length}</span></div>
                <div className="sa-queue">
                    {queue.map((r) => (
                        <button key={r.reservationId} type="button" className={`sa-queue-item${current?.reservationId === r.reservationId ? ' active' : ''}`} onClick={() => setSelected(r.reservationId)}>
                            <span><strong>{r.customerName}</strong><small>{r.unitCode} · {r.unitTypeName}</small></span>
                            <span className={`se-badge ${r.moveInDate <= today ? 'low' : ''}`}>{r.moveInDate <= today ? tr('Due') : formatDate(r.moveInDate)}</span>
                        </button>
                    ))}
                    {!queue.length && <p className="sa-muted">{reservations.isLoading ? tr('Loading…') : tr('No confirmed reservations waiting.')}</p>}
                </div>
            </section>
            <div>
                {done ? (
                    <div className="se-panel sa-checkin-done">
                        <span className="se-confirm-icon"><Icon name="check" size={28} /></span>
                        <h2>{tr('Handover complete — unit {code} is now occupied', { code: done.unitCode })}</h2>
                        <p className="sa-muted">{tr('Give the customer this access code. They are now checked in. The code changes each time they leave; they find the current one in their account.')}</p>
                        <div className="se-code-digits dark">{(done.accessCode ?? '').split('').map((d, i) => <span key={i}>{d}</span>)}</div>
                        <button type="button" className="se-btn se-btn-primary" onClick={() => {
                            ['reservations', 'contracts', 'storage-units', 'check-ins'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
                            setDone(null);
                            setSelected(null);
                        }}>{tr('Next handover')}</button>
                    </div>
                ) : current && !drafts.isLoading && <HandoverWizard key={current.reservationId} reservation={current} contract={contract} onCompleted={setDone} />}
            </div>
        </div>
    );
}

/** SR-02: undo a handover made by mistake. The reservation goes back to waiting for a unit. */
function CancelHandover({ contractId }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const handovers = useQuery({ queryKey: ['handovers', 'Completed'], queryFn: () => handoversApi.list({ status: 'Completed', page: 1, pageSize: 100 }) });
    const handover = handovers.data?.items?.find((c) => c.contractId === contractId);
    const cancel = useMutation({
        mutationFn: () => handoversApi.cancel(handover.handoverId),
        onSuccess: () => ['handovers', 'contracts', 'reservations', 'storage-units'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    });
    if (!handover) return null;
    return (
        <>
            {cancel.isError && <div className="se-alert" role="alert">{errorMessage(cancel.error)}</div>}
            <button type="button" className="se-btn se-btn-ghost" disabled={cancel.isPending}
                onClick={() => window.confirm(tr('Cancel this handover? The contract is terminated, the code revoked and the unit freed; the reservation waits for a unit again.')) && cancel.mutate()}>
                {tr('Cancel handover')}
            </button>
        </>
    );
}

/** TH-06: a lost card or leaked code. The customer gets a new code from their unit page. */
function RevokeCode({ contractId, accessCodeId }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const revoke = useMutation({
        mutationFn: () => accessCodesApi.revoke(accessCodeId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contracts', contractId, 'access-code'] }),
    });
    const confirmAndRevoke = () => {
        if (window.confirm(tr('Revoke this access code? The customer cannot open the unit until they request a new code.'))) revoke.mutate();
    };
    return (
        <>
            {revoke.isError && <div className="se-alert" role="alert">{errorMessage(revoke.error)}</div>}
            <button type="button" className="se-btn se-btn-ghost" disabled={revoke.isPending} onClick={confirmAndRevoke}>
                <Icon name="key" size={16} /> {revoke.isPending ? tr('Revoking…') : tr('Revoke code')}
            </button>
        </>
    );
}

function ActiveRentals() {
    const tr = useT();
    const contracts = useContracts({ status: 'Active' });
    const invoices = useInvoices();
    const [selected, setSelected] = useState(null);
    const list = contracts.data ?? [];
    const current = list.find((c) => c.contractId === selected) ?? list[0];
    const code = useQuery({
        queryKey: ['contracts', current?.contractId, 'access-code'],
        queryFn: () => contractsApi.accessCode(current.contractId),
        enabled: !!current,
    });
    const owing = current && (invoices.data ?? []).filter((i) => i.contractId === current.contractId && ['Issued', 'Overdue'].includes(i.status));
    const overdue = owing?.some((i) => i.status === 'Overdue');
    const eligible = current && !overdue && code.data?.isActive;

    return (
        <div className="sa-split open sa-desk">
            <section className="se-panel">
                <div className="sa-card-title"><h2>{tr('Active rentals')}</h2><span className="se-count">{list.length}</span></div>
                <div className="sa-queue">
                    {list.map((c) => (
                        <button key={c.contractId} type="button" className={`sa-queue-item${current?.contractId === c.contractId ? ' active' : ''}`} onClick={() => setSelected(c.contractId)}>
                            <span><strong>{c.customerName}</strong><small>{tr('Kho')} {c.unitCode} · {tr('to {date}', { date: formatDate(c.endDate) })}</small></span>
                            <Status value={c.status} />
                        </button>
                    ))}
                    {!list.length && <p className="sa-muted">{contracts.isLoading ? tr('Loading…') : tr('No active rentals.')}</p>}
                </div>
            </section>
            {current && (
                <section className="se-panel">
                    <div className="sa-card-title"><h2>{current.customerName} → Unit {current.unitCode}</h2><span className="sa-muted">{current.contractNumber}</span></div>
                    <dl className="se-kv">
                        <div><dt>{tr('Contract status')}</dt><dd><Status value={current.status} /></dd></div>
                        <div><dt>{tr('Payment status')}</dt><dd>{owing?.length ? `${tr('{n} open invoice{n:s}', { n: owing.length })}${overdue ? tr(' · overdue') : ''}` : tr('Paid up')}</dd></div>
                        <div><dt>{tr('Access code')}</dt><dd>{code.data?.isActive ? tr('Active · expires {date}', { date: formatDate(code.data.expiresAt) }) : tr('No active code')}</dd></div>
                    </dl>
                    <div className={`sa-eligibility ${eligible ? 'ok' : 'no'}`}>
                        <small>{tr('Access eligibility')}</small>
                        <strong>{eligible ? tr('Eligible for access') : tr('Not eligible — check payment or access code')}</strong>
                    </div>
                    {code.data?.isActive && <RevokeCode key={code.data.accessCodeId} contractId={current.contractId} accessCodeId={code.data.accessCodeId} />}
                    <CancelHandover key={current.contractId} contractId={current.contractId} />
                </section>
            )}
        </div>
    );
}

/** A06: the on-site desk — hand over newly booked units, and see who may access their unit. */
export default function HandoverPage() {
    const tr = useT();
    const [tab, setTab] = useState('desk');
    const units = useUnits();
    const reservations = useReservations({ status: 'Confirmed' });
    const active = useContracts({ status: 'Active' });
    const all = units.data ?? [];

    return (
        <>
            <PageHeader title={tr('Handover')} subtitle={tr('Today, {date}', { date: formatDate(todayIso()) })} />
            <div className="sa-stats">
                <Stat icon="key" label="Waiting for handover" value={reservations.data?.length ?? 0} />
                <Stat icon="file" label="Active rentals" value={active.data?.length ?? 0} />
                <Stat icon="grid" label="Available units" value={all.filter((u) => u.status === 'Available').length} />
                <Stat icon="shield" tone="warn" label="In maintenance" value={all.filter((u) => u.status === 'Maintenance').length} />
            </div>
            <div className="se-tabs se-tabs-line" role="tablist">
                <button role="tab" aria-selected={tab === 'desk'} className={tab === 'desk' ? 'active' : ''} onClick={() => setTab('desk')}>{tr('Handover desk')}</button>
                <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>{tr('Active rentals & access')}</button>
            </div>
            {tab === 'desk' ? <HandoverDesk /> : <ActiveRentals />}
        </>
    );
}
