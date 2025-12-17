import React, { useState, useEffect, useRef } from 'react';
import './TunnelManager.css';
import { TunnelInfo } from '../types/electron';

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  avatarIcon?: string;
  avatarColor?: string;
}

interface TunnelManagerProps {
  isOpen: boolean;
  onClose: () => void;
  connections: Connection[];
  activeConnectionIds: string[];
}

function TunnelManager({
  isOpen,
  onClose,
  connections,
  activeConnectionIds,
}: TunnelManagerProps) {
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [tunnelType, setTunnelType] = useState<'local' | 'remote'>('local');
  const [localHost, setLocalHost] = useState('127.0.0.1');
  const [localPort, setLocalPort] = useState('');
  const [remoteHost, setRemoteHost] = useState('127.0.0.1');
  const [remotePort, setRemotePort] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const localPortRef = useRef<HTMLInputElement>(null);

  // Get connected servers
  const connectedServers = connections.filter(c => activeConnectionIds.includes(c.id));

  // Load tunnels
  const loadTunnels = async () => {
    setIsLoading(true);
    try {
      const allTunnels = await window.electronAPI.tunnelListAll();
      setTunnels(allTunnels);
    } catch (err: any) {
      console.error('Failed to load tunnels:', err);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadTunnels();
      // Auto-select first connected server
      if (connectedServers.length > 0 && !selectedConnection) {
        setSelectedConnection(connectedServers[0].id);
      }
    }
  }, [isOpen]);

  // Create tunnel
  const handleCreateTunnel = async () => {
    if (!selectedConnection || !localPort || !remotePort) {
      setError('Please fill in all fields');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const result = await window.electronAPI.tunnelCreate(selectedConnection, {
        type: tunnelType,
        localHost,
        localPort: parseInt(localPort, 10),
        remoteHost,
        remotePort: parseInt(remotePort, 10),
      });

      if (result.success) {
        await loadTunnels();
        setLocalPort('');
        setRemotePort('');
      } else {
        setError(result.error || 'Failed to create tunnel');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create tunnel');
    }

    setIsCreating(false);
  };

  // Close tunnel
  const handleCloseTunnel = async (tunnelId: string) => {
    try {
      await window.electronAPI.tunnelClose(tunnelId);
      await loadTunnels();
    } catch (err: any) {
      setError(err.message || 'Failed to close tunnel');
    }
  };

  // Get connection name by ID
  const getConnectionName = (connectionId: string) => {
    const conn = connections.find(c => c.id === connectionId);
    return conn?.name || 'Unknown';
  };

  if (!isOpen) return null;

  return (
    <div className="tunnel-manager-overlay" onClick={onClose}>
      <div className="tunnel-manager-modal" onClick={e => e.stopPropagation()}>
        <div className="tunnel-manager-header">
          <div className="header-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span>SSH Tunnel Manager</span>
          </div>
          <button className="close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="tunnel-manager-body">
          {/* Create Tunnel Form */}
          <div className="create-tunnel-section">
            <h3>Create New Tunnel</h3>

            {connectedServers.length === 0 ? (
              <div className="no-servers-warning">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>Connect to a server first to create tunnels</span>
              </div>
            ) : (
              <div className="tunnel-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Server</label>
                    <select
                      value={selectedConnection}
                      onChange={e => setSelectedConnection(e.target.value)}
                    >
                      {connectedServers.map(server => (
                        <option key={server.id} value={server.id}>
                          {server.name} ({server.host})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Type</label>
                    <div className="type-toggle">
                      <button
                        className={tunnelType === 'local' ? 'active' : ''}
                        onClick={() => setTunnelType('local')}
                      >
                        Local
                      </button>
                      <button
                        className={tunnelType === 'remote' ? 'active' : ''}
                        onClick={() => setTunnelType('remote')}
                      >
                        Remote
                      </button>
                    </div>
                  </div>
                </div>

                <div className="tunnel-visual">
                  <div className="tunnel-endpoint local">
                    <span className="endpoint-label">
                      {tunnelType === 'local' ? 'Listen on (Local)' : 'Forward to (Local)'}
                    </span>
                    <div className="endpoint-inputs">
                      <input
                        type="text"
                        placeholder="Host"
                        value={localHost}
                        onChange={e => setLocalHost(e.target.value)}
                      />
                      <span>:</span>
                      <input
                        ref={localPortRef}
                        type="number"
                        placeholder="Port"
                        value={localPort}
                        onChange={e => setLocalPort(e.target.value)}
                        min="1"
                        max="65535"
                      />
                    </div>
                  </div>

                  <div className="tunnel-arrow">
                    {tunnelType === 'local' ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                      </svg>
                    )}
                    <span>{tunnelType === 'local' ? 'SSH' : 'SSH'}</span>
                  </div>

                  <div className="tunnel-endpoint remote">
                    <span className="endpoint-label">
                      {tunnelType === 'local' ? 'Forward to (Remote)' : 'Listen on (Remote)'}
                    </span>
                    <div className="endpoint-inputs">
                      <input
                        type="text"
                        placeholder="Host"
                        value={remoteHost}
                        onChange={e => setRemoteHost(e.target.value)}
                      />
                      <span>:</span>
                      <input
                        type="number"
                        placeholder="Port"
                        value={remotePort}
                        onChange={e => setRemotePort(e.target.value)}
                        min="1"
                        max="65535"
                      />
                    </div>
                  </div>
                </div>

                <div className="tunnel-description">
                  {tunnelType === 'local' ? (
                    <p>
                      <strong>Local forwarding:</strong> Connections to <code>{localHost}:{localPort || '???'}</code> on your machine will be forwarded to <code>{remoteHost}:{remotePort || '???'}</code> on the remote server.
                    </p>
                  ) : (
                    <p>
                      <strong>Remote forwarding:</strong> Connections to <code>{remoteHost}:{remotePort || '???'}</code> on the remote server will be forwarded to <code>{localHost}:{localPort || '???'}</code> on your machine.
                    </p>
                  )}
                </div>

                {error && (
                  <div className="error-message">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    {error}
                  </div>
                )}

                <button
                  className="create-btn"
                  onClick={handleCreateTunnel}
                  disabled={isCreating || !localPort || !remotePort}
                >
                  {isCreating ? (
                    <>
                      <span className="spinner"></span>
                      Creating...
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      Create Tunnel
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Active Tunnels */}
          <div className="active-tunnels-section">
            <h3>
              Active Tunnels
              <span className="tunnel-count">{tunnels.length}</span>
            </h3>

            {isLoading ? (
              <div className="loading">Loading tunnels...</div>
            ) : tunnels.length === 0 ? (
              <div className="no-tunnels">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <span>No active tunnels</span>
              </div>
            ) : (
              <div className="tunnels-list">
                {tunnels.map(tunnel => (
                  <div key={tunnel.id} className={`tunnel-item ${tunnel.type}`}>
                    <div className="tunnel-info">
                      <div className="tunnel-type">
                        <span className={`type-badge ${tunnel.type}`}>
                          {tunnel.type === 'local' ? 'L' : 'R'}
                        </span>
                        <span className="server-name">{getConnectionName(tunnel.connectionId)}</span>
                      </div>
                      <div className="tunnel-route">
                        <span className="endpoint">
                          {tunnel.localHost}:{tunnel.localPort}
                        </span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          {tunnel.type === 'local' ? (
                            <>
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                              <polyline points="12 5 19 12 12 19"></polyline>
                            </>
                          ) : (
                            <>
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </>
                          )}
                        </svg>
                        <span className="endpoint">
                          {tunnel.remoteHost}:{tunnel.remotePort}
                        </span>
                      </div>
                    </div>
                    <div className="tunnel-actions">
                      <span className={`status-badge ${tunnel.status}`}>
                        {tunnel.status}
                      </span>
                      <button
                        className="close-tunnel-btn"
                        onClick={() => handleCloseTunnel(tunnel.id)}
                        title="Close tunnel"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TunnelManager;
