import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import './Homepage.css';

interface QuickLink {
  id: string;
  name: string;
  url: string;
  favicon?: string;
  color: string;
}

interface HealthCheck {
  id: string;
  name: string;
  url: string;
  expectedStatus: number;
  status: 'unknown' | 'checking' | 'up' | 'down';
  statusCode?: number;
  responseTime?: number;
  lastChecked?: string;
}

interface Note {
  id: string;
  content: string;
  color: string;
  createdAt: string;
}

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
}

interface ActiveTab {
  id: string;
  connectionId: string;
  connection: {
    name: string;
    host: string;
    username: string;
  };
  mode: string;
}

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  avatarColor?: string;
  avatarIcon?: string;
}

interface ServerAccessCount {
  connectionId: string;
  count: number;
  lastAccessed: string;
}

interface HomepageProps {
  onNavigateToConnections?: () => void;
  activeTabs?: ActiveTab[];
  onReturnToSession?: (tabId: string) => void;
  connections?: Connection[];
  onConnect?: (connection: Connection) => void;
}

const LINK_COLORS = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff', '#ff9e64', '#73daca'];
const NOTE_COLORS = ['#1a1b26', '#24283b', '#292e42', '#3b4261'];
const PRIORITY_COLORS = { low: '#9ece6a', medium: '#e0af68', high: '#f7768e' };

