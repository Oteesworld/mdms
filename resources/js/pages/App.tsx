import { Head, Link, usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Toaster, toast } from '../components/overlay';
import { GlobalSearch } from '../components/Search';
import { setCurrentHandle, signOut, useAuth, type Account, type SharedProps } from '../auth';
import { NAV, TITLES, screenUrl, useScreen, type Screen } from '../routes';
import { Dashboard } from '../screens/Dashboard';
import { NetworkMap } from '../screens/NetworkMap';
import { Reports } from '../screens/Reports';
import { NetworkHealth } from '../screens/NetworkHealth';
import { Register, profileIndex } from '../screens/Register';
import { Settings } from '../screens/Settings';
import { Portal } from '../screens/Portal';
import { Pipeline } from '../screens/Pipeline';
import { Vee } from '../screens/Vee';
import { Vending } from '../screens/Vending';
import { Operations } from '../screens/Operations';
import { AccountScreen } from '../screens/Account';
import type { TableScreen } from '../data/clients';

/** The signed-in app: Laravel serves it at /{screen} once it has checked the role may open that screen. */
export default function App() {
  const { user } = useAuth();
  const [screen, go, param] = useScreen();
  const { flash } = usePage<SharedProps>().props;
  const menu = useMenu();
  setCurrentHandle(user!.handle);
  useEffect(() => {
    if (flash.toast) toast(flash.toast);
  }, [flash]);

  const [crumb, baseTitle] = TITLES[screen];
  const title = profileIndex(screen, param) !== null ? 'Client profile' : baseTitle;

  return (
    <div className="shell">
      <Head title={title} />
      <Sidebar screen={screen} account={user!} menu={menu} />
      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="hamburger"
            onClick={menu.toggle}
            aria-label={menu.docked ? 'Hide menu' : menu.open ? 'Close menu' : 'Open menu'}
            aria-expanded={menu.docked || menu.open}
            aria-controls="side-menu"
            title={menu.docked ? 'Hide menu' : 'Open menu'}
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="flex1" style={{ minWidth: 0 }}>
            <div className="crumb">{crumb}</div>
            <h1 className="page-title" style={{ margin: 0 }}>{title}</h1>
          </div>
          <GlobalSearch go={go} />
          <div className="server-state"><span className="dot" style={{ background: 'var(--ok)' }} />Network server online</div>
          <div className="clock">19 Aug 2026, 13:01</div>
        </header>
        <div className="content">
          <ScreenView screen={screen} param={param} />
        </div>
      </main>
      <Toaster />
    </div>
  );
}

function ScreenView({ screen, param }: { screen: Screen; param?: string }) {
  switch (screen) {
    case 'dash': return <Dashboard />;
    case 'map': return <NetworkMap />;
    case 'reports': return <Reports />;
    case 'network': return <NetworkHealth />;
    case 'settings': return <Settings />;
    case 'account': return <AccountScreen />;
    case 'portal': return <Portal />;
    case 'mdm': return <Pipeline />;
    case 'vee': return <Vee />;
    case 'vending': return <Vending />;
    case 'operations': return <Operations />;
    default: return <Register key={screen} screen={screen as TableScreen} profile={param} />;
  }
}

const PIN_KEY = 'amplified-iot.navPinned';

function useNarrow(query = '(max-width: 900px)') {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

interface Menu {
  /** Menu is docked beside the content (pinned, on a wide screen). */
  docked: boolean;
  /** Undocked menu is slid in over the page. */
  open: boolean;
  pinned: boolean;
  narrow: boolean;
  toggle: () => void;
  close: () => void;
  setPinned: (v: boolean) => void;
}

/**
 * Hamburger menu state. Pinned (the default) docks the menu; the hamburger hides it,
 * after which it opens as a drawer over the page. The pin choice is kept per browser;
 * narrow screens always use the drawer.
 */
function useMenu(): Menu {
  const narrow = useNarrow();
  const [pinned, setPinnedState] = useState(() => {
    try {
      return localStorage.getItem(PIN_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [open, setOpen] = useState(false);
  const setPinned = (v: boolean) => {
    setPinnedState(v);
    setOpen(false);
    try {
      localStorage.setItem(PIN_KEY, String(v));
    } catch {
      /* storage unavailable: choice lasts for this page only */
    }
  };
  const docked = pinned && !narrow;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return {
    docked, open: open && !docked, pinned, narrow, setPinned,
    toggle: () => (docked ? setPinned(false) : setOpen((o) => !o)),
    close: () => setOpen(false),
  };
}

function Sidebar({ screen, account, menu }: { screen: Screen; account: Account; menu: Menu }) {
  const { canOpen } = useAuth();
  // Drop screens the role can't open, then any group left without items.
  const items = NAV.filter((n) => 'group' in n || canOpen(n.screen));
  const nav = items.filter((n, i) => !('group' in n) || (items[i + 1] && !('group' in items[i + 1])));
  const state = menu.docked ? 'docked' : menu.open ? 'open' : 'hidden';
  return (
    <>
    <div className={`sidebar-slot${menu.docked ? '' : ' hidden'}`} aria-hidden="true" />
    {menu.open && <div className="menu-backdrop" onClick={menu.close} aria-hidden="true" />}
    <aside id="side-menu" className={`sidebar ${state}`}>
      <div className="brand">
        <img className="brand-logo" src="/assets/leeroy-logo.png" alt="Leeroy Systems" />
        {!menu.narrow && (
          <button
            type="button"
            className={`pin-btn${menu.pinned ? ' on' : ''}`}
            onClick={() => menu.setPinned(!menu.pinned)}
            aria-pressed={menu.pinned}
            title={menu.pinned ? 'Unpin: hide menu behind the ☰ button' : 'Pin menu open'}
            aria-label={menu.pinned ? 'Unpin menu' : 'Pin menu open'}
          >
            <Icon name="pin" size={16} />
          </button>
        )}
      </div>
      <nav className="nav">
        {nav.map((n) =>
          'group' in n ? (
            <div key={n.group} className="nav-group">{n.group}</div>
          ) : (
            <Link
              key={n.screen}
              href={screenUrl(n.screen)}
              className={`nav-item${screen === n.screen ? ' active' : ''}`}
              aria-current={screen === n.screen ? 'page' : undefined}
              title={n.label}
              onClick={menu.close}
            >
              <Icon name={n.screen} />
              <span>{n.label}</span>
              {n.badge && <span className="nav-badge">{n.badge}</span>}
            </Link>
          ),
        )}
      </nav>
      <div className="user-foot">
        <div className="avatar">{account.name.split(' ').map((w) => w[0]).join('')}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ellipsis" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>{account.name}</div>
          <div className="ellipsis" style={{ fontSize: 9.5, color: 'var(--muted)' }}>{account.roleLabel}{account.title ? ' · ' + account.title : ''}</div>
        </div>
        <button type="button" className="sign-out" onClick={signOut} title="Sign out" aria-label="Sign out">
          <Icon name="signOut" size={15} />
        </button>
      </div>
    </aside>
    </>
  );
}
