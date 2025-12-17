import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import ConnectionModal from './components/ConnectionModal';
import Terminal from './components/Terminal';
import SplitTerminal, { SplitTerminalRef } from './components/SplitTerminal';
import FileBrowser from './components/FileBrowser';
import Dashboard from './components/Dashboard';
import Homepage from './components/Homepage';
import QuickActions from './components/QuickActions';
import CommandPalette from './components/CommandPalette';
import MultiServerCommand from './components/MultiServerCommand';
import ServerHealthOverview from './components/ServerHealthOverview';
import TunnelManager from './components/TunnelManager';
import Preferences, { getPreferences, PreferencesConfig, maskIP, maskPort, maskUsername, applyTheme } from './components/Preferences';
import LocalConsole from './components/LocalConsole';
import { Connection, TabGroup } from './types/electron';
import './styles/App.css';

type ViewMode = 'terminal' | 'sftp' | 'dashboard' | 'local';

interface Tab {
  id: string;
  connectionId: string;
  connection: Connection | null; // null for local console
  mode: ViewMode;
  isConnected: boolean;
  groupId?: string;
  isLocal?: boolean; // true for personal console
}

interface TabContextMenu {
  x: number;
  y: number;
  tabId: string;
}

const GROUP_COLORS = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff', '#ff9e64', '#c0caf5'];

