import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoicesApi, paymentsApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import { useAuth } from '../../features/auth/AuthContext';
import { Roles } from '../../features/auth/roles';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd } from '../../customer/components/format.js';
import { Filters, PageHeader, SearchFilter, SelectFilter, Stat, Status, TableState, matches } from '../components/ui.jsx';
import { humanize, useContracts, useInvoices } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const OPEN = ['Issued', 'Overdue'];
const { FacilityStaff: FS, FacilityManager: FM, BusinessOperationsManager: BOM, SystemAdministrator: ADMIN } = Roles;
const refresh = (queryClient) => ['invoices', 'payments', 'overdue-cases'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));

/** TH-02: payment reminders sent for one invoice, and a button to send another (staff, managers, business ops). */
function Reminders({ invoice, role }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const history = useQuery({ queryKey: ['invoices', invoice.invoiceId, 'reminders'], queryFn: () => invoicesApi.getReminders(invoice.invoiceId) });
    const send = useMutation({ mutationFn: () => invoicesApi.postReminders(invoice.invoiceId), onSuccess: () => refresh(queryClient) });
    const list = history.data ?? [];
    return (
        <section>
            <div className="sa-card-title"><h3>{tr('Reminders')}</h3><span className="se-count">{list.length}</span></div>
            <ul className="sa-people">
                {list.map((r) => <li key={r.reminderId}><span>{r.channel} · {r.template}</span> <small className="sa-muted">{r.sentAt ? formatDate(r.sentAt) : '—'} · {r.status}</small></li>)}
                {!list.length && <li className="sa-muted">{history.isLoading ? tr('Loading…') : tr('No reminder sent yet.')}</li>}
            </ul>
            {send.isError && <div className="se-alert" role="alert">{errorMessage(send.error)}</div>}
            {[FS, FM, BOM].includes(role) && OPEN.includes(invoice.status) && (
                <button type="button" className="se-btn se-btn-ghost se-btn-block" disabled={send.isPending} onClick={() => send.mutate()}>
                    <Icon name="chat" size={16} /> {send.isPending ? tr('Sending…') : tr('Send reminder')}</button>
            )}
        </section>
    );
}

/** TH-02, business operations only: a charge (positive) or credit (negative) line on the invoice. */
function Adjust({ invoice }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const adjust = useMutation({
        mutationFn: () => invoicesApi.adjustments(invoice.invoiceId, { description: description.trim(), amount: Number(amount) }),
        onSuccess: () => { refresh(queryClient); setDescription(''); setAmount(''); },
    });
    return (
        <form onSubmit={(e) => { e.preventDefault(); adjust.mutate(); }}>
            <h3>{tr('Adjust invoice')}</h3>
            <label><span className="se-label">{tr('Reason')}</span><div className="se-input"><input maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={tr('e.g. Goodwill credit')} /></div></label>
            <label><span className="se-label">{tr("Amount (₫) — negative gives a credit")}</span><div className="se-input"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div></label>
            {adjust.isError && <div className="se-alert" role="alert">{errorMessage(adjust.error)}</div>}
            <button type="submit" className="se-btn se-btn-ghost se-btn-block" disabled={adjust.isPending || !description.trim() || !Number(amount)}>{adjust.isPending ? tr('Saving…') : tr('Add adjustment')}</button>
        </form>
    );
}

/** TH-02: the invoice's payments; business operations can refund a succeeded one after confirming. */
function Payments({ invoice, canRefund }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const [reason, setReason] = useState('');
    const refund = useMutation({ mutationFn: (paymentId) => paymentsApi.refund(paymentId, { reason: reason.trim() || null }), onSuccess: () => { refresh(queryClient); setReason(''); } });
    const list = invoice.payments ?? [];
    if (!list.length) return null;
    return (
        <section>
            <h3>{tr('Payments')}</h3>
            <ul className="sa-people">
                {list.map((p) => (
                    <li key={p.paymentId}>
                        <span><strong>{formatVnd(p.amount)}</strong> {p.method} · <Status value={p.status} /></span>
                        <small className="sa-muted"> {p.paidAt ? formatDate(p.paidAt) : '—'}{p.referenceNo ? ` · ${p.referenceNo}` : ''}</small>
                        {canRefund && p.status === 'Succeeded' && (
                            <button type="button" className="se-btn se-btn-ghost" disabled={refund.isPending}
                                onClick={() => window.confirm(tr('Refund {amount}? The invoice reopens for that amount.', { amount: formatVnd(p.amount) })) && refund.mutate(p.paymentId)}>{tr('Refund')}</button>
                        )}
                    </li>
                ))}
            </ul>
            {canRefund && list.some((p) => p.status === 'Succeeded') && (
                <label><span className="se-label">{tr("Refund reason (optional)")}</span><div className="se-input"><input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></div></label>
            )}
            {refund.isError && <div className="se-alert" role="alert">{errorMessage(refund.error)}</div>}
        </section>
    );
}

