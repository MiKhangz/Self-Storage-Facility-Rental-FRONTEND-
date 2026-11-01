import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../api/axiosClient';
import { contractsApi, pricingPoliciesApi, renewalsApi } from '../../api/generated';
import { useAuth } from '../../features/auth/AuthContext';
import { Roles } from '../../features/auth/roles';
import Icon from '../../customer/components/Icon.jsx';
import { addDays, formatDate, formatVnd, todayIso } from '../../customer/components/format.js';
import { initials } from '../../customer/layout/CustomerLayout.jsx';
import { periodUsed } from '../../customer/account/queries.js';
import { PageHeader, SearchFilter, Filters, Status, TableState, downloadFile, matches } from '../components/ui.jsx';
import { useContracts, useInvoices } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const ENDED = ['Closed', 'Terminated'];
const TABS = [
    { key: 'all', label: 'All contracts', match: () => true },
    { key: 'active', label: 'Active', match: (c) => c.status === 'Active' },
    { key: 'expiring', label: 'Expiring in 14 days', match: (c, today) => c.status === 'Active' && c.endDate >= today && c.endDate <= addDays(today, 14) },
    { key: 'overdue', label: 'Overdue', match: (c, _t, owing) => c.status === 'Overdue' || c.status === 'Suspended' || owing[c.contractId]?.overdue },
    { key: 'ended', label: 'Ended', match: (c) => ENDED.includes(c.status) },
];
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

