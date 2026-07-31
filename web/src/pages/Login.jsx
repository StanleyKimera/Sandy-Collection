import { useState } from 'react';
import { api, setToken } from '../api.js';

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('/login', { method: 'POST', body: { username, pin } });
      setToken(data.token);
      onSignedIn({ user: data.user, branch: data.branch });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <h1>SANDY COLLECTION</h1>
        <span className="slogan">CUSTOMER is KING, King never Bargain!</span>

        {error && <div className="banner error">{error}</div>}

        <div className="field">
          <label>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.trim())}
            autoCapitalize="none"
            autoFocus
          />
        </div>
        <div className="field">
          <label>PIN</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            type="password"
            inputMode="numeric"
            maxLength={6}
          />
        </div>
        <button className="btn block" disabled={busy || !username || !pin}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Demo staff — owner/1234, main.manager/1111, main.sales/2222, two.manager/3333,
          two.sales1/4444, two.sales2/5555
        </p>
      </form>
    </div>
  );
}
