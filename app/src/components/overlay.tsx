import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

/* ---------- Modal ---------- */

/** Centred dialog with a dimmed backdrop. Closes on Esc and backdrop click; focus moves into it on open. */
export function Modal({ title, onClose, children, footer, width = 460 }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-x)');
    (first ?? box.current)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */

type Tone = 'ok' | 'info' | 'warn' | 'bad';
interface Toast { id: number; text: string; tone: Tone }

let toasts: Toast[] = [];
let seq = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Show a short confirmation message in the corner. */
export function toast(text: string, tone: Tone = 'ok') {
  const id = seq++;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 3800);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}

/* ---------- Form field ---------- */

export function Field({ label, error, children, hint }: { label: string; error?: string | false; children: ReactNode; hint?: string }) {
  return (
    <label className={`form-field${error ? ' invalid' : ''}`}>
      <span>{label}</span>
      {children}
      {error ? <span className="form-error">{error}</span> : hint ? <span className="sub" style={{ fontWeight: 400 }}>{hint}</span> : null}
    </label>
  );
}
