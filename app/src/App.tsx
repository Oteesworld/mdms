import { useEffect } from 'react';
import { Icon } from './components/Icon';
import { canOpen, homeOf, signOut, useAccount, type Account } from './auth';
import { Login } from './screens/Login';
import { NAV, TITLES, useScreen, type Screen } from './routes';
import { Dashboard } from './screens/Dashboard';
import { NetworkMap } from './screens/NetworkMap';
import { Reports } from './screens/Reports';
import { NetworkHealth } from './screens/NetworkHealth';
import { Register } from './screens/Register';
import { Settings } from './screens/Settings';
import { Portal } from './screens/Portal';
import { Pipeline } from './screens/Pipeline';
import { Vee } from './screens/Vee';
import { Billing } from './screens/Billing';
import { Operations } from './screens/Operations';
import type { TableScreen } from './data/clients';

export function App() {
  const account = useAccount();
  return account ? <Shell account={account} /> : <Login />;
}

function Shell({ account }: { account: Account }) {
  const [screen, go] = useScreen();
  const allowed = canOpen(account.role, screen);
  // Screens outside the role's access (e.g. a pasted link) send the user to their home screen.
  useEffect(() => {
    if (!allowed) go(homeOf(account.role));
  }, [allowed, account.role, go]);
  if (!allowed) return null;
  const [crumb, title] = TITLES[screen];

  return (
    <div className="shell">
      <Sidebar screen={screen} go={go} account={account} />
      <main className="main">
        <header className="topbar">
          <div className="flex1">
            <div className="crumb">{crumb}</div>
            <h1 className="page-title" style={{ margin: 0 }}>{title}</h1>
          </div>
          <label className="search">
            <Icon name="search" size={15} />
            <input placeholder="Search meter, client or token" aria-label="Search meter, client or token" />
          </label>
          <div className="server-state"><span className="dot" style={{ background: 'var(--ok)' }} />Network server online</div>
          <div className="clock">19 Aug 2026, 13:01</div>
        </header>
        <div className="content">
          <ScreenView screen={screen} />
        </div>
      </main>
    </div>
  );
}

function ScreenView({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'dash': return <Dashboard />;
    case 'map': return <NetworkMap />;
    case 'reports': return <Reports />;
    case 'network': return <NetworkHealth />;
    case 'settings': return <Settings />;
    case 'portal': return <Portal />;
    case 'mdm': return <Pipeline />;
    case 'vee': return <Vee />;
    case 'billing': return <Billing />;
    case 'operations': return <Operations />;
    default: return <Register key={screen} screen={screen as TableScreen} />;
  }
}

function Sidebar({ screen, go, account }: { screen: Screen; go: (s: Screen) => void; account: Account }) {
  // Drop screens the role can't open, then any group left without items.
  const items = NAV.filter((n) => 'group' in n || canOpen(account.role, n.screen));
  const nav = items.filter((n, i) => !('group' in n) || (items[i + 1] && !('group' in items[i + 1])));
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/assets/at-mark.png" alt="Amplified Trends" />
        <span className="brand-bar" />
        <div className="brand-word"><span>AMPLIFIED</span><span>IoT</span></div>
      </div>
      <nav className="nav">
        {nav.map((n) =>
          'group' in n ? (
            <div key={n.group} className="nav-group">{n.group}</div>
          ) : (
            <button
              key={n.screen}
              type="button"
              className={`nav-item${screen === n.screen ? ' active' : ''}`}
              aria-current={screen === n.screen ? 'page' : undefined}
              title={n.label}
              onClick={() => go(n.screen)}
            >
              <Icon name={n.screen} />
              <span>{n.label}</span>
              {n.badge && <span className="nav-badge">{n.badge}</span>}
            </button>
          ),
        )}
      </nav>
      <div className="user-foot">
        <div className="avatar">{account.name.split(' ').map((w) => w[0]).join('')}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ellipsis" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>{account.name}</div>
          <div className="ellipsis" style={{ fontSize: 9.5, color: 'var(--muted)' }}>{account.role} · {account.title}</div>
        </div>
        <button type="button" className="sign-out" onClick={signOut} title="Sign out" aria-label="Sign out">
          <Icon name="signOut" size={15} />
        </button>
      </div>
    </aside>
  );
}
