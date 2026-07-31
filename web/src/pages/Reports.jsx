import { useEffect, useState } from 'react';
import { api, ugx } from '../api.js';

const today = () => new Date().toISOString().slice(0, 10);

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map((r) => headers.map((h) => `"${r[h] ?? ''}"`).join(','))].join('\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports({ session }) {
  const { user } = session;
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState(user.role === 'owner' ? 'all' : String(user.branch_id));
  const [branches, setBranches] = useState([]);
  const [data, setData] = useState(null);
  const [cashup, setCashup] = useState(null);
  const [sales, setSales] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/branches').then(setBranches).catch(() => {});
  }, []);

  const load = async () => {
    setError('');
    try {
      const q = `from=${from}&to=${to}&branch_id=${branchId}`;
      setData(await api(`/reports/summary?${q}`));
      const b = branchId === 'all' ? user.branch_id : branchId;
      setCashup(await api(`/reports/cashup?date=${to}&branch_id=${b}`));
      setSales(await api(`/sales?date=${to}&branch_id=${b}`));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [from, to, branchId]);

  const voidSale = async (id) => {
    const reason = window.prompt('Why is this sale being voided?');
    if (!reason) return;
    try {
      await api(`/sales/${id}/void`, { method: 'POST', body: { reason } });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <div className="row">
          <div className="field grow"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field grow"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {user.role === 'owner' && (
            <div className="field grow">
              <label>Branch</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="all">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="label">Sales</div><div className="value">{data.totals.sales_count}</div></div>
            <div className="stat"><div className="label">Revenue</div><div className="value">{ugx(data.totals.revenue)}</div></div>
            <div className="stat"><div className="label">Discounts given</div><div className="value">{ugx(data.totals.discounts)}</div></div>
            {data.profit && (
              <div className="stat"><div className="label">Gross profit</div><div className="value">{ugx(data.profit.gross_profit)}</div></div>
            )}
          </div>

          <div className="card">
            <h3>Cash-up for {cashup?.date}</h3>
            <table>
              <tbody>
                {cashup?.rows.map((r) => (
                  <tr key={r.payment_method}>
                    <td>{r.payment_method.replace('_', ' ')}</td>
                    <td className="right">{r.count}</td>
                    <td className="right">{ugx(r.amount)}</td>
                  </tr>
                ))}
                <tr><td><b>Cash expected in drawer</b></td><td /><td className="right"><b>{ugx(cashup?.expected_cash)}</b></td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Best sellers</h3>
            <div className="scroll">
              <table>
                <thead><tr><th>Item</th><th>Size</th><th>Colour</th><th className="right">Sold</th><th className="right">Value</th></tr></thead>
                <tbody>
                  {data.topItems.map((r, i) => (
                    <tr key={i}><td>{r.name}</td><td>{r.size}</td><td>{r.colour}</td><td className="right">{r.qty}</td><td className="right">{ugx(r.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => download(`best-sellers-${from}_${to}.csv`, toCsv(data.topItems))}>
              Export CSV
            </button>
          </div>

          <div className="card">
            <h3>By branch</h3>
            <table>
              <tbody>
                {data.byBranch.map((r) => (
                  <tr key={r.branch}><td>{r.branch}</td><td className="right">{r.count} sales</td><td className="right">{ugx(r.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>By staff</h3>
            <table>
              <tbody>
                {data.byStaff.map((r) => (
                  <tr key={r.staff}><td>{r.staff}</td><td className="right">{r.count} sales</td><td className="right">{ugx(r.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Sales on {to}</h3>
            <div className="scroll">
              <table>
                <thead><tr><th>#</th><th>Time</th><th>Staff</th><th>Pay</th><th className="right">Total</th><th /></tr></thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id} style={{ opacity: s.status === 'voided' ? 0.5 : 1 }}>
                      <td>{s.id}</td>
                      <td>{s.created_at.slice(11, 16)}</td>
                      <td>{s.seller}</td>
                      <td>{s.payment_method.replace('_', ' ')}</td>
                      <td className="right">{ugx(s.total)}</td>
                      <td className="right">
                        {user.role !== 'attendant' && s.status === 'completed' && (
                          <button className="btn secondary" onClick={() => voidSale(s.id)}>Void</button>
                        )}
                        {s.status === 'voided' && <span className="small muted">voided</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => download(`sales-${to}.csv`, toCsv(sales))}>
              Export CSV
            </button>
          </div>
        </>
      )}
    </>
  );
}
