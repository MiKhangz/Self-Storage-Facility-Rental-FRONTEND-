import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { overdueCasesApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import { useAuth } from '../../features/auth/AuthContext';
import { Roles } from '../../features/auth/roles';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd } from '../../customer/components/format.js';
import { Filters, PageHeader, SearchFilter, SelectFilter, Stat, Status, TableState, matches } from '../components/ui.jsx';
import { fetchAll, humanize } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const STAGES = ['Reminder', 'LateFee', 'Suspended', 'ClearOut'];

/** TH-01: unpaid rent past its due date — Reminder → LateFee → Suspended → ClearOut. Paying in full closes a case. */
export default function OverdueCasesPage() {
    const tr = useT();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [stage, setStage] = useState('');
    const [openOnly, setOpenOnly] = useState(true);
    const [selected, setSelected] = useState(null);
    // Facility managers and business operations may lock out or restore; others only read (the API enforces it).
    const canAct = [Roles.FacilityManager, Roles.BusinessOperationsManager].includes(useAuth().session?.role);
    const cases = useQuery({
        queryKey: ['overdue-cases', { stage, openOnly }],
        queryFn: () => fetchAll(overdueCasesApi.list, { stage: stage || undefined, openOnly }),
    });
    const all = cases.data ?? [];
    const shown = all.filter((c) => matches(search, c.customerName, c.contractNumber, c.unitCode, c.invoiceNumber));
    const current = all.find((c) => c.overdueCaseId === selected);

    const act = useMutation({
        mutationFn: (action) => overdueCasesApi[action](current.overdueCaseId),
        onSuccess: () => ['overdue-cases', 'contracts'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    });
    const open = current && !current.resolvedAt;
    const canLockOut = open && ['Reminder', 'LateFee'].includes(current.stage);
    const canRestore = open && ['Suspended', 'ClearOut'].includes(current.stage);
    const run = (action, question) => { if (window.confirm(tr(question))) act.mutate(action); };

    return (
        <>
            <PageHeader title={tr('Overdue cases')} subtitle="Rent past its due date, from the first reminder to clear-out" />
            <div className="sa-stats">
                <Stat icon="clock" label="Open cases" value={all.filter((c) => !c.resolvedAt).length} />
                <Stat icon="card" tone="bad" label="Outstanding" value={formatVnd(all.reduce((s, c) => s + (c.outstanding ?? 0), 0))} />
                <Stat icon="shield" tone="warn" label="Locked out" value={all.filter((c) => c.stage === 'Suspended' || c.stage === 'ClearOut').length} />
            </div>
            <Filters>
                <SearchFilter value={search} onChange={setSearch} placeholder={tr('Search customer, contract, unit or invoice')} />
                <SelectFilter label="Stage" value={stage} onChange={setStage} all="All stages" options={STAGES.map((s) => ({ value: s, label: humanize(s) }))} />
                <label className="se-check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /><span>{tr('Open cases only')}</span></label>
            </Filters>
            <div className={`sa-split${current ? ' open' : ''}`}>
                <div className="se-card se-table-wrap">
                    <table className="se-table sa-table">
                        <thead><tr><th>{tr('Customer')}</th><th>{tr('Unit')}</th><th>{tr('Invoice')}</th><th>{tr('Outstanding')}</th><th>{tr('Days overdue')}</th><th>{tr('Late fee')}</th><th>{tr('Stage')}</th></tr></thead>
                        <tbody>
                            {shown.map((c) => (
                                <tr key={c.overdueCaseId} className={selected === c.overdueCaseId ? 'active' : ''} onClick={() => { setSelected(c.overdueCaseId); act.reset(); }}>
                                    <td className="strong">{c.customerName}<div className="sa-muted">{c.contractNumber}</div></td>
                                    <td>{c.unitCode}</td>
                                    <td>{c.invoiceNumber ?? '—'}</td>
                                    <td className="price">{formatVnd(c.outstanding ?? 0)}</td>
                                    <td>{c.daysOverdue}</td>
                                    <td>{formatVnd(c.lateFeeAmount)}</td>
                                    <td><Status value={c.resolvedAt ? 'Resolved' : c.stage} /></td>
                                </tr>
                            ))}
                            <TableState query={cases} rows={shown} cols={7} empty="No overdue cases." />
                        </tbody>
                    </table>
                </div>
                {current && (
                    <aside className="se-panel sa-side-panel">
                        <div className="sa-card-title"><h2>{current.customerName}</h2>
                            <button type="button" className="sa-close" onClick={() => setSelected(null)} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button></div>
                        <p className="sa-muted"><Link to={`/admin/customers/${current.customerId}`} className="se-link">{tr('Customer profile')}</Link> · Unit {current.unitCode} · {current.contractNumber}</p>
                        <dl className="se-kv">
                            <div><dt>{tr('Stage')}</dt><dd><Status value={current.resolvedAt ? 'Resolved' : current.stage} /></dd></div>
                            <div><dt>{tr('Overdue since')}</dt><dd>{formatDate(current.overdueSince)} · {tr('{n} days', { n: current.daysOverdue })}</dd></div>
                            <div><dt>{tr('Invoice')}</dt><dd>{current.invoiceId ? <Link to={`/admin/payments?invoiceId=${current.invoiceId}`} className="se-link">{current.invoiceNumber}</Link> : '—'}</dd></div>
                            <div><dt>{tr('Outstanding')}</dt><dd>{formatVnd(current.outstanding ?? 0)}</dd></div>
                            <div><dt>{tr('Late fee')}</dt><dd>{formatVnd(current.lateFeeAmount)}</dd></div>
                            <div><dt>{tr('Access suspended')}</dt><dd>{current.accessSuspendedAt ? formatDate(current.accessSuspendedAt) : tr('No')}</dd></div>
                            {current.resolvedAt && <div><dt>{tr('Resolved')}</dt><dd>{formatDate(current.resolvedAt)}</dd></div>}
                        </dl>
                        {open && <p className="se-hint">{tr('Paying the invoice in full closes the case and gives access back automatically.')}</p>}
                        {act.isError && <div className="se-alert" role="alert">{errorMessage(act.error)}</div>}
                        {canAct && canLockOut && (
                            <button type="button" className="se-btn se-btn-primary se-btn-block" disabled={act.isPending}
                                onClick={() => run('lockout', 'Lock this customer out? Their access code stops working until they pay or access is restored.')}>
                                <Icon name="shield" size={16} /> {act.isPending ? tr('Locking out…') : tr('Lock out')}
                            </button>
                        )}
                        {canAct && canRestore && (
                            <button type="button" className="se-btn se-btn-ghost se-btn-block" disabled={act.isPending}
                                onClick={() => run('restoreAccess', 'Restore access? The case stays open at the late-fee stage and the daily job will not lock them out again.')}>
                                <Icon name="key" size={16} /> {act.isPending ? tr('Restoring…') : tr('Restore access')}
                            </button>
                        )}
                    </aside>
                )}
            </div>
        </>
    );
}
