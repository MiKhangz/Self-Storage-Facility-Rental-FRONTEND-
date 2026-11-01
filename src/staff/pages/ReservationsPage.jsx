import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reservationsApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import { useAuth } from '../../features/auth/AuthContext';
import { Roles } from '../../features/auth/roles';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd, rentalEndDate, todayIso } from '../../customer/components/format.js';
import { formatDateTime } from '../../customer/support/support.js';
import { PageHeader, Status, TableState } from '../components/ui.jsx';
import { useReservations, useUnits } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const TABS = [
    { status: 'Pending', label: 'Pending assignment' },
    { status: 'Confirmed', label: 'Confirmed' },
    { status: 'HandedOver', label: 'Handed over' },
    { status: 'Cancelled', label: 'Cancelled' },
    { status: 'Expired', label: 'Expired' },
];

const waitingForUnit = (r) => r.status === 'Pending' || (r.status === 'Confirmed' && !r.storageUnitId);

/** Staff end a booking before handover: cancel (deposit refunded) or, after the move-in date, a no-show (deposit kept). */
function CloseBooking({ reservation }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const [reason, setReason] = useState('');
    const close = useMutation({
        mutationFn: (noShow) => (noShow ? reservationsApi.noShow(reservation.reservationId)
            : reservationsApi.cancel(reservation.reservationId, { reason: reason.trim() || null })),
        // Reservations refresh only on Done: the booking leaves this list, which would unmount the result before it is read.
        onSuccess: () => ['storage-units', 'invoices', 'deposit-refunds'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    });
    const late = reservation.moveInDate < todayIso();
    const paid = reservation.depositStatus === 'Paid' ? reservation.depositAmount : 0;

    if (close.data) {
        const r = close.data;
        return (
            <div className="se-alert info" role="status">
                {r.reservation.status === 'Expired' ? tr('Marked as a no-show.') : tr('Booking cancelled.')}{' '}
                {r.depositPaid > 0 && (r.depositRefundable
                    ? tr('The {amount} deposit is owed back; it now waits in Deposit Refunds.', { amount: formatVnd(r.depositPaid) })
                    : tr('The {amount} deposit is kept.', { amount: formatVnd(r.depositPaid) }))}
                <button type="button" className="se-btn se-btn-ghost se-btn-sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['reservations'] })}>{tr('Done')}</button>
            </div>
        );
    }
    return (
        <>
            <span className="se-label">{tr('End this booking')}</span>
            <label><span className="se-label">{tr("Reason (optional)")}</span>
                <div className="se-input"><input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></div></label>
            {close.isError && <div className="se-alert" role="alert">{errorMessage(close.error)}</div>}
            <div className="sa-form-actions">
                <button type="button" className="se-btn se-btn-ghost" disabled={close.isPending}
                    onClick={() => window.confirm(`${tr('Cancel {code}?', { code: reservation.reservationCode })}${paid ? ` ${tr('The {amount} deposit will be owed back.', { amount: formatVnd(paid) })}` : ''}`) && close.mutate(false)}>
                    {tr('Cancel booking')}</button>
                {late && (
                    <button type="button" className="se-btn se-btn-ghost" disabled={close.isPending}
                        onClick={() => window.confirm(`${tr('Mark {code} as a no-show?', { code: reservation.reservationCode })}${paid ? ` ${tr('The {amount} deposit is kept.', { amount: formatVnd(paid) })}` : ''}`) && close.mutate(true)}>
                        {tr('Mark no-show')}</button>
                )}
            </div>
            {!late && <p className="se-hint">No-show is possible once the move-in date ({formatDate(reservation.moveInDate)}) has passed.</p>}
        </>
    );
}

function AssignPanel({ reservation, onClose }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const units = useUnits({ facilityId: reservation.facilityId, status: 'Available' });
    const candidates = (units.data ?? []).filter((u) => u.unitTypeId === reservation.unitTypeId);
    const [unitId, setUnitId] = useState(null);
    const chosen = unitId ?? candidates[0]?.storageUnitId;
    const assign = useMutation({
        mutationFn: () => reservationsApi.assignUnit(reservation.reservationId, { storageUnitId: chosen }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reservations'] });
            queryClient.invalidateQueries({ queryKey: ['storage-units'] });
            onClose();
        },
    });
    // Pending, or Confirmed again after its handover was cancelled (no unit any more).
    const pending = waitingForUnit(reservation);

    return (
        <aside className="se-panel sa-side-panel">
            <div className="sa-card-title">
                <h2>{reservation.reservationCode} <Status value={reservation.status} /></h2>
                <button type="button" className="sa-close" onClick={onClose} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button>
            </div>
            <p className="sa-muted">{tr('Created {time}', { time: formatDateTime(reservation.createdAt) })}</p>
            <dl className="se-kv">
                <div><dt>{tr('Customer')}</dt><dd>{reservation.customerName}</dd></div>
                <div><dt>{tr('Facility')}</dt><dd>{reservation.facilityName}</dd></div>
                <div><dt>{tr('Requested')}</dt><dd>{reservation.unitTypeName}</dd></div>
                <div><dt>{tr('Rental period')}</dt><dd>{formatDate(reservation.moveInDate)} → {formatDate(rentalEndDate(reservation.moveInDate, reservation.rentalMonths))}</dd></div>
                {reservation.unitCode && <div><dt>{tr('Unit')}</dt><dd>{reservation.unitCode}</dd></div>}
            </dl>
            {pending && (
                <>
                    <span className="se-label">{tr('Assign a unit')}</span>
                    <div className="sa-unit-options" role="radiogroup" aria-label={tr('Unit to assign')}>
                        {candidates.map((u, i) => (
                            <label key={u.storageUnitId} className={`sa-unit-option${chosen === u.storageUnitId ? ' active' : ''}`}>
                                <input type="radio" name="unit" aria-label={`Unit ${u.unitCode}`} checked={chosen === u.storageUnitId} onChange={() => setUnitId(u.storageUnitId)} />
                                <span><strong>{u.unitCode}</strong><small>{u.floorName}{u.zone ? ` · ${u.zone}` : ''}</small></span>
                                {i === 0 && <span className="se-badge">{tr('First free')}</span>}
                            </label>
                        ))}
                        {!candidates.length && <p className="sa-muted">{units.isLoading ? tr('Loading units…') : tr('No available unit of this size at this facility.')}</p>}
                    </div>
                    {assign.isError && <div className="se-alert" role="alert">{errorMessage(assign.error)}</div>}
                    <button type="button" className="se-btn se-btn-primary se-btn-block" disabled={!chosen || assign.isPending} onClick={() => assign.mutate()}>
                        <Icon name="check" size={16} /> {assign.isPending ? tr('Assigning…') : tr('Confirm & assign')}
                    </button>
                </>
            )}
            {['Pending', 'Confirmed'].includes(reservation.status) && <CloseBooking reservation={reservation} />}
        </aside>
    );
}

/** A05: online bookings by status; staff assign a free unit to each pending one. */
export default function ReservationsPage() {
    const tr = useT();
    const [tab, setTab] = useState('Pending');
    const [selected, setSelected] = useState(null);
    const reservations = useReservations();
    const all = reservations.data ?? [];
    const shown = all.filter((r) => r.status === tab);
    const current = all.find((r) => r.reservationId === selected);
    // The API lets facility staff and managers assign units; admins only view the queue.
    const canAssign = [Roles.FacilityStaff, Roles.FacilityManager].includes(useAuth().session?.role);

    return (
        <>
            <PageHeader title={tr('Reservations')} subtitle="Review online bookings, assign a suitable unit and schedule handover">
                {canAssign && <Link to="/admin/walk-in" className="se-btn se-btn-primary"><Icon name="box" size={16} /> {tr('New walk-in booking')}</Link>}
            </PageHeader>
            <div className="se-tabs se-tabs-line" role="tablist">
                {TABS.map((t) => (
                    <button key={t.status} role="tab" aria-selected={tab === t.status} className={tab === t.status ? 'active' : ''} onClick={() => { setTab(t.status); setSelected(null); }}>
                        {tr(t.label)} <span className="se-count">{all.filter((r) => r.status === t.status).length}</span>
                    </button>
                ))}
            </div>
            <div className={`sa-split${current ? ' open' : ''}`}>
                <div className="se-card se-table-wrap">
                    <table className="se-table sa-table">
                        <thead><tr><th>{tr('Code')}</th><th>{tr('Customer')}</th><th>{tr('Requested')}</th><th>{tr('Facility')}</th><th>{tr('Move-in')}</th><th>{tr('Period')}</th><th /></tr></thead>
                        <tbody>
                            {shown.map((r) => (
                                <tr key={r.reservationId} className={selected === r.reservationId ? 'active' : ''} onClick={() => setSelected(r.reservationId)}>
                                    <td className="strong">{r.reservationCode}</td>
                                    <td>{r.customerName}</td>
                                    <td>{r.unitTypeName}{r.unitCode ? ` · ${r.unitCode}` : ''}</td>
                                    <td>{r.facilityName}</td>
                                    <td>{formatDate(r.moveInDate)}</td>
                                    <td>{tr('{n} month{n:s}', { n: r.rentalMonths })}</td>
                                    <td>{waitingForUnit(r) && canAssign && <button type="button" className="se-btn se-btn-outline se-btn-sm">{tr('Assign')}</button>}</td>
                                </tr>
                            ))}
                            <TableState query={reservations} rows={shown} cols={7} empty="No reservations in this list." />
                        </tbody>
                    </table>
                </div>
                {current && canAssign && <AssignPanel key={current.reservationId} reservation={current} onClose={() => setSelected(null)} />}
            </div>
        </>
    );
}
