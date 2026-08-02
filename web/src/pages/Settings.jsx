import { useEffect, useState } from 'react';
import { api, ugx } from '../api.js';

export default function Settings({ session }) {
  const { user } = session;
  const isOwner = user.role === 'owner';
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [sms, setSms] = useState([]);
  const [history, setHistory] = useState([]);
  const [restoredIds, setRestoredIds] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [valuation, setValuation] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setBranches(await api('/branches'));
      setUsers(await api('/users'));
      setSms(await api('/sms-outbox'));
      setValuation(await api('/reports/stock-valuation'));
      if (isOwner) {
        setHistory(await api('/users/history'));
      }
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const saveBranch = async (b, changes) => {
    try {
      await api(`/branches/${b.id}`, { method: 'PATCH', body: changes });
      setMsg(`${b.name} updated`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const addUser = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target));
    try {
      await api('/users', { method: 'POST', body: { ...form, branch_id: Number(form.branch_id) } });
      e.target.reset();
      setMsg('Staff member added');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const activateUser = async (id, fromHistory = false, restoredUser = null) => {
    try {
      await api(`/users/${id}/activate`, { method: 'PATCH' });
      setMsg('User activated');
      if (fromHistory && restoredUser) {
        setRestoredIds((current) => ({ ...current, [id]: true }));
        setHistory((current) => current.map((u) => (u.id === id ? { ...u, active: 1 } : u)));
        setUsers((current) => {
          if (current.some((u) => u.id === id)) return current;
          return [...current, { ...restoredUser, active: 1 }];
        });
      } else {
        load();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Delete this user? This cannot be undone.')) return;
    try {
      await api(`/users/${id}`, { method: 'DELETE' });
      setMsg('User deleted');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      <div className="card">
        <h3>Branches & discount rules</h3>
        {branches.map((b) => (
          <div key={b.id} className="row" style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
            <div className="grow">
              <b>{b.name}</b>
              <div className="muted small">{b.address} · {b.phone}</div>
              <div className="small">
                {b.allow_discount
                  ? `Discounts allowed up to ${b.max_discount_percent}%`
                  : 'Discounts locked — King never Bargain!'}
              </div>
            </div>
            {isOwner && (
              <div className="row">
                <button className="btn secondary" onClick={() => saveBranch(b, { allow_discount: !b.allow_discount })}>
                  {b.allow_discount ? 'Lock discounts' : 'Allow discounts'}
                </button>
                {b.allow_discount && (
                  <input
                    style={{ width: 90 }}
                    defaultValue={b.max_discount_percent}
                    onBlur={(e) => saveBranch(b, { max_discount_percent: Number(e.target.value) })}
                    inputMode="numeric"
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Staff</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Branch</th>{isOwner && <th>Status</th>}{isOwner && <th>Actions</th>}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td><td>{u.username}</td><td>{u.role}</td>
                  <td>{branches.find((b) => b.id === u.branch_id)?.name ?? '—'}</td>
                  {isOwner && <td>{u.active ? 'Active' : 'Inactive'}</td>}
                  {isOwner && (
                    <td>
                      {!u.active && <button className="btn secondary" onClick={() => activateUser(u.id)}>Reactivate</button>}
                      {u.role !== 'owner' && <button className="btn danger" onClick={() => deleteUser(u.id)}>Delete</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isOwner && (
          <form onSubmit={addUser} style={{ marginTop: 14 }}>
            <h3>Add staff</h3>
            <div className="field"><label>Full name</label><input name="name" required /></div>
            <div className="field"><label>Username</label><input name="username" required autoCapitalize="none" /></div>
            <div className="field"><label>PIN (4–6 digits)</label><input name="pin" required inputMode="numeric" maxLength={6} /></div>
            <div className="field">
              <label>Role</label>
              <select name="role"><option value="attendant">Sales attendant</option><option value="manager">Branch manager</option><option value="owner">Owner</option></select>
            </div>
            <div className="field">
              <label>Branch</label>
              <select name="branch_id">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </div>
            <button className="btn">Add staff</button>
          </form>
        )}
        {isOwner && (
          <div style={{ marginTop: 16 }}>
            <button
              className="btn secondary"
              onClick={() => setShowHistory((current) => !current)}
              type="button"
            >
              {showHistory ? 'Hide deleted user history' : 'Show deleted user history'}
            </button>
          </div>
        )}
      </div>
      {isOwner && showHistory && (
        <div className="card">
          <h3>Deleted user history</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Branch</th>
                  <th>Deleted by</th>
                  <th>Date deleted</th>
                  <th>Restore</th>
                </tr>
              </thead>
              <tbody>
                {history.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.username}</td>
                    <td>{u.role}</td>
                    <td>{u.branch_name ?? '—'}</td>
                    <td>{u.deleted_by_name ?? 'System'}</td>
                    <td>{new Date(u.deleted_at).toLocaleString()}</td>
                    <td>
                      <button
                      className="btn"
                      onClick={() => activateUser(u.id, true, u)}
                      type="button"
                      disabled={Boolean(restoredIds[u.id])}
                    >
                      {restoredIds[u.id] ? 'Restored' : 'Restore'}
                    </button>
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr><td className="muted small" colSpan={7}>No deleted users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {valuation && (
        <div className="card">
          <h3>Stock value at your branch</h3>
          <div className="stats">
            <div className="stat"><div className="label">At cost</div><div className="value">{ugx(valuation.cost_value)}</div></div>
            <div className="stat"><div className="label">At selling price</div><div className="value">{ugx(valuation.retail_value)}</div></div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>SMS receipts queue</h3>
        <p className="small muted">
          Receipts wait here until an SMS provider is connected. Each one is sent to the customer's phone.
        </p>
        <table>
          <tbody>
            {sms.map((s) => (
              <tr key={s.id}><td>{s.phone}</td><td className="small muted">Sale #{s.sale_id}</td><td className="right small">{s.status}</td></tr>
            ))}
            {sms.length === 0 && <tr><td className="muted small">No SMS receipts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
