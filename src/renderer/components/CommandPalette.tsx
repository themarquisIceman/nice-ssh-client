import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './CommandPalette.css';

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  avatarIcon?: string;
  avatarColor?: string;
}

interface Tab {
  id: string;
  connectionId: string;
  mode: 'terminal' | 'files' | 'dashboard';
}

interface CommandItem {
  id: string;
  type: 'connection' | 'action' | 'tab';
  title: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  connections: Connection[];
  tabs: Tab[];
  onConnect: (connectionId: string, mode?: 'terminal' | 'files' | 'dashboard') => void;
  onSwitchTab: (tabId: string) => void;
  onDisconnect: (connectionId: string) => void;
  activeConnections: string[];
}

function CommandPalette({
  isOpen,
  onClose,
  connections,
  tabs,
  onConnect,
  onSwitchTab,
  onDisconnect,
  activeConnections,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build command items
  const allItems = useMemo((): CommandItem[] => {
    const items: CommandItem[] = [];

    // Add connection items
    connections.forEach(conn => {
      const isConnected = activeConnections.includes(conn.id);

      // Connect action
      items.push({
        id: `connect-${conn.id}`,
        type: 'connection',
        title: conn.name,
        subtitle: `${conn.username}@${conn.host}:${conn.port}`,
        icon: conn.avatarIcon || '🖥️',
        iconColor: conn.avatarColor,
        action: () => {
          onConnect(conn.id, 'terminal');
          onClose();
        },
      });

      // If connected, add more actions
      if (isConnected) {
        items.push({
          id: `files-${conn.id}`,
          type: 'action',
          title: `Open Files - ${conn.name}`,
          subtitle: 'Browse remote files',
          icon: '📁',
          action: () => {
            onConnect(conn.id, 'files');
            onClose();
          },
        });

        items.push({
          id: `dashboard-${conn.id}`,
          type: 'action',
          title: `Open Dashboard - ${conn.name}`,
          subtitle: 'View server dashboard',
          icon: '📊',
          action: () => {
            onConnect(conn.id, 'dashboard');
            onClose();
          },
        });

        items.push({
          id: `disconnect-${conn.id}`,
          type: 'action',
          title: `Disconnect - ${conn.name}`,
          subtitle: 'Close SSH connection',
          icon: '🔌',
          action: () => {
            onDisconnect(conn.id);
            onClose();
          },
        });
      }
    });

    // Add open tabs
    tabs.forEach(tab => {
      const conn = connections.find(c => c.id === tab.connectionId);
      if (conn) {
        items.push({
          id: `tab-${tab.id}`,
          type: 'tab',
          title: `Switch to ${conn.name} - ${tab.mode}`,
          subtitle: 'Open tab',
          icon: tab.mode === 'terminal' ? '💻' : tab.mode === 'files' ? '📁' : '📊',
          action: () => {
            onSwitchTab(tab.id);
            onClose();
          },
        });
      }
    });

    // Add general actions
    items.push({
      id: 'action-new-connection',
      type: 'action',
      title: 'Add New Connection',
      subtitle: 'Create a new SSH connection',
      icon: '➕',
      action: () => {
        onClose();
        document.dispatchEvent(new CustomEvent('command-palette:new-connection'));
      },
    });

    items.push({
      id: 'action-multi-server',
      type: 'action',
      title: 'Multi-Server Command',
      subtitle: 'Run command on multiple servers (Ctrl+Shift+M)',
      icon: '🖥️',
      action: () => {
        onClose();
        document.dispatchEvent(new CustomEvent('command-palette:multi-server'));
      },
    });

    items.push({
      id: 'action-health-overview',
      type: 'action',
      title: 'Server Health Overview',
      subtitle: 'View all servers health status (Ctrl+Shift+H)',
      icon: '💓',
      action: () => {
        onClose();
        document.dispatchEvent(new CustomEvent('command-palette:health-overview'));
      },
    });

    items.push({
      id: 'action-tunnel-manager',
      type: 'action',
      title: 'SSH Tunnel Manager',
      subtitle: 'Manage port forwarding tunnels (Ctrl+Shift+T)',
      icon: '🔒',
      action: () => {
        onClose();
        document.dispatchEvent(new CustomEvent('command-palette:tunnel-manager'));
      },
    });

    items.push({
      id: 'action-split-horizontal',
      type: 'action',
      title: 'Split Terminal Right',
      subtitle: 'Split terminal horizontally (Ctrl+Shift+R)',
      icon: '⬛',
      action: () => {
        onClose();
        // Trigger keyboard shortcut
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', shiftKey: true, ctrlKey: true }));
      },
    });

    items.push({
      id: 'action-split-vertical',
      type: 'action',
      title: 'Split Terminal Down',
      subtitle: 'Split terminal vertically (Ctrl+Shift+D)',
      icon: '⬜',
      action: () => {
        onClose();
        // Trigger keyboard shortcut
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', shiftKey: true, ctrlKey: true }));
      },
    });

    return items;
  }, [connections, tabs, activeConnections, onConnect, onSwitchTab, onDisconnect, onClose]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return allItems;
    }

    const lowerQuery = query.toLowerCase();
    return allItems.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(lowerQuery);
      const subtitleMatch = item.subtitle?.toLowerCase().includes(lowerQuery);
      return titleMatch || subtitleMatch;
    }).sort((a, b) => {
      // Prioritize exact matches at the start
      const aStartsWithQuery = a.title.toLowerCase().startsWith(lowerQuery);
      const bStartsWithQuery = b.title.toLowerCase().startsWith(lowerQuery);
      if (aStartsWithQuery && !bStartsWithQuery) return -1;
      if (!aStartsWithQuery && bStartsWithQuery) return 1;
      return 0;
    });
  }, [allItems, query]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredItems.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : filteredItems.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filteredItems, selectedIndex, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-input-wrapper">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search connections, actions..."
          />
          <kbd className="command-palette-shortcut">ESC</kbd>
        </div>

        <div className="command-palette-list" ref={listRef}>
          {filteredItems.length === 0 ? (
            <div className="command-palette-empty">
              No results found
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <button
                key={item.id}
                className={`command-palette-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span
                  className="command-palette-icon"
                  style={item.iconColor ? { backgroundColor: item.iconColor } : undefined}
                >
                  {item.icon}
                </span>
                <div className="command-palette-item-content">
                  <span className="command-palette-item-title">{item.title}</span>
                  {item.subtitle && (
                    <span className="command-palette-item-subtitle">{item.subtitle}</span>
                  )}
                </div>
                <span className="command-palette-item-type">
                  {item.type === 'connection' ? 'Connect' : item.type === 'tab' ? 'Tab' : 'Action'}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="command-palette-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