function Homepage({ onNavigateToConnections, activeTabs = [], onReturnToSession, connections = [], onConnect }: HomepageProps) {
  // Quick Links
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([]);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [editingLink, setEditingLink] = useState<QuickLink | null>(null);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkColor, setLinkColor] = useState(LINK_COLORS[0]);

  // Server access tracking
  const [serverAccessCounts, setServerAccessCounts] = useState<ServerAccessCount[]>([]);

  // Health Checks
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [healthName, setHealthName] = useState('');
  const [healthUrl, setHealthUrl] = useState('');
  const [healthExpectedStatus, setHealthExpectedStatus] = useState('200');

  // Quick Notes
  const [notes, setNotes] = useState<Note[]>([]);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);

  // Todo List
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [showTodoModal, setShowTodoModal] = useState(false);
  const [todoText, setTodoText] = useState('');
  const [todoPriority, setTodoPriority] = useState<'low' | 'medium' | 'high'>('medium');

  // Widget visibility
  const [widgets, setWidgets] = useState({
    frequentServers: true,
    quickLinks: true,
    healthCheck: true,
    quickNotes: true,
    todoList: true,
    clock: true,
  });

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Load data from localStorage
  useEffect(() => {
    const savedLinks = localStorage.getItem('homepage-quicklinks');
    const savedHealth = localStorage.getItem('homepage-healthchecks');
    const savedNotes = localStorage.getItem('homepage-notes');
    const savedTodos = localStorage.getItem('homepage-todos');
    const savedWidgets = localStorage.getItem('homepage-widgets');
    const savedAccessCounts = localStorage.getItem('server-access-counts');

    if (savedLinks) setQuickLinks(JSON.parse(savedLinks));
    if (savedHealth) setHealthChecks(JSON.parse(savedHealth));
    if (savedNotes) setNotes(JSON.parse(savedNotes));
    if (savedTodos) setTodos(JSON.parse(savedTodos));
    if (savedWidgets) setWidgets(prev => ({ ...prev, ...JSON.parse(savedWidgets) }));
    if (savedAccessCounts) setServerAccessCounts(JSON.parse(savedAccessCounts));
  }, []);

  // Save data to localStorage
  useEffect(() => {
    localStorage.setItem('homepage-quicklinks', JSON.stringify(quickLinks));
  }, [quickLinks]);

  useEffect(() => {
    localStorage.setItem('homepage-healthchecks', JSON.stringify(healthChecks));
  }, [healthChecks]);

  useEffect(() => {
    localStorage.setItem('homepage-notes', JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem('homepage-todos', JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    localStorage.setItem('homepage-widgets', JSON.stringify(widgets));
  }, [widgets]);

  // Health check polling via backend (bypasses CSP)
  useEffect(() => {
    const checkHealth = async () => {
      for (const check of healthChecks) {
        if (check.status === 'checking') continue;

        setHealthChecks(prev => prev.map(h =>
          h.id === check.id ? { ...h, status: 'checking' as const } : h
        ));

        try {
          const result = await window.electronAPI.healthCheck(check.url, check.expectedStatus);

          if (result.success) {
            setHealthChecks(prev => prev.map(h =>
              h.id === check.id ? {
                ...h,
                status: result.isUp ? 'up' as const : 'down' as const,
                statusCode: result.status,
                responseTime: result.responseTime,
                lastChecked: new Date().toLocaleTimeString(),
              } : h
            ));
          } else {
            setHealthChecks(prev => prev.map(h =>
              h.id === check.id ? {
                ...h,
                status: 'down' as const,
                statusCode: undefined,
                lastChecked: new Date().toLocaleTimeString(),
              } : h
            ));
          }
        } catch (err: any) {
          setHealthChecks(prev => prev.map(h =>
            h.id === check.id ? {
              ...h,
              status: 'down' as const,
              statusCode: undefined,
              lastChecked: new Date().toLocaleTimeString(),
            } : h
          ));
        }
      }
    };

    if (healthChecks.length > 0) {
      checkHealth();
      const interval = setInterval(checkHealth, 60000);
      return () => clearInterval(interval);
    }
  }, [healthChecks.length]);

  // Fetch favicon via backend (bypasses CSP)
  const fetchFavicon = async (url: string): Promise<string | undefined> => {
    try {
      const result = await window.electronAPI.fetchFavicon(url);
      if (result.success && result.data) {
        return result.data;
      }
    } catch (err) {
      console.error('Failed to fetch favicon:', err);
    }
    return undefined;
  };

  // Quick Links handlers
  const handleSaveLink = async () => {
    if (!linkName.trim() || !linkUrl.trim()) return;

    let url = linkUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    // Close modal immediately for better UX
    setShowLinkModal(false);
    const name = linkName.trim();
    const color = linkColor;
    const editing = editingLink;

    setEditingLink(null);
    setLinkName('');
    setLinkUrl('');
    setLinkColor(LINK_COLORS[0]);

    // Fetch favicon in background
    const favicon = await fetchFavicon(url);

    if (editing) {
      setQuickLinks(prev => prev.map(l =>
        l.id === editing.id ? { ...l, name, url, color, favicon } : l
      ));
    } else {
      const newLink: QuickLink = {
        id: uuidv4(),
        name,
        url,
        color,
        favicon,
      };
      setQuickLinks(prev => [...prev, newLink]);
    }
  };

  const handleEditLink = (link: QuickLink) => {
    setEditingLink(link);
    setLinkName(link.name);
    setLinkUrl(link.url);
    setLinkColor(link.color);
    setShowLinkModal(true);
  };

  const handleDeleteLink = (id: string) => {
    setQuickLinks(prev => prev.filter(l => l.id !== id));
  };

  const handleOpenLink = async (url: string) => {
    try {
      await window.electronAPI.openExternal(url);
    } catch (err) {
      console.error('Failed to open URL:', err);
    }
  };

  // Health Check handlers
  const handleSaveHealth = () => {
    if (!healthName.trim() || !healthUrl.trim()) return;

    let url = healthUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const newCheck: HealthCheck = {
      id: uuidv4(),
      name: healthName.trim(),
      url,
      expectedStatus: parseInt(healthExpectedStatus) || 200,
      status: 'unknown',
    };

    setHealthChecks(prev => [...prev, newCheck]);
    setShowHealthModal(false);
    setHealthName('');
    setHealthUrl('');
    setHealthExpectedStatus('200');
  };

  const handleDeleteHealth = (id: string) => {
    setHealthChecks(prev => prev.filter(h => h.id !== id));
  };

  const handleRefreshHealth = async (id: string) => {
    const check = healthChecks.find(h => h.id === id);
    if (!check) return;

    setHealthChecks(prev => prev.map(h =>
      h.id === id ? { ...h, status: 'checking' as const } : h
    ));

    try {
      const result = await window.electronAPI.healthCheck(check.url, check.expectedStatus);

      if (result.success) {
        setHealthChecks(prev => prev.map(h =>
          h.id === id ? {
            ...h,
            status: result.isUp ? 'up' as const : 'down' as const,
            statusCode: result.status,
            responseTime: result.responseTime,
            lastChecked: new Date().toLocaleTimeString(),
          } : h
        ));
      } else {
        setHealthChecks(prev => prev.map(h =>
          h.id === id ? {
            ...h,
            status: 'down' as const,
            statusCode: undefined,
            lastChecked: new Date().toLocaleTimeString(),
          } : h
        ));
      }
    } catch {
      setHealthChecks(prev => prev.map(h =>
        h.id === id ? {
          ...h,
          status: 'down' as const,
          lastChecked: new Date().toLocaleTimeString(),
        } : h
      ));
    }
  };

  // Notes handlers
  const handleSaveNote = () => {
    if (!noteContent.trim()) return;

    const newNote: Note = {
      id: uuidv4(),
      content: noteContent.trim(),
      color: noteColor,
      createdAt: new Date().toISOString(),
    };

    setNotes(prev => [...prev, newNote]);
    setShowNoteModal(false);
    setNoteContent('');
    setNoteColor(NOTE_COLORS[0]);
  };

  const handleDeleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  // Todo handlers
  const handleSaveTodo = () => {
    if (!todoText.trim()) return;

    const newTodo: TodoItem = {
      id: uuidv4(),
      text: todoText.trim(),
      completed: false,
      priority: todoPriority,
      createdAt: new Date().toISOString(),
    };

    setTodos(prev => [...prev, newTodo]);
    setShowTodoModal(false);
    setTodoText('');
    setTodoPriority('medium');
  };

  const handleToggleTodo = (id: string) => {
    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, completed: !t.completed } : t
    ));
  };

  const handleDeleteTodo = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  // Clock
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getGreeting = () => {
    const hour = time.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  // Sort todos by priority
  const sortedTodos = [...todos].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  // Handle server connection and track access
  const handleServerConnect = (connection: Connection) => {
    // Update access count
    const now = new Date().toISOString();
    setServerAccessCounts(prev => {
      const existing = prev.find(s => s.connectionId === connection.id);
      let updated: ServerAccessCount[];
      if (existing) {
        updated = prev.map(s =>
          s.connectionId === connection.id
            ? { ...s, count: s.count + 1, lastAccessed: now }
            : s
        );
      } else {
        updated = [...prev, { connectionId: connection.id, count: 1, lastAccessed: now }];
      }
      localStorage.setItem('server-access-counts', JSON.stringify(updated));
      return updated;
    });

    // Trigger connection
    onConnect?.(connection);
  };

  // Get frequently accessed servers (top 6, sorted by count)
  const frequentServers = connections
    .map(conn => {
      const accessData = serverAccessCounts.find(s => s.connectionId === conn.id);
      return {
        ...conn,
        accessCount: accessData?.count || 0,
        lastAccessed: accessData?.lastAccessed,
      };
    })
    .filter(conn => conn.accessCount > 0)
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, 6);

  return (
    <div className="homepage">
      <div className="homepage-header">
        <div className="greeting">
          <h1>{getGreeting()}</h1>
          <p>{time.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(true)} title="Customize Homepage">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>

      {widgets.clock && (
        <div className="clock-widget">
          <span className="clock-time">{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}

      {/* Active Sessions Banner */}
      {activeTabs.length > 0 && (
        <div className="active-sessions-banner">
          <div className="banner-content">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            <span>{activeTabs.length} active session{activeTabs.length > 1 ? 's' : ''}</span>
          </div>
          <div className="session-chips">
            {activeTabs.slice(0, 3).map(tab => (
              <button
                key={tab.id}
                className="session-chip"
                onClick={() => onReturnToSession?.(tab.id)}
              >
                <span className="chip-indicator"></span>
                <span className="chip-name">{tab.connection.name}</span>
                <span className="chip-mode">{tab.mode === 'terminal' ? 'SSH' : tab.mode === 'sftp' ? 'SFTP' : 'Dashboard'}</span>
              </button>
            ))}
            {activeTabs.length > 3 && (
              <button
                className="session-chip more"
                onClick={() => onReturnToSession?.(activeTabs[0].id)}
              >
                +{activeTabs.length - 3} more
              </button>
            )}
          </div>
        </div>
      )}

      <div className="widgets-grid">
        {/* Frequently Accessed Servers Widget */}
        {widgets.frequentServers && (frequentServers.length > 0 || connections.length > 0) && (
          <div className="widget frequent-servers-widget">
            <div className="widget-header">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                  <line x1="6" y1="6" x2="6.01" y2="6"></line>
                  <line x1="6" y1="18" x2="6.01" y2="18"></line>
                </svg>
                {frequentServers.length > 0 ? 'Frequently Accessed' : 'Quick Connect'}
              </h3>
            </div>
            <div className="frequent-servers-grid">
              {frequentServers.length > 0 ? (
                frequentServers.map(server => (
                  <button
                    key={server.id}
                    className="frequent-server"
                    onClick={() => handleServerConnect(server)}
                  >
                    <div className="server-avatar" style={{ backgroundColor: server.avatarColor || '#7aa2f7' }}>
                      {server.avatarIcon || server.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="server-info">
                      <span className="server-name">{server.name}</span>
                      <span className="server-host">{server.host}</span>
                    </div>
                    <span className="server-access-count">{server.accessCount}x</span>
                  </button>
                ))
              ) : (
                connections.slice(0, 6).map(conn => (
                  <button
                    key={conn.id}
                    className="frequent-server"
                    onClick={() => handleServerConnect(conn)}
                  >
                    <div className="server-avatar" style={{ backgroundColor: conn.avatarColor || '#7aa2f7' }}>
                      {conn.avatarIcon || conn.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="server-info">
                      <span className="server-name">{conn.name}</span>
                      <span className="server-host">{conn.host}</span>
                    </div>
                  </button>
                ))
              )}
              {frequentServers.length === 0 && connections.length === 0 && (
                <div className="empty-widget">
                  <p>No servers configured</p>
                  <button onClick={onNavigateToConnections}>Add Server</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Links Widget */}
        {widgets.quickLinks && (
          <div className="widget quick-links-widget">
            <div className="widget-header">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
                Quick Links
              </h3>
              <button className="widget-add" onClick={() => setShowLinkModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
            <div className="quick-links-grid">
              {quickLinks.map(link => (
                <div
                  key={link.id}
                  className="quick-link"
                  style={{ '--link-color': link.color } as React.CSSProperties}
                  onClick={() => handleOpenLink(link.url)}
                >
                  <div className="link-icon" style={{ backgroundColor: link.color }}>
                    {link.favicon ? (
                      <img
                        src={link.favicon}
                        alt=""
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.parentElement!.textContent = link.name.charAt(0).toUpperCase();
                        }}
                      />
                    ) : (
                      link.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="link-name">{link.name}</span>
                  <div className="link-actions">
                    <button onClick={(e) => { e.stopPropagation(); handleEditLink(link); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteLink(link.id); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              {quickLinks.length === 0 && (
                <div className="empty-widget">
                  <p>No quick links yet</p>
                  <button onClick={() => setShowLinkModal(true)}>Add Link</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Health Check Widget */}
        {widgets.healthCheck && (
          <div className="widget health-widget">
            <div className="widget-header">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                </svg>
                Health Checks
              </h3>
              <button className="widget-add" onClick={() => setShowHealthModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
            <div className="health-list">
              {healthChecks.map(check => (
                <div key={check.id} className={`health-item status-${check.status}`}>
                  <div className="health-status">
                    {check.status === 'checking' ? (
                      <div className="loading-spinner small"></div>
                    ) : check.status === 'up' ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    ) : check.status === 'down' ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                    )}
                  </div>
                  <div className="health-info">
                    <span className="health-name">{check.name}</span>
                    <span className="health-url">{check.url}</span>
                    <div className="health-meta">
                      {check.statusCode && (
                        <span className={`health-code ${check.statusCode === check.expectedStatus ? 'ok' : 'error'}`}>
                          {check.statusCode}
                        </span>
                      )}
                      {check.responseTime && <span className="health-time">{check.responseTime}ms</span>}
                      <span className="health-expected">expects {check.expectedStatus}</span>
                    </div>
                  </div>
                  <div className="health-actions">
                    <button onClick={() => handleRefreshHealth(check.id)} title="Refresh">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                      </svg>
                    </button>
                    <button onClick={() => handleDeleteHealth(check.id)} title="Remove">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              {healthChecks.length === 0 && (
                <div className="empty-widget">
                  <p>No health checks configured</p>
                  <button onClick={() => setShowHealthModal(true)}>Add Health Check</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Todo List Widget */}
        {widgets.todoList && (
          <div className="widget todo-widget">
            <div className="widget-header">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4"></path>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                </svg>
                Todo List
              </h3>
              <button className="widget-add" onClick={() => setShowTodoModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
            <div className="todo-list">
              {sortedTodos.map(todo => (
                <div
                  key={todo.id}
                  className={`todo-item ${todo.completed ? 'completed' : ''}`}
                  style={{ '--priority-color': PRIORITY_COLORS[todo.priority] } as React.CSSProperties}
                >
                  <button
                    className="todo-checkbox"
                    onClick={() => handleToggleTodo(todo.id)}
                  >
                    {todo.completed && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                  </button>
                  <span className="todo-text">{todo.text}</span>
                  <span className="todo-priority" style={{ backgroundColor: PRIORITY_COLORS[todo.priority] }}>
                    {todo.priority}
                  </span>
                  <button className="todo-delete" onClick={() => handleDeleteTodo(todo.id)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
              {todos.length === 0 && (
                <div className="empty-widget">
                  <p>No tasks yet</p>
                  <button onClick={() => setShowTodoModal(true)}>Add Task</button>
                </div>
              )}
            </div>
            {todos.length > 0 && (
              <div className="todo-summary">
                {todos.filter(t => t.completed).length}/{todos.length} completed
              </div>
            )}
          </div>
        )}

        {/* Quick Notes Widget */}
        {widgets.quickNotes && (
          <div className="widget notes-widget">
            <div className="widget-header">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
                Quick Notes
              </h3>
              <button className="widget-add" onClick={() => setShowNoteModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
            <div className="notes-list">
              {notes.map(note => (
                <div key={note.id} className="note-card" style={{ backgroundColor: note.color }}>
                  <p>{note.content}</p>
                  <div className="note-footer">
                    <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                    <button onClick={() => handleDeleteNote(note.id)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              {notes.length === 0 && (
                <div className="empty-widget">
                  <p>No notes yet</p>
                  <button onClick={() => setShowNoteModal(true)}>Add Note</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Link Modal */}
      {showLinkModal && (
        <div className="modal-overlay" onClick={() => setShowLinkModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingLink ? 'Edit Link' : 'Add Quick Link'}</h3>
              <button className="modal-close" onClick={() => setShowLinkModal(false)}>
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
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="e.g., AWS Console"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>URL</label>
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="e.g., aws.amazon.com"
                />
              </div>
              <div className="form-group">
                <label>Color (fallback if favicon unavailable)</label>
                <div className="color-picker">
                  {LINK_COLORS.map(color => (
                    <button
                      key={color}
                      className={`color-option ${linkColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setLinkColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowLinkModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveLink} disabled={!linkName.trim() || !linkUrl.trim()}>
                {editingLink ? 'Save' : 'Add Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Health Check Modal */}
      {showHealthModal && (
        <div className="modal-overlay" onClick={() => setShowHealthModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Health Check</h3>
              <button className="modal-close" onClick={() => setShowHealthModal(false)}>
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
                  value={healthName}
                  onChange={(e) => setHealthName(e.target.value)}
                  placeholder="e.g., Production API"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>URL</label>
                <input
                  type="text"
                  value={healthUrl}
                  onChange={(e) => setHealthUrl(e.target.value)}
                  placeholder="e.g., api.example.com/health"
                />
              </div>
              <div className="form-group">
                <label>Expected HTTP Status Code</label>
                <input
                  type="number"
                  value={healthExpectedStatus}
                  onChange={(e) => setHealthExpectedStatus(e.target.value)}
                  placeholder="200"
                  min="100"
                  max="599"
                />
                <span className="form-hint">Common: 200 (OK), 201 (Created), 204 (No Content)</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowHealthModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveHealth} disabled={!healthName.trim() || !healthUrl.trim()}>
                Add Health Check
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Todo Modal */}
      {showTodoModal && (
        <div className="modal-overlay" onClick={() => setShowTodoModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Task</h3>
              <button className="modal-close" onClick={() => setShowTodoModal(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Task</label>
                <input
                  type="text"
                  value={todoText}
                  onChange={(e) => setTodoText(e.target.value)}
                  placeholder="e.g., Deploy new version"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTodo(); }}
                />
              </div>
              <div className="form-group">
                <label>Priority</label>
                <div className="priority-picker">
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <button
                      key={p}
                      className={`priority-option ${todoPriority === p ? 'selected' : ''}`}
                      style={{ '--priority-color': PRIORITY_COLORS[p] } as React.CSSProperties}
                      onClick={() => setTodoPriority(p)}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowTodoModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveTodo} disabled={!todoText.trim()}>
                Add Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {showNoteModal && (
        <div className="modal-overlay" onClick={() => setShowNoteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Quick Note</h3>
              <button className="modal-close" onClick={() => setShowNoteModal(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Note</label>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write your note here..."
                  rows={4}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Background Color</label>
                <div className="color-picker">
                  {NOTE_COLORS.map(color => (
                    <button
                      key={color}
                      className={`color-option ${noteColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNoteColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowNoteModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveNote} disabled={!noteContent.trim()}>
                Add Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Customize Homepage</h3>
              <button className="modal-close" onClick={() => setShowSettings(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-section">
                <h4>Visible Widgets</h4>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={widgets.clock}
                    onChange={(e) => setWidgets(prev => ({ ...prev, clock: e.target.checked }))}
                  />
                  Clock
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={widgets.frequentServers}
                    onChange={(e) => setWidgets(prev => ({ ...prev, frequentServers: e.target.checked }))}
                  />
                  Frequently Accessed Servers
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={widgets.quickLinks}
                    onChange={(e) => setWidgets(prev => ({ ...prev, quickLinks: e.target.checked }))}
                  />
                  Quick Links
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={widgets.healthCheck}
                    onChange={(e) => setWidgets(prev => ({ ...prev, healthCheck: e.target.checked }))}
                  />
                  Health Checks
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={widgets.todoList}
                    onChange={(e) => setWidgets(prev => ({ ...prev, todoList: e.target.checked }))}
                  />
                  Todo List
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={widgets.quickNotes}
                    onChange={(e) => setWidgets(prev => ({ ...prev, quickNotes: e.target.checked }))}
                  />
                  Quick Notes
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setShowSettings(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Homepage;
