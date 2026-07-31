import { useEffect, useMemo, useState } from 'react';
import { api, ugx, queueSale } from '../api.js';

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function Sell({ session, onQueued }) {
  const { branch } = session;
  const [catalogue, setCatalogue] = useState([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState('cash');
  const [paid, setPaid] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [smsReceipt, setSmsReceipt] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api('/products').then(setCatalogue).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? catalogue.filter((v) =>
          [v.name, v.sku, v.size, v.colour, v.category].join(' ').toLowerCase().includes(q)
        )
      : catalogue;
    return list.slice(0, 60);
  }, [catalogue, search]);

  const add = (v) => {
    if (v.quantity <= 0) return;
    setCart((c) => {
      const found = c.find((i) => i.variant_id === v.variant_id);
      if (found) {
        if (found.qty >= v.quantity) return c;
        return c.map((i) => (i.variant_id === v.variant_id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...c, { variant_id: v.variant_id, name: v.name, size: v.size, colour: v.colour, price: v.selling_price, qty: 1, max: v.quantity }];
    });
  };

  const setQty = (variantId, qty) =>
    setCart((c) =>
      c
        .map((i) => (i.variant_id === variantId ? { ...i, qty: Math.min(Math.max(qty, 0), i.max) } : i))
        .filter((i) => i.qty > 0)
    );

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discountValue = branch?.allow_discount ? Math.min(Number(discount || 0), subtotal) : 0;
  const total = subtotal - discountValue;
  const maxDiscount = Math.floor((subtotal * (branch?.max_discount_percent || 0)) / 100);
  const change = payment === 'cash' ? Number(paid || 0) - total : 0;

  const reset = () => {
    setCart([]);
    setPaid('');
    setDiscount('');
    setDiscountReason('');
    setCustomerName('');
    setCustomerPhone('');
    setSmsReceipt(false);
  };

  const complete = async () => {
    setError('');
    setBusy(true);
    const body = {
      client_uid: uid(),
      items: cart.map((i) => ({ variant_id: i.variant_id, qty: i.qty })),
      payment_method: payment,
      amount_paid: payment === 'cash' ? Number(paid || 0) : total,
      discount: discountValue,
      discount_reason: discountValue ? discountReason : undefined,
      customer_name: customerName || undefined,
      customer_phone: customerPhone || undefined,
      sms_receipt: smsReceipt
    };
    try {
      if (!navigator.onLine) throw new Error('offline');
      const res = await api('/sales', { method: 'POST', body });
      setReceipt({ ...res, change: res.change });
      reset();
      load();
    } catch (e) {
      if (e.message === 'offline' || e.message === 'Failed to fetch') {
        queueSale(body);
        onQueued?.();
        setReceipt({
          offline: true,
          total,
          change,
          receipt: `SANDY COLLECTION\n${branch?.name}\n(Offline sale — will sync)\nTOTAL: ${ugx(total)}\nCUSTOMER is KING, King never Bargain!`
        });
        reset();
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sell">
      <section>
        <input
          placeholder="Search by name, size, colour or SKU / scan barcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <div className="grid">
          {results.map((v) => (
            <button
              key={v.variant_id}
              className={`tile ${v.quantity <= 0 ? 'out' : ''}`}
              onClick={() => add(v)}
              disabled={v.quantity <= 0}
            >
              <span className="name">{v.name}</span>
              <span>
                <span className="tag">{v.size}</span>
                <span className="tag">{v.colour}</span>
              </span>
              <span className="price">{ugx(v.selling_price)}</span>
              <span className="qty">{v.quantity > 0 ? `${v.quantity} in stock` : 'Out of stock'}</span>
            </button>
          ))}
          {results.length === 0 && <p className="muted">No items match that search.</p>}
        </div>
      </section>

      <section className="card">
        <h3>Cart</h3>
        {error && <div className="banner error">{error}</div>}
        {cart.length === 0 && <p className="muted small">Tap an item to add it.</p>}
        {cart.map((i) => (
          <div className="cart-line" key={i.variant_id}>
            <span className="name">
              {i.name}
              <br />
              <span className="muted small">
                {i.size} · {i.colour} · {ugx(i.price)}
              </span>
            </span>
            <span className="stepper">
              <button onClick={() => setQty(i.variant_id, i.qty - 1)}>−</button>
              <b>{i.qty}</b>
              <button onClick={() => setQty(i.variant_id, i.qty + 1)} disabled={i.qty >= i.max}>
                +
              </button>
            </span>
            <span style={{ width: 90 }} className="right small">
              {ugx(i.price * i.qty)}
            </span>
          </div>
        ))}

        {cart.length > 0 && (
          <>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <span className="muted">Subtotal</span>
              <span>{ugx(subtotal)}</span>
            </div>

            {branch?.allow_discount ? (
              <>
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Discount (max {branch.max_discount_percent}% = {ugx(maxDiscount)})</label>
                  <input
                    inputMode="numeric"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ''))}
                    placeholder="0"
                  />
                </div>
                {discountValue > 0 && (
                  <div className="field">
                    <label>Reason for discount</label>
                    <input
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      placeholder="e.g. bought three pieces"
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="small muted" style={{ marginTop: 8 }}>
                Discounts are locked at this branch — <i>King never Bargain!</i>
              </p>
            )}

            <div className="total">
              <span>Total</span>
              <span>{ugx(total)}</span>
            </div>

            <div className="field">
              <label>Payment method</label>
              <select value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="card">Card</option>
              </select>
            </div>

            {payment === 'cash' && (
              <div className="field">
                <label>Cash received</label>
                <input
                  inputMode="numeric"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                />
                {Number(paid) > 0 && (
                  <span className="small muted">Change: {ugx(Math.max(change, 0))}</span>
                )}
              </div>
            )}

            <div className="field">
              <label>Customer phone (for SMS receipt)</label>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+256…"
                inputMode="tel"
              />
            </div>
            <label className="row small" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                style={{ width: 18 }}
                checked={smsReceipt}
                onChange={(e) => setSmsReceipt(e.target.checked)}
                disabled={!customerPhone}
              />
              Also send the receipt by SMS
            </label>

            <button
              className="btn gold block"
              onClick={complete}
              disabled={busy || (payment === 'cash' && Number(paid || 0) < total) || (discountValue > 0 && !discountReason)}
            >
              {busy ? 'Saving…' : `Complete sale · ${ugx(total)}`}
            </button>
            <button className="btn secondary block" style={{ marginTop: 8 }} onClick={reset}>
              Clear cart
            </button>
          </>
        )}
      </section>

      {receipt && (
        <div className="modal-back" onClick={() => setReceipt(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {receipt.offline ? 'Saved on this device' : 'Sale completed'}
            </h3>
            {receipt.change > 0 && <div className="banner ok">Change: {ugx(receipt.change)}</div>}
            <pre className="receipt">{receipt.receipt}</pre>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn grow" onClick={() => window.print()}>
                Print receipt
              </button>
              <button className="btn secondary grow" onClick={() => setReceipt(null)}>
                Next customer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
