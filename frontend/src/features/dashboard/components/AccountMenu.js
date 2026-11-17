import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Top-right account menu holding rarely used actions (Settings, API Keys).
 * Closes on Escape, outside click, or selection; arrow keys move between
 * items; focus returns to the button on close.
 */
export default function AccountMenu({ email, onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const items = () => Array.from(ref.current?.querySelectorAll('[role="menuitem"]') || []);
    items()[0]?.focus();
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const list = items();
        if (!list.length) return;
        event.preventDefault();
        const at = list.indexOf(document.activeElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        list[(at + step + list.length) % list.length].focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (fn) => {
    setOpen(false);
    buttonRef.current?.focus();
    fn();
  };

  return (
    <div className="account-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="account-menu-button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="account-menu-email">{email || 'Account'}</span>
        <span className="account-menu-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="account-menu-dropdown" role="menu" aria-label="Account">
          {email && <div className="account-menu-signed-in">Signed in as {email}</div>}
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            aria-label="Open dashboard settings"
            onClick={() => choose(onOpenSettings)}
          >
            Settings
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => choose(() => navigate('/api-keys'))}
          >
            API Keys
          </button>
        </div>
      )}
    </div>
  );
}
