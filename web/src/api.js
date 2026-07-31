const TOKEN_KEY = 'sandy.token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong');
    err.code = data.code;
    throw err;
  }
  return data;
}

export const ugx = (n) => `UGX ${Math.round(n || 0).toLocaleString()}`;

/** Errors that will never succeed on a retry, so the queued sale is dropped. */
const PERMANENT = ['OUT_OF_STOCK', 'DISCOUNT_REFUSED', 'INVALID_SALE', 'FORBIDDEN'];

/** Sales made while offline wait here until the shop network is back. */
const QUEUE_KEY = 'sandy.queue';

export function queueSale(sale) {
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  queue.push(sale);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function queuedSales() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}

export async function flushQueue() {
  const queue = queuedSales();
  if (queue.length === 0) return 0;
  const left = [];
  for (const sale of queue) {
    try {
      await api('/sales', { method: 'POST', body: sale });
    } catch (e) {
      if (!PERMANENT.includes(e.code)) left.push(sale);
    }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(left));
  return queue.length - left.length;
}
