import React, { useEffect } from 'react';

const SHORTCUTS = [
  { section: 'Annotation' },
  { keys: ['1-9'], desc: 'Select bbox class and enter draw mode' },
  { keys: ['Tab'], desc: 'Select next annotation' },
  { keys: ['Shift', 'Tab'], desc: 'Select previous annotation' },
  { keys: ['Esc'], desc: 'Deselect annotation / exit draw mode' },
  { section: 'Navigation' },
  { keys: ['\u2190'], desc: 'Previous image' },
  { keys: ['\u2192'], desc: 'Next image' },
  { section: 'Zoom' },
  { keys: ['+'], desc: 'Zoom in' },
  { keys: ['-'], desc: 'Zoom out' },
  { keys: ['0'], desc: 'Reset zoom and pan' },
  { keys: ['Scroll'], desc: 'Zoom toward cursor' },
  { section: 'General' },
  { keys: ['?'], desc: 'Toggle this help' },
];

function KeyboardShortcutsHelp({ show, onClose }) {
  useEffect(() => {
    if (!show) return;
    const handleKey = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 10,
          padding: '1.5rem 2rem',
          maxWidth: 420,
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
            Keyboard Shortcuts
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.3rem',
              cursor: 'pointer',
              color: '#64748b',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            x
          </button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {SHORTCUTS.map((item, i) => {
              if (item.section) {
                return (
                  <tr key={i}>
                    <td
                      colSpan={2}
                      style={{
                        paddingTop: i === 0 ? 0 : '0.8rem',
                        paddingBottom: '0.3rem',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        color: '#334155',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      {item.section}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={i}>
                  <td style={{ padding: '0.3rem 0', width: '45%' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {item.keys.map((k, j) => (
                        <span key={j}>
                          {j > 0 && (
                            <span style={{
                              fontSize: '0.7rem',
                              color: '#94a3b8',
                              margin: '0 2px',
                            }}>+</span>
                          )}
                          <kbd style={{
                            display: 'inline-block',
                            padding: '2px 7px',
                            fontSize: '0.78rem',
                            fontFamily: 'inherit',
                            fontWeight: 600,
                            color: '#334155',
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            boxShadow: '0 1px 0 #cbd5e1',
                            minWidth: 22,
                            textAlign: 'center',
                          }}>
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </td>
                  <td style={{
                    padding: '0.3rem 0',
                    fontSize: '0.82rem',
                    color: '#475569',
                  }}>
                    {item.desc}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{
          marginTop: '1rem',
          fontSize: '0.75rem',
          color: '#94a3b8',
          textAlign: 'center',
        }}>
          Press ? or Esc to close
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsHelp;
