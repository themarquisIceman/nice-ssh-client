import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import './QuickActions.css';

interface QuickAction {
  id: string;
  name: string;
  command: string;
  icon?: string;
  color: string;
  boundToConnectionId?: string; // If set, only show on this connection
}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface QuickActionsProps {
  connectionId: string;
  onExecute: (command: string) => void;
  onClose?: () => void;
}

const ACTION_COLORS = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff', '#ff9e64', '#73daca'];
const ACTION_ICONS = [
  { id: 'terminal', name: 'Terminal', path: 'M4 17l6-6-6-6M12 19h8' },
  { id: 'refresh', name: 'Refresh', path: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15' },
  { id: 'play', name: 'Play', path: 'M5 3l14 9-14 9V3z' },
  { id: 'stop', name: 'Stop', path: 'M6 4h4v16H6zM14 4h4v16h-4z' },
  { id: 'restart', name: 'Restart', path: 'M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10M3.51 15a9 9 0 0014.85 3.36L23 14' },
  { id: 'database', name: 'Database', path: 'M12 2C6.48 2 2 4 2 6.5v11C2 20 6.48 22 12 22s10-2 10-4.5v-11C22 4 17.52 2 12 2z' },
  { id: 'server', name: 'Server', path: 'M2 2h20v8H2zM2 14h20v8H2zM6 6h.01M6 18h.01' },
  { id: 'code', name: 'Code', path: 'M16 18l6-6-6-6M8 6l-6 6 6 6' },
  { id: 'settings', name: 'Settings', path: 'M12 15a3 3 0 100-6 3 3 0 000 6z' },
  { id: 'rocket', name: 'Deploy', path: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z' },
];

function QuickActions({ connectionId, onExecute, onClose }: QuickActionsProps) {
  const [actions, setActions] = useState<QuickAction[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAction, setEditingAction] = useState<QuickAction | null>(null);
  const [actionName, setActionName] = useState('');
  const [actionCommand, setActionCommand] = useState('');
  const [actionColor, setActionColor] = useState(ACTION_COLORS[0]);
  const [actionIcon, setActionIcon] = useState('terminal');
  const [actionBoundToConnection, setActionBoundToConnection] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);

  // Result modal state
  const [showResultModal, setShowResultModal] = useState(false);
  const [resultAction, setResultAction] = useState<QuickAction | null>(null);
  const [resultOutput, setResultOutput] = useState<CommandResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  // Filter actions to show only global ones or ones bound to current connection
  const visibleActions = actions.filter(
    a => !a.boundToConnectionId || a.boundToConnectionId === connectionId
  );

  // Load actions from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('quickActions');
    if (stored) {
      setActions(JSON.parse(stored));
    }
  }, []);

  // Save actions to localStorage
  useEffect(() => {
    localStorage.setItem('quickActions', JSON.stringify(actions));
  }, [actions]);

  const handleSave = () => {
    if (!actionName.trim() || !actionCommand.trim()) return;

    if (editingAction) {
      setActions(prev => prev.map(a =>
        a.id === editingAction.id
          ? {
              ...a,
              name: actionName.trim(),
              command: actionCommand.trim(),
              color: actionColor,
              icon: actionIcon,
              boundToConnectionId: actionBoundToConnection ? connectionId : undefined,
            }
          : a
      ));
    } else {
      const newAction: QuickAction = {
        id: uuidv4(),
        name: actionName.trim(),
        command: actionCommand.trim(),
        color: actionColor,
        icon: actionIcon,
        boundToConnectionId: actionBoundToConnection ? connectionId : undefined,
      };
      setActions(prev => [...prev, newAction]);
    }

    closeModal();
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const handleEdit = (action: QuickAction, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingAction(action);
    setActionName(action.name);
    setActionCommand(action.command);
    setActionColor(action.color);
    setActionIcon(action.icon || 'terminal');
    setActionBoundToConnection(!!action.boundToConnectionId);
    setShowModal(true);
  };

  const handleExecute = async (action: QuickAction) => {
    setExecuting(action.id);
    setResultAction(action);
    setResultOutput(null);
    setResultError(null);
    setShowResultModal(true);

    try {
      const result = await window.electronAPI.exec(connectionId, action.command);
      setResultOutput(result);
    } catch (err: any) {
      setResultError(err.message || 'Command execution failed');
    } finally {
      setExecuting(null);
    }
  };

  const closeResultModal = () => {
    setShowResultModal(false);
    setResultAction(null);
    setResultOutput(null);
    setResultError(null);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingAction(null);
    setActionName('');
    setActionCommand('');
    setActionColor(ACTION_COLORS[0]);
    setActionIcon('terminal');
    setActionBoundToConnection(false);
  };

  const openAddModal = () => {
    setEditingAction(null);
    setActionName('');
    setActionCommand('');
    setActionColor(ACTION_COLORS[0]);
    setActionIcon('terminal');
    setActionBoundToConnection(false);
    setShowModal(true);
  };

  const getIconPath = (iconId: string) => {
    return ACTION_ICONS.find(i => i.id === iconId)?.path || ACTION_ICONS[0].path;
  };

  return (
    <div className="quick-actions-panel">
      <div className="quick-actions-header">
        <div className="header-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
          </svg>
          <span>Quick Actions</span>
        </div>
        <div className="header-actions">
          <button className="add-action-btn" onClick={openAddModal} title="Add Action">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          {onClose && (
            <button className="close-btn" onClick={onClose} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="quick-actions-list">
          {visibleActions.length === 0 ? (
            <div className="empty-actions">
              <p>No quick actions</p>
              <button onClick={openAddModal}>Add Action</button>
            </div>
          ) : (
            visibleActions.map(action => (
              <div
                key={action.id}
                className={`action-item ${executing === action.id ? 'executing' : ''}`}
                onClick={() => handleExecute(action)}
                title={action.command}
                style={{ '--action-color': action.color } as React.CSSProperties}
              >
                <div className="action-icon" style={{ backgroundColor: action.color }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d={getIconPath(action.icon || 'terminal')}></path>
                  </svg>
                </div>
                <span className="action-name">{action.name}</span>
                {action.boundToConnectionId && (
                  <span className="action-bound-badge" title="Only for this connection">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                  </span>
                )}
                <div className="action-buttons">
                  <button onClick={(e) => handleEdit(action, e)} title="Edit">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <button onClick={(e) => handleDelete(action.id, e)} title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingAction ? 'Edit Action' : 'Add Quick Action'}</h3>
              <button className="modal-close" onClick={closeModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={actionName}
                  onChange={(e) => setActionName(e.target.value)}
                  placeholder="e.g., Reload PM2"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Command</label>
                <textarea
                  value={actionCommand}
                  onChange={(e) => setActionCommand(e.target.value)}
                  placeholder="e.g., pm2 reload 2"
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Icon</label>
                <div className="icon-picker">
                  {ACTION_ICONS.map(icon => (
                    <button
                      key={icon.id}
                      className={`icon-option ${actionIcon === icon.id ? 'selected' : ''}`}
                      onClick={() => setActionIcon(icon.id)}
                      title={icon.name}
                      style={{ '--icon-color': actionColor } as React.CSSProperties}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d={icon.path}></path>
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Color</label>
                <div className="color-picker">
                  {ACTION_COLORS.map(color => (
                    <button
                      key={color}
                      className={`color-option ${actionColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setActionColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={actionBoundToConnection}
                    onChange={(e) => setActionBoundToConnection(e.target.checked)}
                  />
                  <span className="checkbox-text">Only for this connection</span>
                </label>
                <span className="form-hint">When enabled, this action will only appear on the current connection</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={!actionName.trim() || !actionCommand.trim()}
              >
                {editingAction ? 'Save' : 'Add Action'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result Modal */}
      {showResultModal && resultAction && (
        <div className="modal-overlay" onClick={closeResultModal}>
          <div className="modal-content result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <span className="result-action-icon" style={{ backgroundColor: resultAction.color }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d={getIconPath(resultAction.icon || 'terminal')}></path>
                  </svg>
                </span>
                {resultAction.name}
              </h3>
              <button className="modal-close" onClick={closeResultModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body result-body">
              <div className="result-command">
                <span className="result-label">Command:</span>
                <code>{resultAction.command}</code>
              </div>

              {executing ? (
                <div className="result-loading">
                  <div className="loading-spinner"></div>
                  <span>Executing...</span>
                </div>
              ) : resultError ? (
                <div className="result-error">
                  <span className="result-label">Error:</span>
                  <pre>{resultError}</pre>
                </div>
              ) : resultOutput ? (
                <div className="result-output">
                  {resultOutput.stdout && (
                    <div className="result-section">
                      <span className="result-label">Output:</span>
                      <pre>{resultOutput.stdout}</pre>
                    </div>
                  )}
                  {resultOutput.stderr && (
                    <div className="result-section result-stderr">
                      <span className="result-label">Stderr:</span>
                      <pre>{resultOutput.stderr}</pre>
                    </div>
                  )}
                  <div className="result-exit-code">
                    <span className={`exit-code ${resultOutput.code === 0 ? 'success' : 'error'}`}>
                      Exit code: {resultOutput.code}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeResultModal}>Close</button>
              <button
                className="btn-primary"
                onClick={() => {
                  closeResultModal();
                  handleExecute(resultAction);
                }}
                disabled={executing !== null}
              >
                Run Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default QuickActions;
