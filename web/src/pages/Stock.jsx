import { useEffect, useState } from 'react';
import { api, ugx } from '../api.js';

export default function Stock({ session }) {
  const { user, branch } = session;
  const canEdit = user.role !== 'attendant';
  const [items, setItems] = useState([]);
  const [low, setLow] = useState([]);
  const [branches, setBranches] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { mode, item }

  const load = async () => {
    try {
      const [p, l, b] = await Promise.all([api('/products'), api('/stock/low'), api('/branches')]);
      setItems(p);
      setLow(l);
      setBranches(b);
      if (canEdit) setTransfers(await api('/transfers'));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const shown = items.filter((v) =>
    [v.name, v.sku, v.size, v.colour, v.category].join(' ').toLowerCase().includes(search.toLowerCase())
  );

  const submit = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target));
    setError('');
    try {
      if (dialog.mode === 'receive') {
        await api('/stock/receive', {
          method: 'POST',
          body: {
            supplier: form.supplier,
            items: [{ variant_id: dialog.item.variant_id, qty: Number(form.qty), cost_price: Number(form.cost_price || 0) || undefined }]
          }
        });
        setMsg(`Received ${form.qty} × ${dialog.item.name}`);
      } else if (dialog.mode === 'count') {
        const res = await api('/stock/adjust', {
          method: 'POST',
          body: { variant_id: dialog.item.variant_id, counted: Number(form.counted), reason: form.reason }
        });
        setMsg(`Stock corrected by ${res.difference}`);
      } else if (dialog.mode === 'transfer') {
        await api('/transfers', {
          method: 'POST',
          body: { to_branch: Number(form.to_branch), items: [{ variant_id: dialog.item.variant_id, qty: Number(form.qty) }] }
        });
        setMsg('Transfer sent — the other branch must accept it.');
      }
      setDialog(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const accept = async (id) => {
    try {
      await api(`/transfers/${id}/accept`, { method: 'POST' });
      setMsg('Transfer received into your branch.');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      {low.length > 0 && (
        <div className="card">
          <h3>Low stock at {branch?.name}</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Item</th><th>Size</th><th>Colour</th><th className="right">Left</th></tr>
              </thead>
              <tbody>
                {low.map((r) => (
                  <tr key={r.sku}>
                    <td>{r.name}</td><td>{r.size}</td><td>{r.colour}</td>
                    <td className="right">{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canEdit && transfers.filter((t) => t.status === 'pending').length > 0 && (
        <div className="card">
          <h3>Transfers</h3>
          <table>
            <tbody>
              {transfers.filter((t) => t.status === 'pending').map((t) => (
                <tr key={t.id}>
                  <td>#{t.id} {t.from_name} → {t.to_name} ({t.lines} line{t.lines > 1 ? 's' : ''})</td>
                  <td className="right">
                    {t.to_branch === user.branch_id || user.role === 'owner' ? (
                      <button className="btn small" onClick={() => accept(t.id)}>Accept</button>
                    ) : (
                      <span className="muted small">waiting</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3>Stock at {branch?.name}</h3>
        <input placeholder="Search stock…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="scroll" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Size</th><th>Colour</th><th className="right">Qty</th>
                <th className="right">Price</th>{canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.variant_id}>
                  <td>{v.name}<br /><span className="muted small">{v.sku}</span></td>
                  <td>{v.size}</td>
                  <td>{v.colour}</td>
                  <td className="right" style={{ color: v.quantity <= v.reorder_level ? '#b91c1c' : undefined }}>
                    {v.quantity}
                  </td>
                  <td className="right">{ugx(v.selling_price)}</td>
                  {canEdit && (
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn secondary" onClick={() => setDialog({ mode: 'receive', item: v })}>Receive</button>{' '}
                      <button className="btn secondary" onClick={() => setDialog({ mode: 'count', item: v })}>Count</button>{' '}
                      <button className="btn secondary" onClick={() => setDialog({ mode: 'transfer', item: v })}>Transfer</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dialog && (
        <div className="modal-back" onClick={() => setDialog(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h3 style={{ marginTop: 0 }}>
              {dialog.mode === 'receive' && 'Receive stock'}
              {dialog.mode === 'count' && 'Stock count'}
              {dialog.mode === 'transfer' && 'Transfer to another branch'}
            </h3>
            <p className="small muted">
              {dialog.item.name} · {dialog.item.size} · {dialog.item.colour} · now {dialog.item.quantity}
            </p>

            {dialog.mode === 'receive' && (
              <>
                <div className="field"><label>Quantity received</label><input name="qty" inputMode="numeric" required /></div>
                <div className="field"><label>Cost price each (optional)</label><input name="cost_price" inputMode="numeric" /></div>
                <div className="field"><label>Supplier</label><input name="supplier" /></div>
              </>
            )}
            {dialog.mode === 'count' && (
              <>
                <div className="field"><label>Counted on the shelf</label><input name="counted" inputMode="numeric" required /></div>
                <div className="field"><label>Reason</label><input name="reason" required placeholder="e.g. damaged, miscount" /></div>
              </>
            )}
            {dialog.mode === 'transfer' && (
              <>
                <div className="field">
                  <label>Send to</label>
                  <select name="to_branch" required>
                    {branches.filter((b) => b.id !== user.branch_id).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field"><label>Quantity</label><input name="qty" inputMode="numeric" required /></div>
              </>
            )}

            <div className="row">
              <button className="btn grow">Save</button>
              <button type="button" className="btn secondary grow" onClick={() => setDialog(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
