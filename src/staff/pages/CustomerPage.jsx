import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd } from '../../customer/components/format.js';
import { initials } from '../../customer/layout/CustomerLayout.jsx';
import { formatDateTime } from '../../customer/support/support.js';
import { PageHeader, Stat, Status, TableState } from '../components/ui.jsx';
import { useContracts, useInvoices, useReservations, useTickets } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const TABS = ['Contracts', 'Reservations', 'Payments', 'Support requests'];

/** On-time share of paid invoices: paid ones whose due date had not passed when last paid. */
export function onTimeShare(invoices) {
    const paid = invoices.filter((i) => i.status === 'Paid');
    if (!paid.length) return null;
    const onTime = paid.filter((i) => (i.payments ?? []).every((p) => !p.paidAt || p.paidAt.slice(0, 10) <= i.dueDate));
    return Math.round((onTime.length / paid.length) * 100);
}

/**
 * A14: one customer, pieced together from their contracts, reservations, invoices and tickets.
 * ponytail: the API has no customer endpoint, so contact details (phone, email, CCCD) cannot be shown yet.
 */
export default function CustomerPage() {
    const tr = useT();
    const customerId = Number(useParams().customerId);
    const [tab, setTab] = useState('Contracts');
    const contracts = (useContracts().data ?? []).filter((c) => c.customerId === customerId);
    const reservations = (useReservations().data ?? []).filter((r) => r.customerId === customerId);
    const invoices = (useInvoices().data ?? []).filter((i) => i.customerId === customerId);
    const ticketsQuery = useTickets();
    const tickets = (ticketsQuery.data ?? []).filter((t) => t.customerId === customerId);
    const name = contracts[0]?.customerName ?? reservations[0]?.customerName ?? tickets[0]?.customerName ?? `${tr('Customer')} #${customerId}`;
    const active = contracts.filter((c) => c.status === 'Active');
    const open = invoices.filter((i) => ['Issued', 'Overdue'].includes(i.status));
    const onTime = onTimeShare(invoices);

    return (
        <>
            <Link to="/admin/contracts" className="se-back"><Icon name="arrowLeft" size={16} /> {tr('Back to customers & contracts')}</Link>
            <PageHeader title={name} subtitle={`${tr('Customer')} #${customerId}`} />
            <div className="sa-stats">
                <Stat icon="box" label="Active units" value={active.length} note={active.map((c) => c.unitCode).join(' · ') || '—'} />
                <Stat icon="card" label="Lifetime paid" value={formatVnd(invoices.reduce((s, i) => s + (i.paidAmount ?? 0), 0))} note={tr('{n} invoice{n:s}', { n: invoices.length })} />
                <Stat icon="clock" tone={open.some((i) => i.status === 'Overdue') ? 'bad' : ''} label="Outstanding" value={formatVnd(open.reduce((s, i) => s + (i.outstandingAmount ?? 0), 0))} note={open[0] ? tr('due {date}', { date: formatDate(open[0].dueDate) }) : tr('nothing due')} />
                <Stat icon="check" label="On-time payments" value={onTime == null ? '—' : `${onTime}%`} />
            </div>
            <div className="sa-person sa-person-lg"><span className="se-avatar">{initials(name)}</span><span><strong>{name}</strong><small>{tr('Contact details are not available from the API yet.')}</small></span></div>
            <div className="se-tabs se-tabs-line" role="tablist">
                {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{tr(t)}</button>)}
            </div>
            <div className="se-card se-table-wrap">
                {tab === 'Contracts' && (
                    <table className="se-table"><thead><tr><th>{tr('Contract')}</th><th>{tr('Unit')}</th><th>{tr('Period')}</th><th>{tr('Monthly')}</th><th>{tr('Status')}</th></tr></thead>
                        <tbody>
                            {contracts.map((c) => <tr key={c.contractId}><td className="strong">{c.contractNumber}</td><td>{c.unitCode}</td><td>{formatDate(c.startDate)} → {formatDate(c.endDate)}</td><td className="price">{formatVnd(c.monthlyRent)}</td><td><Status value={c.status} /></td></tr>)}
                            <TableState rows={contracts} cols={5} empty="No contracts." />
                        </tbody></table>
                )}
                {tab === 'Reservations' && (
                    <table className="se-table"><thead><tr><th>{tr('Code')}</th><th>{tr('Facility')}</th><th>{tr('Size')}</th><th>{tr('Move-in')}</th><th>{tr('Status')}</th></tr></thead>
                        <tbody>
                            {reservations.map((r) => <tr key={r.reservationId}><td className="strong">{r.reservationCode}</td><td>{r.facilityName}</td><td>{r.unitTypeName}</td><td>{formatDate(r.moveInDate)}</td><td><Status value={r.status} /></td></tr>)}
                            <TableState rows={reservations} cols={5} empty="No reservations." />
                        </tbody></table>
                )}
                {tab === 'Payments' && (
                    <table className="se-table"><thead><tr><th>{tr('Invoice')}</th><th>{tr('Issue date')}</th><th>{tr('Due')}</th><th>{tr('Total')}</th><th>{tr('Paid')}</th><th>{tr('Status')}</th></tr></thead>
                        <tbody>
                            {invoices.map((i) => <tr key={i.invoiceId}><td className="strong">{i.invoiceNumber}</td><td>{formatDate(i.issueDate)}</td><td>{formatDate(i.dueDate)}</td><td className="price">{formatVnd(i.totalAmount)}</td><td>{formatVnd(i.paidAmount)}</td><td><Status value={i.status} /></td></tr>)}
                            <TableState rows={invoices} cols={6} empty="No invoices." />
                        </tbody></table>
                )}
                {tab === 'Support requests' && (
                    <table className="se-table"><thead><tr><th>{tr('Ticket')}</th><th>{tr('Subject')}</th><th>{tr('Opened')}</th><th>{tr('Priority')}</th><th>{tr('Status')}</th></tr></thead>
                        <tbody>
                            {tickets.map((t) => <tr key={t.ticketId}><td className="strong"><Link to={`/admin/tickets/${t.ticketId}`}>{t.ticketCode}</Link></td><td>{t.subject}</td><td>{formatDateTime(t.createdAt)}</td><td><Status value={t.priority} /></td><td><Status value={t.status} /></td></tr>)}
                            <TableState query={ticketsQuery} rows={tickets} cols={5} empty="No support requests." />
                        </tbody></table>
                )}
            </div>
        </>
    );
}
