import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ServerHealthOverview.css';

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  avatarIcon?: string;
  avatarColor?: string;
}

interface ServerHealth {
  connectionId: string;
  status: 'checking' | 'online' | 'offline' | 'error';
  lastChecked: Date;
  cpu?: number;
  memory?: { used: number; total: number; percent: number };
  disk?: { used: number; total: number; percent: number };
  uptime?: string;
  load?: number[];
  hostname?: string;
  os?: string;
  error?: string;
}

interface ServerHealthOverviewProps {
  isOpen: boolean;
  onClose: () => void;
  connections: Connection[];
  activeConnectionIds: string[];
  onConnect: (connectionId: string) => void;
}

function ServerHealthOverview({
  isOpen,
  onClose,
  connections,
  activeConnectionIds,
  onConnect,
}: ServerHealthOverviewProps) {
  const [healthData, setHealthData] = useState<Map<string, ServerHealth>>(new Map());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse memory/disk sizes like "1.5G" to bytes
  const parseSize = (str: string): number => {
    const match = str.match(/^([\d.]+)([KMGTP]?)$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers: Record<string, number> = {
      '': 1,
      'K': 1024,
      'M': 1024 ** 2,
      'G': 1024 ** 3,
      'T': 1024 ** 4,
      'P': 1024 ** 5,
    };
    return num * (multipliers[unit] || 1);
  };

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  };

  // Parse uptime from seconds to human readable
  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Fetch health data for a single server
  const fetchServerHealth = useCallback(async (connection: Connection): Promise<ServerHealth> => {
    const health: ServerHealth = {
      connectionId: connection.id,
      status: 'checking',
      lastChecked: new Date(),
    };

    if (!activeConnectionIds.includes(connection.id)) {
      return {
        ...health,
        status: 'offline',
        error: 'Not connected',
      };
    }

    try {
      // Run all health check commands in parallel
      const [cpuResult, memResult, diskResult, uptimeResult, hostnameResult, osResult] = await Promise.all([
        window.electronAPI.exec(connection.id, "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1").catch(() => ({ stdout: '', code: 1 })),
        window.electronAPI.exec(connection.id, "free -h | awk '/^Mem:/ {print $2,$3,$4}'").catch(() => ({ stdout: '', code: 1 })),
        window.electronAPI.exec(connection.id, "df -h / | awk 'NR==2 {print $2,$3,$5}'").catch(() => ({ stdout: '', code: 1 })),
        window.electronAPI.exec(connection.id, "cat /proc/uptime | awk '{print $1}'").catch(() => ({ stdout: '', code: 1 })),
        window.electronAPI.exec(connection.id, "hostname").catch(() => ({ stdout: '', code: 1 })),
        window.electronAPI.exec(connection.id, "cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2").catch(() => ({ stdout: '', code: 1 })),
      ]);

      // Parse CPU
      const cpuStr = cpuResult.stdout?.trim();
      if (cpuStr) {
        health.cpu = parseFloat(cpuStr);
      }

      // Parse Memory
      const memParts = memResult.stdout?.trim().split(/\s+/);
      if (memParts && memParts.length >= 2) {
        const total = parseSize(memParts[0]);
        const used = parseSize(memParts[1]);
        health.memory = {
          total,
          used,
          percent: total > 0 ? (used / total) * 100 : 0,
        };
      }

      // Parse Disk
      const diskParts = diskResult.stdout?.trim().split(/\s+/);
      if (diskParts && diskParts.length >= 3) {
        const total = parseSize(diskParts[0]);
        const used = parseSize(diskParts[1]);
        const percentStr = diskParts[2].replace('%', '');
        health.disk = {
          total,
          used,
          percent: parseFloat(percentStr) || 0,
        };
      }

      // Parse Uptime
      const uptimeSeconds = parseFloat(uptimeResult.stdout?.trim() || '0');
      if (uptimeSeconds > 0) {
        health.uptime = formatUptime(uptimeSeconds);
      }

      // Hostname
      health.hostname = hostnameResult.stdout?.trim() || connection.host;

      // OS
      health.os = osResult.stdout?.trim() || 'Unknown';

      // Load average
      const loadResult = await window.electronAPI.exec(connection.id, "cat /proc/loadavg | awk '{print $1,$2,$3}'").catch(() => ({ stdout: '', code: 1 }));
      const loadParts = loadResult.stdout?.trim().split(/\s+/);
      if (loadParts && loadParts.length >= 3) {
        health.load = loadParts.map(l => parseFloat(l));
      }

      health.status = 'online';
    } catch (err: any) {
      health.status = 'error';
      health.error = err.message || 'Failed to fetch health data';
    }

    return health;
  }, [activeConnectionIds]);

  // Fetch health for all servers
  const refreshAll = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);

    const promises = connections.map(conn => fetchServerHealth(conn));
    const results = await Promise.all(promises);

    const newHealthData = new Map<string, ServerHealth>();
    results.forEach(health => {
      newHealthData.set(health.connectionId, health);
    });
    setHealthData(newHealthData);

    setIsRefreshing(false);
  }, [connections, fetchServerHealth, isRefreshing]);

  // Initial load and auto-refresh
  useEffect(() => {
    if (isOpen) {
      refreshAll();

      if (autoRefresh) {
        refreshIntervalRef.current = setInterval(refreshAll, 30000); // Refresh every 30 seconds
      }
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [isOpen, autoRefresh, refreshAll]);

  // Get status color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'online': return 'var(--accent-success)';
      case 'offline': return 'var(--text-muted)';
      case 'error': return 'var(--accent-danger)';
      default: return 'var(--accent-warning)';
    }
  };

  // Get usage color based on percentage
  const getUsageColor = (percent: number): string => {
    if (percent >= 90) return 'var(--accent-danger)';
    if (percent >= 70) return 'var(--accent-warning)';
    return 'var(--accent-success)';
  };

  if (!isOpen) return null;

  const onlineCount = Array.from(healthData.values()).filter(h => h.status === 'online').length;
  const totalCount = connections.length;

  return (
    <div className="health-overview-overlay" onClick={onClose}>
      <div className="health-overview-modal" onClick={e => e.stopPropagation()}>
        <div className="health-overview-header">
          <div className="header-left">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
            </svg>
            <span>Server Health Overview</span>
            <span className="server-count">{onlineCount}/{totalCount} online</span>
          </div>
          <div className="header-right">
            <label className="auto-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
              />
              <span>Auto-refresh</span>
            </label>
            <button
              className="refresh-btn"
              onClick={refreshAll}
              disabled={isRefreshing}
              title="Refresh all"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={isRefreshing ? 'spinning' : ''}
              >
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path>
              </svg>
            </button>
            <button className="close-btn" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <div className="health-overview-body">
          {connections.length === 0 ? (
            <div className="no-servers">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
              </svg>
              <h3>No Servers Configured</h3>
              <p>Add some connections to see their health status</p>
            </div>
          ) : (
            <div className="server-grid">
              {connections.map(connection => {
                const health = healthData.get(connection.id);
                const isConnected = activeConnectionIds.includes(connection.id);

                return (
                  <div key={connection.id} className={`server-card ${health?.status || 'offline'}`}>
                    <div className="server-card-header">
                      <div className="server-identity">
                        <span
                          className="server-icon"
                          style={connection.avatarColor ? { backgroundColor: connection.avatarColor } : undefined}
                        >
                          {connection.avatarIcon || '🖥️'}
                        </span>
                        <div className="server-names">
                          <span className="server-name">{connection.name}</span>
                          <span className="server-hostname">
                            {health?.hostname || `${connection.username}@${connection.host}`}
                          </span>
                        </div>
                      </div>
                      <div
                        className="status-indicator"
                        style={{ backgroundColor: getStatusColor(health?.status || 'offline') }}
                        title={health?.status || 'offline'}
                      />
                    </div>

                    {health?.status === 'online' ? (
                      <div className="server-metrics">
                        {/* CPU */}
                        <div className="metric">
                          <div className="metric-header">
                            <span className="metric-label">CPU</span>
                            <span className="metric-value">{health.cpu?.toFixed(1)}%</span>
                          </div>
                          <div className="metric-bar">
                            <div
                              className="metric-fill"
                              style={{
                                width: `${health.cpu || 0}%`,
                                backgroundColor: getUsageColor(health.cpu || 0),
                              }}
                            />
                          </div>
                        </div>

                        {/* Memory */}
                        {health.memory && (
                          <div className="metric">
                            <div className="metric-header">
                              <span className="metric-label">Memory</span>
                              <span className="metric-value">
                                {formatBytes(health.memory.used)} / {formatBytes(health.memory.total)}
                              </span>
                            </div>
                            <div className="metric-bar">
                              <div
                                className="metric-fill"
                                style={{
                                  width: `${health.memory.percent}%`,
                                  backgroundColor: getUsageColor(health.memory.percent),
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Disk */}
                        {health.disk && (
                          <div className="metric">
                            <div className="metric-header">
                              <span className="metric-label">Disk (/)</span>
                              <span className="metric-value">
                                {formatBytes(health.disk.used)} / {formatBytes(health.disk.total)}
                              </span>
                            </div>
                            <div className="metric-bar">
                              <div
                                className="metric-fill"
                                style={{
                                  width: `${health.disk.percent}%`,
                                  backgroundColor: getUsageColor(health.disk.percent),
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Extra info */}
                        <div className="server-info-row">
                          {health.uptime && (
                            <span className="info-chip" title="Uptime">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                              </svg>
                              {health.uptime}
                            </span>
                          )}
                          {health.load && (
                            <span className="info-chip" title="Load Average (1m, 5m, 15m)">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                              </svg>
                              {health.load.map(l => l.toFixed(2)).join(' ')}
                            </span>
                          )}
                        </div>

                        {health.os && (
                          <div className="os-info">{health.os}</div>
                        )}
                      </div>
                    ) : health?.status === 'checking' ? (
                      <div className="server-checking">
                        <span className="checking-spinner"></span>
                        <span>Checking...</span>
                      </div>
                    ) : (
                      <div className="server-offline">
                        <span>{health?.error || 'Not connected'}</span>
                        {!isConnected && (
                          <button
                            className="connect-btn"
                            onClick={() => onConnect(connection.id)}
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ServerHealthOverview;