function ContractPanel({ contract, invoices, onClose }) {
    const tr = useT();
    const { session } = useAuth();
    const queryClient = useQueryClient();
    const today = todayIso();
    const open = invoices.filter((i) => ['Issued', 'Overdue'].includes(i.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const due = open.reduce((s, i) => s + (i.outstandingAmount ?? 0), 0);
    const oldest = open.find((i) => i.status === 'Overdue');
    // Overdue stages come from the active pricing policy (grace → late fee → suspend → clear-out).
    const policies = useQuery({
        queryKey: ['pricing-policies'], queryFn: () => pricingPoliciesApi.list({ page: 1, pageSize: 20 }),
        enabled: session?.role === Roles.BusinessOperationsManager && !!oldest,
    });
    const policy = policies.data?.items?.find((p) => p.status === 'Active');
    const terminate = useMutation({
        mutationFn: () => contractsApi.terminate(contract.contractId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contracts'] }),
    });
    const canTerminate = session?.role === Roles.FacilityManager && !ENDED.includes(contract.status) && contract.status !== 'Draft';

    return (
        <aside className="se-panel sa-side-panel">
            <div className="sa-card-title">
                <h2>{contract.contractNumber} <Status value={contract.status} /></h2>
                <button type="button" className="sa-close" onClick={onClose} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button>
            </div>
            <p className="sa-muted"><Link to={`/admin/customers/${contract.customerId}`} className="se-link">{contract.customerName}</Link> · {tr('Kho')} {contract.unitCode}</p>
            {due > 0 && (
                <div className={`sa-eligibility ${oldest ? 'no' : ''}`}>
                    <small>{tr('Total due')}</small><strong>{formatVnd(due)}</strong>
                    {oldest && <small>{tr('{n} day{n:s} overdue since {date}', { n: daysBetween(oldest.dueDate, today), date: formatDate(oldest.dueDate) })}</small>}
                </div>
            )}
            <dl className="se-kv">
                <div><dt>{tr('Period')}</dt><dd>{formatDate(contract.startDate)} → {formatDate(contract.endDate)}</dd></div>
                <div><dt>{tr('Monthly rent')}</dt><dd>{formatVnd(contract.monthlyRent)}</dd></div>
                <div><dt>{tr('Deposit held')}</dt><dd>{formatVnd(contract.depositAmount)}</dd></div>
                <div><dt>{tr('Payment day')}</dt><dd>{tr('Day {day}', { day: contract.paymentDay })}</dd></div>
                <div><dt>{tr('Signed')}</dt><dd>{contract.signedAt ? formatDate(contract.signedAt) : tr('Not yet')}</dd></div>
            </dl>
            {oldest && policy && (
                <>
                    <span className="se-label">{tr('Overdue timeline (policy v{version})', { version: policy.version })}</span>
                    <ul className="sa-timeline">
                        {[
                            [0, 'Due date passed'],
                            [policy.graceDays, 'Grace period ends · late fee applies'],
                            [policy.suspendAfterDays, 'Access code suspended'],
                            [policy.clearOutAfterDays, 'Unit clear-out & deposit deduction'],
                        ].map(([days, text]) => {
                            const date = addDays(oldest.dueDate, days);
                            return <li key={text} className={date <= today ? 'past' : ''}><b>{formatDate(date)}</b> {tr(text)}</li>;
                        })}
                    </ul>
                </>
            )}
            {terminate.isError && <div className="se-alert" role="alert">{errorMessage(terminate.error)}</div>}
            {!!open.length && <Link to={`/admin/payments?invoiceId=${open[0].invoiceId}`} className="se-btn se-btn-primary se-btn-block"><Icon name="card" size={16} /> {tr('Record payment')}</Link>}
            {canTerminate && (
                <button type="button" className="se-btn se-btn-danger se-btn-block" disabled={terminate.isPending}
                    onClick={() => window.confirm(tr('Terminate contract {number}? This revokes access and cannot be undone.', { number: contract.contractNumber })) && terminate.mutate()}>
                    {tr('Terminate contract')}
                </button>
            )}
        </aside>
    );
}

/** A07: every rental contract — who, which unit, what is owed — with overdue follow-up. */
/** T-01: renewals customers asked for. Facility managers (own facilities) and business operations decide. */
function RenewalRequests() {
    const tr = useT();
    const queryClient = useQueryClient();
    const canDecide = [Roles.FacilityManager, Roles.BusinessOperationsManager].includes(useAuth().session?.role);
    const requested = useQuery({ queryKey: ['renewals', 'Requested'], queryFn: () => renewalsApi.list({ status: 'Requested', page: 1, pageSize: 100 }) });
    const decide = useMutation({
        mutationFn: ({ id, approve }) => (approve ? renewalsApi.approve(id) : renewalsApi.reject(id)),
        onSuccess: () => ['renewals', 'contracts', 'invoices'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    });
    const list = requested.data?.items ?? [];
    if (!list.length) return null;
    return (
        <section className="se-panel" style={{ marginBottom: 20 }}>
            <div className="sa-card-title"><h2>{tr('Renewal requests')}</h2><span className="se-count">{list.length}</span></div>
            {decide.isError && <div className="se-alert" role="alert">{errorMessage(decide.error)}</div>}
            <div className="se-table-wrap">
                <table className="se-table">
                    <thead><tr><th>{tr('Contract')}</th><th>{tr('Unit')}</th><th>{tr('Extend')}</th><th>{tr('End date')}</th><th>{tr('Monthly rent')}</th><th>{tr('Requested')}</th>{canDecide && <th />}</tr></thead>
                    <tbody>
                        {list.map((r) => (
                            <tr key={r.renewalId}>
                                <td className="strong">{r.contractNumber}</td>
                                <td>{r.unitCode}</td>
                                <td>{tr('{n} month{n:s}', { n: r.extendMonths })}</td>
                                <td>{formatDate(r.currentEndDate)} → <strong>{formatDate(r.newEndDate)}</strong></td>
                                <td>{formatVnd(r.currentMonthlyRent)} → <strong>{formatVnd(r.newMonthlyRent)}</strong></td>
                                <td>{formatDate(r.requestedAt)}</td>
                                {canDecide && (
                                    <td className="sa-row-actions">
                                        <button type="button" className="se-btn se-btn-primary se-btn-sm" disabled={decide.isPending}
                                            onClick={() => window.confirm(tr('Approve? {number} runs to {date} at {rent} a month.', { number: r.contractNumber, date: formatDate(r.newEndDate), rent: formatVnd(r.newMonthlyRent) })) && decide.mutate({ id: r.renewalId, approve: true })}>{tr('Approve')}</button>{' '}
                                        <button type="button" className="se-btn se-btn-ghost se-btn-sm" disabled={decide.isPending}
                                            onClick={() => window.confirm(tr('Reject the renewal of {number}?', { number: r.contractNumber })) && decide.mutate({ id: r.renewalId, approve: false })}>{tr('Reject')}</button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default function ContractsPage() {
    const tr = useT();
    const today = todayIso();
    const [tab, setTab] = useState('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [exportError, setExportError] = useState('');
    const contracts = useContracts();
    const invoices = useInvoices();
    const all = contracts.data ?? [];
    const allInvoices = invoices.data ?? [];
    const owing = {};
    for (const i of allInvoices.filter((x) => ['Issued', 'Overdue'].includes(x.status))) {
        const o = (owing[i.contractId] ??= { amount: 0, overdue: false });
        o.amount += i.outstandingAmount ?? 0;
        o.overdue ||= i.status === 'Overdue';
    }
    const tabMatch = TABS.find((t) => t.key === tab).match;
    const shown = all.filter((c) => tabMatch(c, today, owing) && matches(search, c.contractNumber, c.customerName, c.unitCode));
    const current = all.find((c) => c.contractId === selected);

    const exportCsv = () => downloadFile(api, '/api/contracts/export', {}, `contracts-${today}.csv`).catch((e) => setExportError(errorMessage(e)));

    return (
        <>
            <PageHeader title={tr('Customers & contracts')} subtitle="Monitor rental periods, payment status, renewals and overdue cases">
                <button type="button" className="se-btn se-btn-primary" onClick={exportCsv}><Icon name="file" size={16} /> {tr('Export CSV')}</button>
            </PageHeader>
            {exportError && <div className="se-alert" role="alert">{exportError}</div>}
            <RenewalRequests />
            <div className="se-tabs se-tabs-line" role="tablist">
                {TABS.map((t) => (
                    <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                        {tr(t.label)} <span className="se-count">{all.filter((c) => t.match(c, today, owing)).length}</span>
                    </button>
                ))}
            </div>
            <Filters><SearchFilter value={search} onChange={setSearch} placeholder={tr('Search contract, customer or unit')} /></Filters>
            <div className={`sa-split${current ? ' open' : ''}`}>
                <div className="se-card se-table-wrap">
                    <table className="se-table sa-table">
                        <thead><tr><th>{tr('Contract')}</th><th>{tr('Customer')}</th><th>{tr('Unit')}</th><th>{tr('Period')}</th><th>{tr('Balance due')}</th><th>{tr('Status')}</th></tr></thead>
                        <tbody>
                            {shown.map((c) => (
                                <tr key={c.contractId} className={selected === c.contractId ? 'active' : ''} onClick={() => setSelected(c.contractId)}>
                                    <td className="strong">{c.contractNumber}</td>
                                    <td><span className="sa-person"><span className="se-avatar">{initials(c.customerName)}</span>{c.customerName}</span></td>
                                    <td>{c.unitCode}</td>
                                    <td><div className="sa-inline-bar"><div className="se-progress flat"><span style={{ width: `${periodUsed(c.startDate, c.endDate, today)}%` }} /></div></div></td>
                                    <td className={owing[c.contractId]?.overdue ? 'sa-bad price' : 'price'}>{owing[c.contractId] ? formatVnd(owing[c.contractId].amount) : '—'}</td>
                                    <td><Status value={c.status} /></td>
                                </tr>
                            ))}
                            <TableState query={contracts} rows={shown} cols={6} empty="No contracts in this list." />
                        </tbody>
                    </table>
                </div>
                {current && <ContractPanel key={current.contractId} contract={current} invoices={allInvoices.filter((i) => i.contractId === current.contractId)} onClose={() => setSelected(null)} />}
            </div>
        </>
    );
}
