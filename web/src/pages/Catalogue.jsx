import { useEffect, useMemo, useState } from 'react';
import { api, ugx } from '../api.js';

const generateSku = (name, index) => {
  const prefix = String(name || 'ITEM')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  return `${prefix || 'ITEM'}-${String(Date.now()).slice(-4)}-${index}`;
};

export default function Catalogue({ session }) {
  const { user } = session;
  const canEdit = user.role !== 'attendant';
  const isOwner = user.role === 'owner';
  const [items, setItems] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    category: '',
    cost_price: '',
    selling_price: '',
    sizes: '',
    colours: '',
    reorder_level: 3
  });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setError('');
      setItems(await api('/products'));
    } catch (e) {
      setError(e.message);
    }
  };

  const loadDeleted = async () => {
    try {
      setError('');
      setDeleted(await api('/products/deleted'));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? items.filter((v) =>
          [v.name, v.sku, v.size, v.colour, v.category].join(' ').toLowerCase().includes(q)
        )
      : items;
  }, [items, search]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMsg('');

    const name = form.name.trim();
    const category = form.category.trim();
    const sizes = form.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    const colours = form.colours.split(',').map((c) => c.trim()).filter(Boolean);
    const cost_price = Number(form.cost_price);
    const selling_price = Number(form.selling_price);
    const reorder_level = Number(form.reorder_level) || 3;

    if (!name || !category || !sizes.length || !colours.length || !selling_price) {
      return setError('Name, category, sizes, colours and selling price are required.');
    }

    const variants = [];
    let index = 1;
    for (const size of sizes) {
      for (const colour of colours) {
        variants.push({
          sku: generateSku(name, index),
          size,
          colour,
          cost_price: Math.round(cost_price || 0),
          selling_price: Math.round(selling_price),
          reorder_level
        });
        index += 1;
      }
    }

    try {
      setBusy(true);
      await api('/products', { method: 'POST', body: { name, category, variants } });
      setMsg(`Added ${variants.length} new item${variants.length > 1 ? 's' : ''} to the catalogue.`);
      setShowForm(false);
      setForm({ name: '', category: '', cost_price: '', selling_price: '', sizes: '', colours: '', reorder_level: 3 });
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteVariant = async (id, sku) => {
    if (!window.confirm(`Delete variant ${sku}? This cannot be undone except by restore.`)) return;
    try {
      await api(`/variants/${id}`, { method: 'DELETE' });
      setMsg('Variant deleted');
      load();
      if (isOwner) loadDeleted();
    } catch (e) {
      setError(e.message);
    }
  };

  const restoreVariant = async (id) => {
    try {
      await api(`/variants/${id}/restore`, { method: 'PATCH' });
      setMsg('Variant restored');
      load();
      loadDeleted();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3>Catalogue</h3>
          <p className="small muted">Browse all items and stock available at your branch.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            placeholder="Search catalogue…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
          />
          {canEdit && (
            <>
              <button className="btn" onClick={() => setShowForm(true)} type="button">
                Add new product
              </button>
              {isOwner && (
                <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => { loadDeleted(); setShowDeleted((s) => !s); }} type="button">
                  Show deleted items
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Size</th>
                <th>Colour</th>
                <th>Price</th>
                <th>Stock</th>
                {canEdit && <th>Branch</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((item) => (
                  <tr key={`${item.variant_id}-${item.branch_id}`}>
                  <td>
                    <b>{item.name}</b>
                    <div className="muted small">{item.category}</div>
                    <div className="muted small">{item.sku}</div>
                  </td>
                  <td>{item.size}</td>
                  <td>{item.colour}</td>
                  <td>{ugx(item.selling_price)}</td>
                  <td>{item.quantity}</td>
                    {canEdit && <td>{item.branch_id}</td>}
                    {isOwner && (
                      <td className="right">
                        <button className="btn danger small" onClick={() => deleteVariant(item.variant_id, item.sku)}>Delete</button>
                      </td>
                    )}
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td className="muted small" colSpan={canEdit ? 6 : 5}>
                    No catalogue items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h3>Add new product</h3>
            <div className="field">
              <label>Product name</label>
              <input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Category</label>
              <input value={form.category} onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Cost price</label>
              <input
                inputMode="numeric"
                value={form.cost_price}
                onChange={(e) => setForm((c) => ({ ...c, cost_price: e.target.value.replace(/\D/g, '') }))}
              />
            </div>
            <div className="field">
              <label>Selling price</label>
              <input
                inputMode="numeric"
                value={form.selling_price}
                onChange={(e) => setForm((c) => ({ ...c, selling_price: e.target.value.replace(/\D/g, '') }))}
                required
              />
            </div>
            <div className="field">
              <label>Sizes (comma-separated)</label>
              <input value={form.sizes} onChange={(e) => setForm((c) => ({ ...c, sizes: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Colours (comma-separated)</label>
              <input value={form.colours} onChange={(e) => setForm((c) => ({ ...c, colours: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Reorder level</label>
              <input
                inputMode="numeric"
                value={form.reorder_level}
                onChange={(e) => setForm((c) => ({ ...c, reorder_level: Number(e.target.value || 0) }))}
              />
            </div>
            <div className="row">
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Create product'}</button>
              <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {isOwner && showDeleted && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Deleted items (restore)</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Item</th><th>Size</th><th>Colour</th><th>Deleted at</th><th /></tr>
              </thead>
              <tbody>
                {deleted.map((d) => (
                  <tr key={d.variant_id}>
                    <td><b>{d.name}</b><div className="muted small">{d.sku}</div></td>
                    <td>{d.size}</td>
                    <td>{d.colour}</td>
                    <td>{new Date(d.deleted_at).toLocaleString()}</td>
                    <td className="right"><button className="btn" onClick={() => restoreVariant(d.variant_id)}>Restore</button></td>
                  </tr>
                ))}
                {deleted.length === 0 && (
                  <tr><td className="muted small" colSpan={5}>No deleted items.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
