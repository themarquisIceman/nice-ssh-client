import React, { useState } from 'react';
import { Connection } from '../types/electron';
import { maskIP, maskUsername, PreferencesConfig } from './Preferences';
import './Sidebar.css';

const AVATAR_COLORS = [
  '#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff',
  '#ff9e64', '#c0caf5', '#73daca', '#b4f9f8', '#2ac3de', '#ff007c'
];

const AVATAR_ICONS = [
  { id: 'server', name: 'Server', icon: 'M2 2h20v20H2V2zm2 2v16h16V4H4zm2 2h12v2H6V6zm0 4h12v2H6v-2zm0 4h8v2H6v-2z' },
  { id: 'cloud', name: 'Cloud', icon: 'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z' },
  { id: 'database', name: 'Database', icon: 'M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2zM4 6.5C4 5.12 7.58 4 12 4s8 1.12 8 2.5S16.42 9 12 9 4 7.88 4 6.5zM4 17.5v-3c1.83 1.21 5.07 2 8 2s6.17-.79 8-2v3c0 1.38-3.58 2.5-8 2.5S4 18.88 4 17.5z' },
  { id: 'globe', name: 'Globe', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z' },
  { id: 'terminal', name: 'Terminal', icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-8-2h6v-2h-6v2zm-5.7-4.7l1.4-1.4L5.8 8l-1.4 1.4 2 2-2 2L5.8 15l1.9-1.9 1.4-1.4-2-2z' },
  { id: 'lock', name: 'Secure', icon: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z' },
  { id: 'home', name: 'Home', icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z' },
  { id: 'work', name: 'Work', icon: 'M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z' },
  { id: 'star', name: 'Star', icon: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' },
  { id: 'heart', name: 'Heart', icon: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
  { id: 'code', name: 'Code', icon: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z' },
  { id: 'rocket', name: 'Rocket', icon: 'M12 2.5c-3.9 3.9-5.5 9.1-5 14.1l-3 3v.4h.4l3-3c5-.5 10.2.9 14.1-5-.5-1.5-1.3-2.8-2.4-3.9-1.1-1.1-2.4-1.9-3.9-2.4-1.5 3.9-5.1 6.3-9.2 6.3 0-4.1 2.4-7.7 6.3-9.2-.5-1.5-1.3-2.8-2.4-3.9-1.1-1.1-2.4-1.9-3.9-2.4zm3 5.5c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5-1.5-.7-1.5-1.5.7-1.5 1.5-1.5z' },
];

interface SidebarProps {
  connections: Connection[];
  activeConnectionIds: string[];
  onConnect: (connection: Connection, mode: 'terminal' | 'sftp' | 'dashboard') => void;
  onEdit: (connection: Connection) => void;
  onDelete: (id: string) => void;
  onNewConnection: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
  onUpdateConnection?: (connection: Connection) => void;
  onGoHome?: () => void;
  showHomeButton?: boolean;
  preferences?: PreferencesConfig;
  onOpenLocalConsole?: () => void;
  isLocalConsoleActive?: boolean;
  onReorderConnections?: (connections: Connection[]) => void;
}

function Sidebar({
  connections,
  activeConnectionIds,
  onConnect,
  onEdit,
  onDelete,
  onNewConnection,
  collapsed = false,
  onToggle,
  onUpdateConnection,
  onGoHome,
  showHomeButton = false,
  preferences,
  onOpenLocalConsole,
  isLocalConsoleActive = false,
  onReorderConnections,
}: SidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    connectionId: string;
    x: number;
    y: number;
  } | null>(null);

  // Drag state for reordering connections
  const [draggedConnection, setDraggedConnection] = useState<string | null>(null);
  const [dragOverConnection, setDragOverConnection] = useState<string | null>(null);

  // Avatar customization modal
  const [avatarModal, setAvatarModal] = useState<{
    connection: Connection;
  } | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('');

  const filteredConnections = connections.filter(
    (conn) =>
      conn.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conn.host.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleContextMenu = (e: React.MouseEvent, connectionId: string) => {
    e.preventDefault();
    setContextMenu({ connectionId, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  React.useEffect(() => {
    const handleClick = () => closeContextMenu();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const getConnectionColor = (conn: Connection) => {
    if (conn.avatarColor) return conn.avatarColor;
    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff'];
    let hash = 0;
    for (let i = 0; i < conn.name.length; i++) {
      hash = conn.name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getAvatarIcon = (conn: Connection) => {
    if (!conn.avatarIcon) return null;
    return AVATAR_ICONS.find(i => i.id === conn.avatarIcon);
  };

  const openAvatarModal = (conn: Connection) => {
    setSelectedIcon(conn.avatarIcon || '');
    setSelectedColor(conn.avatarColor || getConnectionColor(conn));
    setAvatarModal({ connection: conn });
    closeContextMenu();
  };

  const saveAvatar = () => {
    if (!avatarModal || !onUpdateConnection) return;
    const updatedConnection: Connection = {
      ...avatarModal.connection,
      avatarIcon: selectedIcon || undefined,
      avatarColor: selectedColor || undefined,
    };
    onUpdateConnection(updatedConnection);
    setAvatarModal(null);
  };

  const renderAvatar = (conn: Connection) => {
    const iconData = getAvatarIcon(conn);
    const color = getConnectionColor(conn);

    if (iconData) {
      return (
        <div className="connection-avatar" style={{ backgroundColor: color }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d={iconData.icon} />
          </svg>
        </div>
      );
    }

    return (
      <div className="connection-avatar" style={{ backgroundColor: color }}>
        {conn.name.charAt(0).toUpperCase()}
      </div>
    );
  };

  // Drag handlers for reordering connections
  const handleDragStart = (e: React.DragEvent, connectionId: string) => {
    setDraggedConnection(connectionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', connectionId);
  };

  const handleDragOver = (e: React.DragEvent, connectionId: string) => {
    e.preventDefault();
    if (draggedConnection && draggedConnection !== connectionId) {
      setDragOverConnection(connectionId);
    }
  };

  const handleDragLeave = () => {
    setDragOverConnection(null);
  };

  const handleDrop = (e: React.DragEvent, targetConnectionId: string) => {
    e.preventDefault();
    if (!draggedConnection || draggedConnection === targetConnectionId || !onReorderConnections) {
      setDraggedConnection(null);
      setDragOverConnection(null);
      return;
    }

    const draggedIndex = connections.findIndex(c => c.id === draggedConnection);
    const targetIndex = connections.findIndex(c => c.id === targetConnectionId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedConnection(null);
      setDragOverConnection(null);
      return;
    }

    const newConnections = [...connections];
    const [draggedItem] = newConnections.splice(draggedIndex, 1);
    newConnections.splice(targetIndex, 0, draggedItem);

    onReorderConnections(newConnections);
    setDraggedConnection(null);
    setDragOverConnection(null);
  };

  const handleDragEnd = () => {
    setDraggedConnection(null);
    setDragOverConnection(null);
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!collapsed && (
          <h2
            className={showHomeButton ? 'clickable' : ''}
            onClick={showHomeButton ? onGoHome : undefined}
            title={showHomeButton ? 'Go to Homepage' : undefined}
          >
            {showHomeButton && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            )}
            Connections
          </h2>
        )}
        <div className="sidebar-header-actions">
          {!collapsed && showHomeButton && (
            <button className="home-btn" onClick={onGoHome} title="Go to Homepage">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </button>
          )}
          {!collapsed && (
            <button className="new-btn" onClick={onNewConnection} title="New Connection">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          )}
          <button className="toggle-btn" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {collapsed ? (
                <polyline points="9 18 15 12 9 6"></polyline>
              ) : (
                <polyline points="15 18 9 12 15 6"></polyline>
              )}
            </svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            placeholder="Search hosts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      )}

      <div className="connections-list">
        {/* Personal Console - Local CMD */}
        {onOpenLocalConsole && (
          <div
            className={`connection-item local-console ${isLocalConsoleActive ? 'active' : ''} ${collapsed ? 'collapsed' : ''}`}
            onClick={onOpenLocalConsole}
            title={collapsed ? 'Personal Console (Local)' : undefined}
          >
            <div className="connection-avatar" style={{ backgroundColor: '#9ece6a' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
            </div>
            {!collapsed && (
              <div className="connection-details">
                <span className="connection-name">Personal Console</span>
                <span className="connection-host">Local Terminal</span>
              </div>
            )}
          </div>
        )}

        {!collapsed && <div className="sidebar-divider"></div>}

        {filteredConnections.length === 0 && !collapsed ? (
          <div className="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <p>No connections yet</p>
            <button onClick={onNewConnection}>Add your first host</button>
          </div>
        ) : (
          filteredConnections.map((conn) => (
            <div
              key={conn.id}
              className={`connection-item ${activeConnectionIds.includes(conn.id) ? 'active' : ''} ${collapsed ? 'collapsed' : ''} ${dragOverConnection === conn.id ? 'drag-over' : ''} ${draggedConnection === conn.id ? 'dragging' : ''}`}
              onClick={() => onConnect(conn, 'terminal')}
              onContextMenu={(e) => handleContextMenu(e, conn.id)}
              title={collapsed ? `${conn.name}\n${maskUsername(conn.username, preferences?.hideUsernames)}@${maskIP(conn.host, preferences?.hideIPs)}` : undefined}
              draggable={!collapsed && !!onReorderConnections}
              onDragStart={(e) => handleDragStart(e, conn.id)}
              onDragOver={(e) => handleDragOver(e, conn.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, conn.id)}
              onDragEnd={handleDragEnd}
            >
              {renderAvatar(conn)}
              {!collapsed && (
                <>
                  <div className="connection-details">
                    <span className="connection-name">{conn.name}</span>
                    <span className="connection-host">{maskUsername(conn.username, preferences?.hideUsernames)}@{maskIP(conn.host, preferences?.hideIPs)}</span>
                  </div>
                  <div className="connection-actions">
                    <button
                      className="action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConnect(conn, 'sftp');
                      }}
                      title="Open SFTP"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                      </svg>
                    </button>
                    <button
                      className="action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(conn);
                      }}
                      title="Edit"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => {
              const conn = connections.find((c) => c.id === contextMenu.connectionId);
              if (conn) onConnect(conn, 'terminal');
              closeContextMenu();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            Open Terminal
          </button>
          <button
            onClick={() => {
              const conn = connections.find((c) => c.id === contextMenu.connectionId);
              if (conn) onConnect(conn, 'sftp');
              closeContextMenu();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            Open SFTP
          </button>
          <div className="context-menu-divider" />
          <button
            onClick={() => {
              const conn = connections.find((c) => c.id === contextMenu.connectionId);
              if (conn) openAvatarModal(conn);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="10" r="3"></circle>
              <path d="M6.168 18.849A4 4 0 0110 16h4a4 4 0 013.834 2.855"></path>
            </svg>
            Customize Avatar
          </button>
          <button
            onClick={() => {
              const conn = connections.find((c) => c.id === contextMenu.connectionId);
              if (conn) onEdit(conn);
              closeContextMenu();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit Connection
          </button>
          <button
            className="danger"
            onClick={() => {
              onDelete(contextMenu.connectionId);
              closeContextMenu();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete
          </button>
        </div>
      )}

      {/* Avatar Customization Modal */}
      {avatarModal && (
        <div className="avatar-modal-overlay" onClick={() => setAvatarModal(null)}>
          <div className="avatar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="avatar-modal-header">
              <h3>Customize Avatar</h3>
              <button className="modal-close" onClick={() => setAvatarModal(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="avatar-modal-body">
              {/* Preview */}
              <div className="avatar-preview">
                <div
                  className="preview-avatar"
                  style={{ backgroundColor: selectedColor }}
                >
                  {selectedIcon ? (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                      <path d={AVATAR_ICONS.find(i => i.id === selectedIcon)?.icon || ''} />
                    </svg>
                  ) : (
                    <span>{avatarModal.connection.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <span className="preview-name">{avatarModal.connection.name}</span>
              </div>

              {/* Color Picker */}
              <div className="avatar-section">
                <label>Color</label>
                <div className="color-grid">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`color-option ${selectedColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setSelectedColor(color)}
                    />
                  ))}
                </div>
              </div>

              {/* Icon Picker */}
              <div className="avatar-section">
                <label>Icon (optional)</label>
                <div className="icon-grid">
                  <button
                    className={`icon-option ${!selectedIcon ? 'selected' : ''}`}
                    onClick={() => setSelectedIcon('')}
                    title="Use letter"
                  >
                    <span className="letter-icon">{avatarModal.connection.name.charAt(0).toUpperCase()}</span>
                  </button>
                  {AVATAR_ICONS.map((icon) => (
                    <button
                      key={icon.id}
                      className={`icon-option ${selectedIcon === icon.id ? 'selected' : ''}`}
                      onClick={() => setSelectedIcon(icon.id)}
                      title={icon.name}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d={icon.icon} />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="avatar-modal-footer">
              <button className="btn-secondary" onClick={() => setAvatarModal(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={saveAvatar}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
