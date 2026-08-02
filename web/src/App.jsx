import { useEffect, useState } from 'react';
import { api, setToken, getToken, flushQueue, queuedSales } from './api.js';
import Login from './pages/Login.jsx';
import Sell from './pages/Sell.jsx';
import Stock from './pages/Stock.jsx';
import Catalogue from './pages/Catalogue.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const SLOGAN = 'CUSTOMER is KING, King never Bargain!';

export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('sell');
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(queuedSales().length);

  useEffect(() => {
    if (!getToken()) return setLoading(false);
    api('/me')
      .then(setSession)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const sync = async () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && getToken()) {
        await flushQueue();
        setPending(queuedSales().length);
      }
    };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const timer = setInterval(sync, 15000);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      clearInterval(timer);
    };
  }, []);

  if (loading) return <div className="login-wrap">Loading…</div>;
  if (!session) return <Login onSignedIn={setSession} />;

  const { user, branch } = session;
  const isAttendant = user.role === 'attendant';

  const signOut = () => {
    setToken(null);
    setSession(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">SANDY COLLECTION</div>
          <div className="slogan">{SLOGAN}</div>
        </div>
        <div className="spacer" />
        <div className="whoami">
          {user.name} · {user.role}
          <br />
          {branch?.name}
        </div>
        <button className="linkbtn" onClick={signOut}>
          Sign out
        </button>
      </header>

      {!online && (
        <div className="banner warn" style={{ margin: 10 }}>
          Offline — sales are being saved on this device{pending ? ` (${pending} waiting)` : ''} and will
          sync automatically.
        </div>
      )}

      <nav className="tabs">
        {[
          ['sell', 'Sell'],
          ['stock', 'Stock'],
          ['catalogue', 'Catalogue'],
          ['reports', 'Reports'],
          ['settings', 'Settings']
        ]
          .filter(([key]) => !(isAttendant && key === 'settings'))
          .map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
      </nav>

      <main className="page">
        {tab === 'sell' && <Sell session={session} onQueued={() => setPending(queuedSales().length)} />}
        {tab === 'stock' && <Stock session={session} />}
        {tab === 'catalogue' && <Catalogue session={session} />}
        {tab === 'reports' && <Reports session={session} />}
        {tab === 'settings' && !isAttendant && <Settings session={session} />}
      </main>
    </div>
  );
}