/** A17: record a payment taken at the desk against an open invoice; TH-02 adds reminders, adjustments and refunds. */
export default function RecordPaymentPage() {
    const tr = useT();
    const [params] = useSearchParams();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(Number(params.get('invoiceId')) || null);
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState('');
    const [view, setView] = useState('open');
    const role = useAuth().session?.role;
    // Counter payments are taken by facility staff and managers (the API refuses everyone else).
    const canRecord = [FS, FM].includes(role);
    const invoices = useInvoices();
    const contracts = useContracts();
    const contractOf = Object.fromEntries((contracts.data ?? []).map((c) => [c.contractId, c]));
    const all = invoices.data ?? [];
    const open = all.filter((i) => OPEN.includes(i.status));
    const shown = (view === 'open' ? open : all).filter((i) => matches(search, i.invoiceNumber, contractOf[i.contractId]?.customerName, contractOf[i.contractId]?.unitCode));
    const invoice = all.find((i) => i.invoiceId === selected);
    const value = amount === '' ? invoice?.outstandingAmount : Number(amount);
    const valid = invoice && value > 0 && value <= invoice.outstandingAmount;

    const pay = useMutation({
        mutationFn: () => invoicesApi.paymentsManual(invoice.invoiceId, { amount: value, referenceNo: reference.trim() || null }),
        onSuccess: () => { refresh(queryClient); setAmount(''); setReference(''); },
    });

    return (
        <>
            <PageHeader title={tr('Payments')} subtitle={canRecord ? tr('Enter payments taken at the front desk against an open invoice') : tr('Invoices, reminders, adjustments and refunds')} />
            <div className="sa-stats">
                <Stat icon="card" label="Unpaid invoices" value={open.length} note={formatVnd(open.reduce((s, i) => s + (i.outstandingAmount ?? 0), 0))} />
                <Stat icon="clock" tone="bad" label="Overdue" value={open.filter((i) => i.status === 'Overdue').length} />
                <Stat icon="check" label="Paid invoices" value={all.filter((i) => i.status === 'Paid').length} />
            </div>
            <div className={`sa-split${invoice ? ' open' : ''}`}>
                <div>
                    <Filters>
                        <SearchFilter value={search} onChange={setSearch} placeholder={tr('Search customer, unit or invoice')} />
                        <SelectFilter label="Show" value={view} onChange={setView} all="All invoices" options={[{ value: 'open', label: tr('Unpaid only') }]} />
                    </Filters>
                    <div className="se-card se-table-wrap">
                        <table className="se-table sa-table">
                            <thead><tr><th>{tr('Invoice')}</th><th>{tr('Customer')}</th><th>{tr('Unit')}</th><th>{tr('Due')}</th><th>{tr('Outstanding')}</th><th>{tr('Status')}</th></tr></thead>
                            <tbody>
                                {shown.map((i) => (
                                    <tr key={i.invoiceId} className={selected === i.invoiceId ? 'active' : ''} onClick={() => { setSelected(i.invoiceId); setAmount(''); pay.reset(); }}>
                                        <td className="strong">{i.invoiceNumber}</td>
                                        <td>{contractOf[i.contractId]?.customerName ?? '—'}</td>
                                        <td>{contractOf[i.contractId]?.unitCode ?? '—'}</td>
                                        <td>{formatDate(i.dueDate)}</td>
                                        <td className="price">{formatVnd(i.outstandingAmount)}</td>
                                        <td><Status value={i.status} /></td>
                                    </tr>
                                ))}
                                <TableState query={invoices} rows={shown} cols={6} empty={view === 'open' ? tr('No unpaid invoices.') : tr('No invoices.')} />
                            </tbody>
                        </table>
                    </div>
                </div>
                {invoice && (
                    <aside className="se-panel sa-side-panel">
                        <div className="sa-card-title"><h2>{invoice.invoiceNumber} <Status value={invoice.status} /></h2>
                            <button type="button" className="sa-close" onClick={() => setSelected(null)} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button></div>
                        {contractOf[invoice.contractId] && <p className="sa-muted"><Link to={`/admin/customers/${contractOf[invoice.contractId].customerId}`} className="se-link">{contractOf[invoice.contractId].customerName}</Link> · Unit {contractOf[invoice.contractId].unitCode}</p>}
                        <dl className="se-kv">
                            {invoice.items?.map((it) => <div key={it.invoiceItemId}><dt>{it.description}</dt><dd>{formatVnd(it.lineAmount)}</dd></div>)}
                            <div><dt>{tr('Total')}</dt><dd>{formatVnd(invoice.totalAmount)}</dd></div>
                            <div><dt>{tr('Already paid')}</dt><dd>{formatVnd(invoice.paidAmount)}</dd></div>
                            <div><dt><strong>{tr('Outstanding')}</strong></dt><dd>{formatVnd(invoice.outstandingAmount)}</dd></div>
                        </dl>
                        {canRecord && (OPEN.includes(invoice.status) ? (
                            <form onSubmit={(e) => { e.preventDefault(); if (valid) pay.mutate(); }}>
                                <label><span className="se-label">{tr("Amount received (₫)")}</span>
                                    <div className="se-input"><input type="number" min="1" max={invoice.outstandingAmount} value={amount === '' ? invoice.outstandingAmount : amount} onChange={(e) => setAmount(e.target.value)} required /></div></label>
                                <label><span className="se-label">{tr("Receipt / transfer reference (optional)")}</span>
                                    <div className="se-input"><input maxLength={50} value={reference} onChange={(e) => setReference(e.target.value)} /></div></label>
                                {!valid && <p className="sa-bad">{tr('Enter an amount between 1 and the outstanding balance.')}</p>}
                                {pay.isError && <div className="se-alert" role="alert">{errorMessage(pay.error)}</div>}
                                <button type="submit" className="se-btn se-btn-primary se-btn-block" disabled={!valid || pay.isPending}>{pay.isPending ? tr('Recording…') : tr('Record {amount}', { amount: formatVnd(value) })}</button>
                            </form>
                        ) : <div className="se-alert info">{tr('This invoice is {status}.', { status: tr(humanize(invoice.status)).toLowerCase() })}</div>)}
                        <Payments invoice={invoice} canRefund={role === BOM} />
                        {role === BOM && invoice.status !== 'WrittenOff' && <Adjust invoice={invoice} />}
                        {[FS, FM, BOM, ADMIN].includes(role) && <Reminders invoice={invoice} role={role} />}
                    </aside>
                )}
            </div>
        </>
    );
}