function App() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabGroups, setTabGroups] = useState<TabGroup[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab context menu
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupColor, setSelectedGroupColor] = useState(GROUP_COLORS[0]);
  const [contextTabForGroup, setContextTabForGroup] = useState<string | null>(null);

  // Group context menu
  const [groupContextMenu, setGroupContextMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Current paths per connection (for syncing with Dashboard Git)
  const [currentPaths, setCurrentPaths] = useState<Record<string, string>>({});

  // Quick actions popup visibility
  const [showQuickActions, setShowQuickActions] = useState(false);

  // Command palette state
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Multi-server command state
  const [showMultiServerCommand, setShowMultiServerCommand] = useState(false);

  // Server health overview state
  const [showHealthOverview, setShowHealthOverview] = useState(false);

  // Tunnel manager state
  const [showTunnelManager, setShowTunnelManager] = useState(false);

  // Preferences state
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState<PreferencesConfig>(getPreferences());

  // New tab dropdown state
  const [showNewTabDropdown, setShowNewTabDropdown] = useState(false);
  const newTabDropdownRef = useRef<HTMLDivElement>(null);

  // Dragging state
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);

  // Track if we've already auto-connected in detached mode
  const hasAutoConnected = useRef(false);

  // Store refs to SplitTerminal components for sending commands
  const splitTerminalRefs = useRef<Map<string, SplitTerminalRef>>(new Map());

  // Check if this is a detached window
  const isDetachedWindow = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('detached') === 'true';
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId) || null;

  useEffect(() => {
    loadConnections();
    loadTabGroups();
  }, []);

  // Apply saved theme on initial load
  useEffect(() => {
    applyTheme(preferences);
  }, []);

  // Restore local console tabs on app startup (main window only)
  // Disabled temporarily - user can manually open local console
  // useEffect(() => {
  //   if (isDetachedWindow) return;
  //   const savedLocalConsoles = localStorage.getItem('localConsoleTabs');
  //   if (savedLocalConsoles) {
  //     try {
  //       const count = parseInt(savedLocalConsoles, 10);
  //       if (count > 0) {
  //         const restoredTabs: Tab[] = [];
  //         for (let i = 0; i < count; i++) {
  //           const newTabId = `local-${Date.now()}-${i}`;
  //           restoredTabs.push({
  //             id: newTabId,
  //             connectionId: 'local',
  //             connection: null,
  //             mode: 'local',
  //             isConnected: true,
  //             isLocal: true,
  //           });
  //         }
  //         if (restoredTabs.length > 0) {
  //           setTabs(restoredTabs);
  //           setActiveTabId(restoredTabs[0].id);
  //         }
  //       }
  //     } catch (e) {
  //       // Ignore parse errors
  //     }
  //   }
  // }, [isDetachedWindow]);

  // Save local console tabs count when tabs change
  useEffect(() => {
    if (isDetachedWindow) return;

    const localTabCount = tabs.filter(t => t.isLocal).length;
    localStorage.setItem('localConsoleTabs', localTabCount.toString());
  }, [tabs, isDetachedWindow]);

  // Keyboard shortcuts (Ctrl+K for command palette, Ctrl+Shift+M for multi-server, Ctrl+Shift+H for health, Ctrl+Shift+T for tunnels, Ctrl+, for preferences)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        setShowMultiServerCommand(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        setShowHealthOverview(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        setShowTunnelManager(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setShowPreferences(prev => !prev);
      }
      // Ctrl+W - close active tab (prevent browser default)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          handleCloseTab(activeTabId);
        }
      }
      // Ctrl+R - prevent page reload (let terminal handle it or do nothing)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'r') {
        e.preventDefault();
        // Don't reload the page - terminal can use this shortcut
      }
      // Ctrl+Shift+Number (1-9) - switch to tab
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const tabIndex = parseInt(e.key, 10) - 1;
        if (tabIndex < tabs.length) {
          setActiveTabId(tabs[tabIndex].id);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, tabs]);

  // Listen for command palette events
  useEffect(() => {
    const handleNewConnection = () => {
      setShowCommandPalette(false);
      setIsModalOpen(true);
    };

    const handleMultiServer = () => {
      setShowCommandPalette(false);
      setShowMultiServerCommand(true);
    };

    const handleHealthOverview = () => {
      setShowCommandPalette(false);
      setShowHealthOverview(true);
    };

    const handleTunnelManager = () => {
      setShowCommandPalette(false);
      setShowTunnelManager(true);
    };

    document.addEventListener('command-palette:new-connection', handleNewConnection);
    document.addEventListener('command-palette:multi-server', handleMultiServer);
    document.addEventListener('command-palette:health-overview', handleHealthOverview);
    document.addEventListener('command-palette:tunnel-manager', handleTunnelManager);
    return () => {
      document.removeEventListener('command-palette:new-connection', handleNewConnection);
      document.removeEventListener('command-palette:multi-server', handleMultiServer);
      document.removeEventListener('command-palette:health-overview', handleHealthOverview);
      document.removeEventListener('command-palette:tunnel-manager', handleTunnelManager);
    };
  }, []);

  const loadConnections = async () => {
    try {
      const conns = await window.electronAPI.getConnections();
      setConnections(conns);
    } catch (err) {
      console.error('Failed to load connections:', err);
    }
  };

  const loadTabGroups = async () => {
    try {
      const groups = await window.electronAPI.getTabGroups();
      setTabGroups(groups);
    } catch (err) {
      console.error('Failed to load tab groups:', err);
    }
  };

  const saveTabGroups = async (groups: TabGroup[]) => {
    try {
      await window.electronAPI.saveTabGroups(groups);
    } catch (err) {
      console.error('Failed to save tab groups:', err);
    }
  };

  const handleSaveConnection = async (connection: Connection) => {
    try {
      const updatedConnections = await window.electronAPI.saveConnection(connection);
      setConnections(updatedConnections);
      setIsModalOpen(false);
      setEditingConnection(null);
    } catch (err) {
      console.error('Failed to save connection:', err);
    }
  };

  const handleReorderConnections = async (reorderedConnections: Connection[]) => {
    // Update local state immediately for responsive UI
    setConnections(reorderedConnections);

    // Persist the new order
    try {
      await window.electronAPI.saveAllConnections(reorderedConnections);
    } catch (err) {
      console.error('Failed to save connection order:', err);
    }
  };

  const handleOpenLocalConsole = () => {
    // Check if local console tab already exists
    const existingLocalTab = tabs.find(t => t.isLocal);
    if (existingLocalTab) {
      // Just switch to the existing tab
      setActiveTabId(existingLocalTab.id);
      return;
    }

    // Create new local console tab
    const tabId = `local-${Date.now()}`;
    const newTab: Tab = {
      id: tabId,
      connectionId: 'local',
      connection: null,
      mode: 'local',
      isConnected: true,
      isLocal: true,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  const handleDeleteConnection = async (id: string) => {
    try {
      const updatedConnections = await window.electronAPI.deleteConnection(id);
      setConnections(updatedConnections);

      // Close all tabs for this connection
      const tabsToClose = tabs.filter(t => t.connectionId === id);
      for (const tab of tabsToClose) {
        await window.electronAPI.disconnect(tab.connectionId);
      }
      setTabs(prev => prev.filter(t => t.connectionId !== id));

      if (activeTabId && tabsToClose.some(t => t.id === activeTabId)) {
        const remainingTabs = tabs.filter(t => t.connectionId !== id);
        setActiveTabId(remainingTabs.length > 0 ? remainingTabs[0].id : null);
      }
    } catch (err) {
      console.error('Failed to delete connection:', err);
    }
  };

  const handleConnect = useCallback(async (connection: Connection, mode: ViewMode = 'terminal') => {
    // Check if already connected to this server
    const existingTab = tabs.find(t => t.connectionId === connection.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      await window.electronAPI.connect(connection.id);

      const newTab: Tab = {
        id: `${connection.id}-${Date.now()}`,
        connectionId: connection.id,
        connection,
        mode,
        isConnected: true,
      };

      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
      console.error('Connection failed:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [tabs]);

  // Handle detached window mode - auto-connect from URL params
  useEffect(() => {
    if (hasAutoConnected.current) return;

    const urlParams = new URLSearchParams(window.location.search);
    const connectionId = urlParams.get('connectionId');
    const mode = urlParams.get('mode') as ViewMode || 'terminal';
    const isDetached = urlParams.get('detached') === 'true';

    if (isDetached && connectionId) {
      // Handle local console in detached window
      if (connectionId === 'local' && mode === 'local') {
        hasAutoConnected.current = true;
        const newTabId = `local-${Date.now()}`;
        const newTab: Tab = {
          id: newTabId,
          connectionId: 'local',
          connection: null,
          mode: 'local',
          isConnected: true,
          isLocal: true,
        };
        setTabs([newTab]);
        setActiveTabId(newTabId);
        return;
      }

      // Handle SSH connection
      if (connections.length > 0) {
        const connection = connections.find(c => c.id === connectionId);
        if (connection) {
          hasAutoConnected.current = true;
          handleConnect(connection, mode);
        }
      }
    }
  }, [connections, handleConnect]);

  const handleCloseTab = async (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Check if this is the last tab for this connection
    const otherTabsForConnection = tabs.filter(t => t.connectionId === tab.connectionId && t.id !== tabId);
    if (otherTabsForConnection.length === 0) {
      await window.electronAPI.disconnect(tab.connectionId);
    }

    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId === tabId) {
      // Switch to another tab
      const tabIndex = tabs.findIndex(t => t.id === tabId);
      const newActiveTab = newTabs[Math.min(tabIndex, newTabs.length - 1)];
      setActiveTabId(newActiveTab?.id || null);
    }
  };

  const handleSwitchMode = (mode: ViewMode, openInNewTab: boolean = false) => {
    if (!activeTab) return;

    if (openInNewTab) {
      // Open in a new tab - don't change current tab
      const newTab: Tab = {
        ...activeTab,
        id: `${activeTab.connectionId}-${Date.now()}`,
        mode,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      // Don't update current tab's mode
      return;
    }

    // Switch mode in current tab
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, mode } : t
    ));
  };

  const handleEditConnection = (connection: Connection) => {
    setEditingConnection(connection);
    setIsModalOpen(true);
  };

  const handleNewConnection = () => {
    setEditingConnection(null);
    setIsModalOpen(true);
  };

  // Command palette handlers
  const handleCommandPaletteConnect = useCallback((connectionId: string, mode?: 'terminal' | 'files' | 'dashboard') => {
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return;

    // Map 'files' to 'sftp' for internal mode
    const viewMode: ViewMode = mode === 'files' ? 'sftp' : mode === 'dashboard' ? 'dashboard' : 'terminal';
    handleConnect(connection, viewMode);
  }, [connections, handleConnect]);

  const handleCommandPaletteDisconnect = useCallback(async (connectionId: string) => {
    const tabsToClose = tabs.filter(t => t.connectionId === connectionId);
    for (const tab of tabsToClose) {
      await handleCloseTab(tab.id);
    }
  }, [tabs]);

  const getActiveConnectionIds = () => {
    return [...new Set(tabs.map(t => t.connectionId))];
  };

  // Context menu handlers
  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // Click outside to close context menu
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the context menu
      if (target.closest('.tab-context-menu')) {
        return;
      }
      closeContextMenu();
    };
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // Duplicate tab
  const handleDuplicateTab = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // For local console, create a new local console tab (new shell instance)
    if (tab.isLocal) {
      const newTabId = `local-${Date.now()}`;
      const newTab: Tab = {
        id: newTabId,
        connectionId: 'local',
        connection: null,
        mode: 'local',
        isConnected: true,
        isLocal: true,
        groupId: tab.groupId,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTabId);
      closeContextMenu();
      return;
    }

    const newTab: Tab = {
      ...tab,
      id: `${tab.connectionId}-${Date.now()}`,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    closeContextMenu();
  };

  // Open in new window
  const handleOpenInNewWindow = async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      await window.electronAPI.createNewWindow(tab.connectionId, tab.mode);
      closeContextMenu();
    } catch (err) {
      console.error('Failed to open in new window:', err);
    }
  };

  // Tab groups
  const handleCreateGroup = (tabId: string) => {
    setContextTabForGroup(tabId);
    setShowGroupModal(true);
    closeContextMenu();
  };

  const handleSaveGroup = () => {
    if (!newGroupName.trim() || !contextTabForGroup) return;

    const newGroup: TabGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      color: selectedGroupColor,
      collapsed: false,
    };

    const newGroups = [...tabGroups, newGroup];
    setTabGroups(newGroups);
    saveTabGroups(newGroups);

    setTabs(prev => prev.map(t =>
      t.id === contextTabForGroup ? { ...t, groupId: newGroup.id } : t
    ));

    setShowGroupModal(false);
    setNewGroupName('');
    setContextTabForGroup(null);
  };

  const handleAddToGroup = (tabId: string, groupId: string) => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, groupId } : t
    ));
    closeContextMenu();
  };

  const handleRemoveFromGroup = (tabId: string) => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, groupId: undefined } : t
    ));
    closeContextMenu();
  };

  // Group context menu
  const handleGroupContextMenu = (e: React.MouseEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setGroupContextMenu({ groupId, x: e.clientX, y: e.clientY });
  };

  const closeGroupContextMenu = () => setGroupContextMenu(null);

  // Click outside to close group context menu
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.group-context-menu')) return;
      closeGroupContextMenu();
    };
    if (groupContextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [groupContextMenu]);

  // Click outside to close new tab dropdown
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (newTabDropdownRef.current && !newTabDropdownRef.current.contains(target)) {
        setShowNewTabDropdown(false);
      }
    };
    if (showNewTabDropdown) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showNewTabDropdown]);

  // Handle preferences change
  const handlePreferencesChange = (prefs: PreferencesConfig) => {
    setPreferences(prefs);
    // Apply all theme settings to CSS variables
    applyTheme(prefs);
  };

  const handleSaveGroupsNow = () => {
    saveTabGroups(tabGroups);
    closeGroupContextMenu();
  };

  const handleRenameGroup = (groupId: string) => {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    const newName = prompt('Enter new group name:', group.name);
    if (newName && newName.trim()) {
      const newGroups = tabGroups.map(g =>
        g.id === groupId ? { ...g, name: newName.trim() } : g
      );
      setTabGroups(newGroups);
      saveTabGroups(newGroups);
    }
    closeGroupContextMenu();
  };

  const handleToggleGroupCollapse = (groupId: string) => {
    setTabGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
    ));
  };

  const handleDeleteGroup = (groupId: string) => {
    setTabs(prev => prev.map(t =>
      t.groupId === groupId ? { ...t, groupId: undefined } : t
    ));
    const newGroups = tabGroups.filter(g => g.id !== groupId);
    setTabGroups(newGroups);
    saveTabGroups(newGroups);
    closeGroupContextMenu();
  };

  // Tab dragging
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [dragOverUngrouped, setDragOverUngrouped] = useState(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    setDraggedTab(tabId);
    e.dataTransfer.effectAllowed = 'move';
    // Store initial position for detecting drag outside window
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    if (draggedTab && draggedTab !== tabId) {
      setDragOverTab(tabId);
    }
  };

  const handleDragLeave = () => {
    setDragOverTab(null);
  };

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    if (!draggedTab || draggedTab === targetTabId) return;

    const draggedIndex = tabs.findIndex(t => t.id === draggedTab);
    const targetIndex = tabs.findIndex(t => t.id === targetTabId);
    const targetTab = tabs.find(t => t.id === targetTabId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newTabs = [...tabs];
    const [draggedItem] = newTabs.splice(draggedIndex, 1);

    // Update group membership to match target tab's group
    draggedItem.groupId = targetTab?.groupId;

    newTabs.splice(targetIndex, 0, draggedItem);

    setTabs(newTabs);
    setDraggedTab(null);
    setDragOverTab(null);
    setDragOverGroup(null);
    setDragOverUngrouped(false);
  };

  // Drop on group header
  const handleGroupDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    if (draggedTab) {
      setDragOverGroup(groupId);
    }
  };

  const handleGroupDragLeave = () => {
    setDragOverGroup(null);
  };

  const handleGroupDrop = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    if (!draggedTab) return;

    setTabs(prev => prev.map(t =>
      t.id === draggedTab ? { ...t, groupId } : t
    ));

    setDraggedTab(null);
    setDragOverGroup(null);
  };

  // Drop on ungrouped area
  const handleUngroupedDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedTab) {
      setDragOverUngrouped(true);
    }
  };

  const handleUngroupedDragLeave = () => {
    setDragOverUngrouped(false);
  };

  const handleUngroupedDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedTab) return;

    setTabs(prev => prev.map(t =>
      t.id === draggedTab ? { ...t, groupId: undefined } : t
    ));

    setDraggedTab(null);
    setDragOverUngrouped(false);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    // Check if dropped outside the window
    if (draggedTab) {
      const tab = tabs.find(t => t.id === draggedTab);

      // Check if the drop position is outside the window bounds
      const isOutsideWindow =
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight;

      if (isOutsideWindow && tab && (tab.connection || tab.isLocal)) {
        // Open in new window (works for both SSH and local console)
        window.electronAPI.createNewWindow(tab.connectionId, tab.mode);

        // Close the tab in the current window
        handleCloseTab(tab.id);
      }
    }

    setDraggedTab(null);
    setDragOverTab(null);
    setDragOverGroup(null);
    setDragOverUngrouped(false);
    dragStartPos.current = null;
  };

  // Update current path (called from FileBrowser)
  const handlePathChange = (connectionId: string, path: string) => {
    setCurrentPaths(prev => ({ ...prev, [connectionId]: path }));
  };

  // Group tabs by group
  const getGroupedTabs = () => {
    const ungroupedTabs = tabs.filter(t => !t.groupId);
    const groupedTabs: { group: TabGroup; tabs: Tab[] }[] = [];

    tabGroups.forEach(group => {
      const groupTabs = tabs.filter(t => t.groupId === group.id);
      if (groupTabs.length > 0) {
        groupedTabs.push({ group, tabs: groupTabs });
      }
    });

    return { ungroupedTabs, groupedTabs };
  };

  return (
    <div className="app">
      <TitleBar
        onOpenPreferences={() => setShowPreferences(true)}
        onOpenShortcuts={() => setShowPreferences(true)}
      />
      <div className="app-content">
        {!isDetachedWindow && (
          <>
            <Sidebar
              connections={connections}
              activeConnectionIds={getActiveConnectionIds()}
              onConnect={handleConnect}
              onEdit={handleEditConnection}
              onDelete={handleDeleteConnection}
              onNewConnection={handleNewConnection}
              onUpdateConnection={handleSaveConnection}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
              showHomeButton={tabs.length > 0}
              onGoHome={() => setActiveTabId(null)}
              preferences={preferences}
              onOpenLocalConsole={handleOpenLocalConsole}
              isLocalConsoleActive={tabs.some(t => t.isLocal && t.id === activeTabId)}
              onReorderConnections={handleReorderConnections}
            />
          </>
        )}
        <main className="main-content">
          {tabs.length > 0 && activeTabId ? (
            <>
              {/* Tabs Bar */}
              <div className="tabs-bar">
                <div className="tabs-bar-inner">
                <div className="tabs-container">
                  {/* Render grouped tabs first */}
                  {getGroupedTabs().groupedTabs.map(({ group, tabs: groupTabs }) => (
                    <div key={group.id} className="tab-group" style={{ '--group-color': group.color } as React.CSSProperties}>
                      <div
                        className={`tab-group-header ${dragOverGroup === group.id ? 'drag-over' : ''}`}
                        onClick={() => handleToggleGroupCollapse(group.id)}
                        onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
                        onDragOver={(e) => handleGroupDragOver(e, group.id)}
                        onDragLeave={handleGroupDragLeave}
                        onDrop={(e) => handleGroupDrop(e, group.id)}
                      >
                        <span className="group-indicator" style={{ backgroundColor: group.color }}></span>
                        <span className="group-name">{group.name}</span>
                        <span className="group-count">{groupTabs.length}</span>
                        <button
                          className="group-delete"
                          onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }}
                          title="Delete group"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </div>
                      {!group.collapsed && groupTabs.map(tab => (
                        <div
                          key={tab.id}
                          className={`tab grouped ${activeTabId === tab.id ? 'active' : ''} ${dragOverTab === tab.id ? 'drag-over' : ''}`}
                          onClick={() => setActiveTabId(tab.id)}
                          onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                          draggable
                          onDragStart={(e) => handleDragStart(e, tab.id)}
                          onDragOver={(e) => handleDragOver(e, tab.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, tab.id)}
                          onDragEnd={(e) => handleDragEnd(e)}
                        >
                          <span className="tab-indicator"></span>
                          <span className="tab-name">{tab.isLocal ? 'Personal Console' : tab.connection?.name}</span>
                          <span className="tab-mode">{tab.isLocal ? 'Local' : tab.mode === 'terminal' ? 'SSH' : tab.mode === 'sftp' ? 'SFTP' : 'Dashboard'}</span>
                          <button
                            className="tab-close"
                            onClick={(e) => handleCloseTab(tab.id, e)}
                            title="Close tab"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* Render ungrouped tabs with drop zone */}
                  <div
                    className={`ungrouped-tabs ${dragOverUngrouped ? 'drag-over' : ''}`}
                    onDragOver={handleUngroupedDragOver}
                    onDragLeave={handleUngroupedDragLeave}
                    onDrop={handleUngroupedDrop}
                  >
                    {getGroupedTabs().ungroupedTabs.map(tab => (
                      <div
                        key={tab.id}
                        className={`tab ${activeTabId === tab.id ? 'active' : ''} ${dragOverTab === tab.id ? 'drag-over' : ''}`}
                        onClick={() => setActiveTabId(tab.id)}
                        onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                        draggable
                        onDragStart={(e) => handleDragStart(e, tab.id)}
                        onDragOver={(e) => handleDragOver(e, tab.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, tab.id)}
                        onDragEnd={(e) => handleDragEnd(e)}
                      >
                        <span className="tab-indicator"></span>
                        <span className="tab-name">{tab.isLocal ? 'Personal Console' : tab.connection?.name}</span>
                        <span className="tab-mode">{tab.isLocal ? 'Local' : tab.mode === 'terminal' ? 'SSH' : tab.mode === 'sftp' ? 'SFTP' : 'Dashboard'}</span>
                        <button
                          className="tab-close"
                          onClick={(e) => handleCloseTab(tab.id, e)}
                          title="Close tab"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* New Tab Dropdown */}
                <div className="new-tab-wrapper" ref={newTabDropdownRef}>
                  <button
                    className="new-tab-btn"
                    onClick={() => setShowNewTabDropdown(prev => !prev)}
                    title="Open connection in new tab"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                  {showNewTabDropdown && (
                    <div className="new-tab-dropdown">
                      <div className="dropdown-header">Select Connection</div>
                      <div className="dropdown-list">
                        {connections.length === 0 ? (
                          <div className="dropdown-empty">No saved connections</div>
                        ) : (
                          connections.map(conn => (
                            <button
                              key={conn.id}
                              className="dropdown-item"
                              onClick={() => {
                                handleConnect(conn, 'terminal');
                                setShowNewTabDropdown(false);
                              }}
                            >
                              <span className="dropdown-item-dot" style={{ backgroundColor: conn.avatarColor || '#7aa2f7' }}></span>
                              <span className="dropdown-item-name">{conn.name}</span>
                              <span className="dropdown-item-host">
                                {maskIP(conn.host, preferences.hideIPs)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                </div>
              </div>

              {/* Tab Context Menu */}
              {contextMenu && (() => {
                const contextTab = tabs.find(t => t.id === contextMenu.tabId);
                const isLocalTab = contextTab?.isLocal;
                return (
                <div
                  className="tab-context-menu"
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button onClick={() => handleDuplicateTab(contextMenu.tabId)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                    {isLocalTab ? 'New Console Tab' : 'Duplicate Tab'}
                  </button>
                  <button onClick={() => handleOpenInNewWindow(contextMenu.tabId)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    Open in New Window
                  </button>
                  {isLocalTab && (
                    <button onClick={() => {
                      const path = prompt('Enter the starting path for new consoles:', '');
                      if (path) {
                        window.electronAPI.localSavePath(path).then(result => {
                          if (result.success) {
                            alert('Path saved! New consoles will start in: ' + result.path);
                          } else {
                            alert('Error: ' + (result.error || 'Invalid path'));
                          }
                        });
                      }
                      closeContextMenu();
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                      </svg>
                      Set Starting Path
                    </button>
                  )}
                  <div className="context-menu-separator"></div>
                  <button onClick={() => handleCreateGroup(contextMenu.tabId)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7"/>
                      <rect x="14" y="3" width="7" height="7"/>
                      <rect x="14" y="14" width="7" height="7"/>
                      <rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    Create Group
                  </button>
                  {tabGroups.length > 0 && (
                    <>
                      <div className="context-menu-separator"></div>
                      <div className="context-menu-submenu">
                        <span className="submenu-label">Add to Group</span>
                        {tabGroups.map(group => (
                          <button
                            key={group.id}
                            onClick={() => handleAddToGroup(contextMenu.tabId, group.id)}
                          >
                            <span className="group-color-dot" style={{ backgroundColor: group.color }}></span>
                            {group.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {tabs.find(t => t.id === contextMenu.tabId)?.groupId && (
                    <button onClick={() => handleRemoveFromGroup(contextMenu.tabId)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                      Remove from Group
                    </button>
                  )}
                  <div className="context-menu-separator"></div>
                  <button className="danger" onClick={() => { handleCloseTab(contextMenu.tabId); closeContextMenu(); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    Close Tab
                  </button>
                </div>
                );
              })()}

              {/* Group Context Menu */}
              {groupContextMenu && (
                <div
                  className="group-context-menu tab-context-menu"
                  style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button onClick={handleSaveGroupsNow}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/>
                      <polyline points="7 3 7 8 15 8"/>
                    </svg>
                    Save Groups
                  </button>
                  <button onClick={() => handleRenameGroup(groupContextMenu.groupId)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Rename Group
                  </button>
                  <div className="context-menu-separator"></div>
                  <button className="danger" onClick={() => handleDeleteGroup(groupContextMenu.groupId)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    Delete Group
                  </button>
                </div>
              )}

              {activeTab && (
                <>
                  <div className={`session-header ${activeTab.isLocal ? 'local-console-header' : ''}`}>
                    <div className="session-info">
                      <span className={`session-name ${activeTab.isLocal ? 'local-name' : ''}`}>
                        {activeTab.isLocal ? 'Personal Console' : activeTab.connection?.name}
                      </span>
                      <span className="session-host">
                        {activeTab.isLocal
                          ? 'Local Terminal'
                          : `${maskUsername(activeTab.connection?.username || '', preferences.hideUsernames)}@${maskIP(activeTab.connection?.host || '', preferences.hideIPs)}${preferences.hidePorts ? '' : `:${activeTab.connection?.port}`}`
                        }
                      </span>
                    </div>
                    <div className="session-controls">
                      {!activeTab.isLocal && (
                        <>
                          <button
                            className={`quick-actions-toggle ${showQuickActions ? 'active' : ''}`}
                            onClick={() => setShowQuickActions(!showQuickActions)}
                            title="Quick Actions"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                            </svg>
                          </button>
                          <div className="mode-switcher">
                            <button
                              className={`mode-btn ${activeTab.mode === 'terminal' ? 'active' : ''}`}
                              onClick={(e) => handleSwitchMode('terminal', e.ctrlKey || e.metaKey)}
                              title="Terminal (Ctrl+Click to open in new tab)"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="4 17 10 11 4 5"></polyline>
                                <line x1="12" y1="19" x2="20" y2="19"></line>
                              </svg>
                              Terminal
                            </button>
                            <button
                              className={`mode-btn ${activeTab.mode === 'sftp' ? 'active' : ''}`}
                              onClick={(e) => handleSwitchMode('sftp', e.ctrlKey || e.metaKey)}
                              title="Files (Ctrl+Click to open in new tab)"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                              </svg>
                              Files
                            </button>
                            <button
                              className={`mode-btn ${activeTab.mode === 'dashboard' ? 'active' : ''}`}
                              onClick={(e) => handleSwitchMode('dashboard', e.ctrlKey || e.metaKey)}
                              title="Dashboard (Ctrl+Click to open in new tab)"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                              </svg>
                              Dashboard
                            </button>
                          </div>
                          <button className="disconnect-btn" onClick={() => handleCloseTab(activeTab.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                              <line x1="12" y1="2" x2="12" y2="12"></line>
                            </svg>
                            Disconnect
                          </button>
                        </>
                      )}
                      {activeTab.isLocal && (
                        <button className="close-console-btn" onClick={() => handleCloseTab(activeTab.id)} title="Close Console">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="session-content">
                    {tabs.map(tab => (
                      <div
                        key={tab.id}
                        className="tab-content"
                        style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
                      >
                        {/* Local Console */}
                        {tab.isLocal && (
                          <LocalConsole onClose={() => handleCloseTab(tab.id)} />
                        )}
                        {/* SSH Connection Content */}
                        {!tab.isLocal && (
                          <>
                            {/* Always render Terminal to keep connection alive - using SplitTerminal for split support */}
                            <div style={{ display: tab.mode === 'terminal' ? 'flex' : 'none', flex: 1 }}>
                              <SplitTerminal
                                ref={(splitRef) => {
                                  if (splitRef) {
                                    splitTerminalRefs.current.set(tab.id, splitRef);
                                  } else {
                                    splitTerminalRefs.current.delete(tab.id);
                                  }
                                }}
                                connectionId={tab.connectionId}
                              />
                            </div>
                            {/* Render FileBrowser on demand */}
                            {(tab.mode === 'sftp' || tab.id === activeTabId) && (
                              <div style={{ display: tab.mode === 'sftp' ? 'flex' : 'none', flex: 1 }}>
                                <FileBrowser
                                  connectionId={tab.connectionId}
                                  onPathChange={(path) => handlePathChange(tab.connectionId, path)}
                                  onOpenTerminal={(path) => {
                                    // Switch to terminal mode
                                    setTabs(prev => prev.map(t =>
                                      t.id === tab.id ? { ...t, mode: 'terminal' as ViewMode } : t
                                    ));
                                    // Send cd command to terminal after a short delay for mode switch
                                    setTimeout(() => {
                                      const splitTerminalRef = splitTerminalRefs.current.get(tab.id);
                                      if (splitTerminalRef) {
                                        splitTerminalRef.sendCommand(`cd "${path}"\n`);
                                      }
                                    }, 100);
                                  }}
                                />
                              </div>
                            )}
                            {/* Render Dashboard on demand */}
                            {(tab.mode === 'dashboard' || tab.id === activeTabId) && (
                              <div style={{ display: tab.mode === 'dashboard' ? 'flex' : 'none', flex: 1 }}>
                                <Dashboard
                                  connectionId={tab.connectionId}
                                  currentPath={currentPaths[tab.connectionId] || '/'}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Quick Actions Popup - only for SSH connections */}
                  {showQuickActions && activeTab && !activeTab.isLocal && (
                    <QuickActions
                      connectionId={activeTab.connectionId}
                      onExecute={(cmd) => window.electronAPI.write(activeTab.connectionId, cmd + '\n')}
                      onClose={() => setShowQuickActions(false)}
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <Homepage
              activeTabs={tabs}
              onReturnToSession={(tabId) => setActiveTabId(tabId)}
              connections={connections}
              onConnect={(conn) => handleConnect(conn, 'terminal')}
            />
          )}
        </main>
      </div>

      {isModalOpen && (
        <ConnectionModal
          connection={editingConnection}
          onSave={handleSaveConnection}
          onClose={() => {
            setIsModalOpen(false);
            setEditingConnection(null);
          }}
        />
      )}

      {/* Group Creation Modal */}
      {showGroupModal && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal-content group-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Tab Group</h3>
              <button className="modal-close" onClick={() => setShowGroupModal(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Group Name</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Enter group name"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGroup(); }}
                />
              </div>
              <div className="form-group">
                <label>Color</label>
                <div className="color-picker">
                  {GROUP_COLORS.map(color => (
                    <button
                      key={color}
                      className={`color-option ${selectedGroupColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setSelectedGroupColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowGroupModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveGroup} disabled={!newGroupName.trim()}>
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        connections={connections}
        tabs={tabs.map(t => ({ id: t.id, connectionId: t.connectionId, mode: t.mode === 'sftp' ? 'files' : t.mode }))}
        onConnect={handleCommandPaletteConnect}
        onSwitchTab={setActiveTabId}
        onDisconnect={handleCommandPaletteDisconnect}
        activeConnections={getActiveConnectionIds()}
      />

      {/* Multi-Server Command */}
      <MultiServerCommand
        isOpen={showMultiServerCommand}
        onClose={() => setShowMultiServerCommand(false)}
        connections={connections}
        activeConnectionIds={getActiveConnectionIds()}
      />

      {/* Server Health Overview */}
      <ServerHealthOverview
        isOpen={showHealthOverview}
        onClose={() => setShowHealthOverview(false)}
        connections={connections}
        activeConnectionIds={getActiveConnectionIds()}
        onConnect={(connectionId) => {
          const connection = connections.find(c => c.id === connectionId);
          if (connection) {
            handleConnect(connection, 'terminal');
            setShowHealthOverview(false);
          }
        }}
      />

      {/* Tunnel Manager */}
      <TunnelManager
        isOpen={showTunnelManager}
        onClose={() => setShowTunnelManager(false)}
        connections={connections}
        activeConnectionIds={getActiveConnectionIds()}
      />

      {/* Preferences */}
      <Preferences
        isOpen={showPreferences}
        onClose={() => setShowPreferences(false)}
        onPreferencesChange={handlePreferencesChange}
      />
    </div>
  );
}

export default App;
