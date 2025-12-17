import React, { useState, useEffect, useRef } from 'react';
import './MultiServerCommand.css';

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  avatarIcon?: string;
  avatarColor?: string;
}

interface ServerOutput {
  connectionId: string;
  status: 'pending' | 'running' | 'success' | 'error';
  output: string;
  exitCode?: number;
  duration?: number;
}

interface MultiServerCommandProps {
  isOpen: boolean;
  onClose: () => void;
  connections: Connection[];
  activeConnectionIds: string[];
}

function MultiServerCommand({
  isOpen,
  onClose,
  connections,
  activeConnectionIds,
}: MultiServerCommandProps) {
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [outputs, setOutputs] = useState<Map<string, ServerOutput>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  // Get only connected servers
  const connectedServers = connections.filter(c => activeConnectionIds.includes(c.id));

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedServers([]);
      setCommand('');
      setOutputs(new Map());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Select/deselect all
  const toggleAll = () => {
    if (selectedServers.length === connectedServers.length) {
      setSelectedServers([]);
    } else {
      setSelectedServers(connectedServers.map(c => c.id));
    }
  };

  // Toggle individual server
  const toggleServer = (serverId: string) => {
    setSelectedServers(prev =>
      prev.includes(serverId)
        ? prev.filter(id => id !== serverId)
        : [...prev, serverId]
    );
  };

  // Execute command on all selected servers
  const executeCommand = async () => {
    if (!command.trim() || selectedServers.length === 0) return;

    setIsExecuting(true);

    // Initialize outputs
    const initialOutputs = new Map<string, ServerOutput>();
    selectedServers.forEach(id => {
      initialOutputs.set(id, {
        connectionId: id,
        status: 'pending',
        output: '',
      });
    });
    setOutputs(initialOutputs);

    // Execute on all servers in parallel
    const execPromises = selectedServers.map(async (serverId) => {
      const startTime = Date.now();

      // Update status to running
      setOutputs(prev => {
        const updated = new Map(prev);
        updated.set(serverId, {
          ...prev.get(serverId)!,
          status: 'running',
        });
        return updated;
      });

      try {
        const result = await window.electronAPI.exec(serverId, command);
        const duration = Date.now() - startTime;

        setOutputs(prev => {
          const updated = new Map(prev);
          updated.set(serverId, {
            connectionId: serverId,
            status: result.code === 0 ? 'success' : 'error',
            output: result.stdout || result.stderr || '(no output)',
            exitCode: result.code,
            duration,
          });
          return updated;
        });
      } catch (err: any) {
        const duration = Date.now() - startTime;
        setOutputs(prev => {
          const updated = new Map(prev);
          updated.set(serverId, {
            connectionId: serverId,
            status: 'error',
            output: err.message || 'Command failed',
            duration,
          });
          return updated;
        });
      }
    });

    await Promise.all(execPromises);
    setIsExecuting(false);
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      executeCommand();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  const allSelected = selectedServers.length === connectedServers.length && connectedServers.length > 0;
  const hasResults = outputs.size > 0;

  return (
    <div className="multi-server-overlay" onClick={onClose}>
      <div className="multi-server-modal" onClick={e => e.stopPropagation()}>
        <div className="multi-server-header">
          <div className="header-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>
            <span>Multi-Server Command</span>
          </div>
          <button className="close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="multi-server-body">
          {/* Server Selection */}
          <div className="server-selection">
            <div className="section-header">
              <span>Select Servers ({selectedServers.length}/{connectedServers.length})</span>
              <button className="select-all-btn" onClick={toggleAll}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {connectedServers.length === 0 ? (
              <div className="no-servers">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>No connected servers</span>
                <p>Connect to at least one server first</p>
              </div>
            ) : (
              <div className="server-list">
                {connectedServers.map(server => (
                  <label key={server.id} className="server-item">
                    <input
                      type="checkbox"
                      checked={selectedServers.includes(server.id)}
                      onChange={() => toggleServer(server.id)}
                    />
                    <span
                      className="server-icon"
                      style={server.avatarColor ? { backgroundColor: server.avatarColor } : undefined}
                    >
                      {server.avatarIcon || '🖥️'}
                    </span>
                    <div className="server-info">
                      <span className="server-name">{server.name}</span>
                      <span className="server-host">{server.username}@{server.host}</span>
                    </div>
                    {outputs.get(server.id) && (
                      <span className={`server-status ${outputs.get(server.id)?.status}`}>
                        {outputs.get(server.id)?.status === 'pending' && '⏳'}
                        {outputs.get(server.id)?.status === 'running' && '🔄'}
                        {outputs.get(server.id)?.status === 'success' && '✅'}
                        {outputs.get(server.id)?.status === 'error' && '❌'}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Command Input */}
          <div className="command-section">
            <label className="command-label">Command</label>
            <div className="command-input-wrapper">
              <input
                ref={inputRef}
                type="text"
                className="command-input"
                value={command}
                onChange={e => setCommand(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter command to execute..."
                disabled={isExecuting}
              />
              <button
                className="execute-btn"
                onClick={executeCommand}
                disabled={isExecuting || selectedServers.length === 0 || !command.trim()}
              >
                {isExecuting ? (
                  <>
                    <span className="spinner"></span>
                    Running...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    Run on {selectedServers.length} server{selectedServers.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
            <span className="command-hint">Press Ctrl+Enter to execute</span>
          </div>

          {/* Results */}
          {hasResults && (
            <div className="results-section">
              <div className="section-header">
                <span>Results</span>
              </div>
              <div className="results-grid">
                {Array.from(outputs.entries()).map(([serverId, output]) => {
                  const server = connections.find(c => c.id === serverId);
                  return (
                    <div key={serverId} className={`result-card ${output.status}`}>
                      <div className="result-header">
                        <span className="result-server">{server?.name || 'Unknown'}</span>
                        <div className="result-meta">
                          {output.duration !== undefined && (
                            <span className="result-duration">{output.duration}ms</span>
                          )}
                          {output.exitCode !== undefined && (
                            <span className={`result-code ${output.exitCode === 0 ? 'success' : 'error'}`}>
                              Exit: {output.exitCode}
                            </span>
                          )}
                        </div>
                      </div>
                      <pre className="result-output">{output.output}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MultiServerCommand;
