import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

interface LocalConsoleProps {
  onClose?: () => void;
}

function LocalConsole({ onClose }: LocalConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shellIdRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shellClosed, setShellClosed] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Save path state
  const [showSavePath, setShowSavePath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [savedPath, setSavedPath] = useState<string>('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const containerRect = terminalRef.current.getBoundingClientRect();

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      rows: Math.max(10, Math.floor((containerRect.height - 16) / 17)),
      cols: Math.max(40, Math.floor((containerRect.width - 16) / 8.4)),
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        cursorAccent: '#1a1b26',
        selectionBackground: '#33467c',
        selectionForeground: '#c0caf5',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
      allowTransparency: false,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    term.open(terminalRef.current);

    // Custom key handler for copy/paste
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Let app-level shortcuts pass through (Ctrl+Shift+M/H/T, Ctrl+K, Ctrl+,)
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'M' || e.key === 'm' || e.key === 'H' || e.key === 'h' || e.key === 'T' || e.key === 't')) {
        return true;
      }
      if (isCtrlOrCmd && (e.key === 'k' || e.key === 'K' || e.key === ',')) {
        return true;
      }

      // Ctrl+Shift+C - Copy
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        const selection = term.getSelection();
        if (selection) {
          e.preventDefault();
          navigator.clipboard.writeText(selection);
          return false;
        }
        return false;
      }

      // Ctrl+Shift+V - Paste
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text && shellIdRef.current) {
            window.electronAPI.localWrite(shellIdRef.current, text);
          }
        });
        return false;
      }

      return true;
    });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      if (!fitAddonRef.current || !xtermRef.current || !terminalRef.current) return;

      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) return;

      try {
        fitAddonRef.current.fit();

        const cols = xtermRef.current.cols;
        const rows = xtermRef.current.rows;
        if (cols > 0 && rows > 0 && shellIdRef.current) {
          window.electronAPI.localResize(shellIdRef.current, cols, rows);
        }
      } catch (e) {
        // Ignore fit errors
      }
    };

    const debouncedResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 100);
    };

    setTimeout(() => {
      handleResize();
      initializeShell();
    }, 150);

    window.addEventListener('resize', debouncedResize);

    const resizeObserver = new ResizeObserver(() => {
      debouncedResize();
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // Handle terminal input
    term.onData((data) => {
      if (shellIdRef.current) {
        window.electronAPI.localWrite(shellIdRef.current, data);
      }
    });

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', debouncedResize);
      resizeObserver.disconnect();
      if (shellIdRef.current) {
        window.electronAPI.localShellClose(shellIdRef.current);
        shellIdRef.current = null;
      }
      term.dispose();
    };
  }, []);

  const initializeShell = async () => {
    try {
      const result = await window.electronAPI.localShell();
      shellIdRef.current = result.shellId;
      setIsReady(true);

      const removeDataListener = window.electronAPI.onLocalData(result.shellId, (data) => {
        if (xtermRef.current) {
          xtermRef.current.write(data);
        }
      });

      const removeCloseListener = window.electronAPI.onLocalClose(result.shellId, (code) => {
        if (xtermRef.current) {
          xtermRef.current.write(`\r\n\x1b[31mShell closed with code ${code}.\x1b[0m\r\n`);
        }
        shellIdRef.current = null;
        setShellClosed(true);
      });

      if (xtermRef.current && fitAddonRef.current) {
        fitAddonRef.current.fit();
        window.electronAPI.localResize(
          result.shellId,
          xtermRef.current.cols,
          xtermRef.current.rows
        );
      }

      return () => {
        removeDataListener();
        removeCloseListener();
      };
    } catch (err: any) {
      setError(err.message || 'Failed to start local shell');
    }
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    setShellClosed(false);
    setError(null);

    try {
      if (xtermRef.current) {
        xtermRef.current.write('\r\n\x1b[33mRestarting shell...\x1b[0m\r\n');
      }
      await initializeShell();
    } catch (err: any) {
      setError(err.message || 'Failed to restart shell');
      setShellClosed(true);
    } finally {
      setIsReconnecting(false);
    }
  };

  // Search functions
  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    if (!searchAddonRef.current || !searchTerm) return;

    const options = { caseSensitive: false, wholeWord: false, regex: false };
    if (direction === 'next') {
      searchAddonRef.current.findNext(searchTerm, options);
    } else {
      searchAddonRef.current.findPrevious(searchTerm, options);
    }
  }, [searchTerm]);

  const toggleSearch = useCallback(() => {
    setShowSearch(prev => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        searchAddonRef.current?.clearDecorations();
        xtermRef.current?.focus();
      }
      return !prev;
    });
  }, []);

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchTerm('');
    searchAddonRef.current?.clearDecorations();
    xtermRef.current?.focus();
  }, []);

  // Save path functions - must be defined before handleContainerKeyDown
  const toggleSavePath = useCallback(() => {
    setShowSavePath(prev => {
      if (!prev) {
        setTimeout(() => pathInputRef.current?.focus(), 50);
      } else {
        xtermRef.current?.focus();
      }
      return !prev;
    });
  }, []);

  const handleSavePath = useCallback(async () => {
    if (!pathInput.trim()) return;

    const result = await window.electronAPI.localSavePath(pathInput.trim());
    if (result.success) {
      setSavedPath(result.path || pathInput.trim());
      setSaveMessage('Path saved! New consoles will start here.');
      setShowSavePath(false);
      xtermRef.current?.focus();
    } else {
      setSaveMessage(`Error: ${result.error || 'Invalid path'}`);
    }

    setTimeout(() => setSaveMessage(null), 3000);
  }, [pathInput]);

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    if (isCtrlOrCmd && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      toggleSearch();
      return;
    }

    // Ctrl+Shift+S - Save path
    if (isCtrlOrCmd && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      toggleSavePath();
      return;
    }

    if (e.key === 'Escape') {
      if (showSearch) closeSearch();
      if (showSavePath) {
        setShowSavePath(false);
        xtermRef.current?.focus();
      }
    }
  }, [toggleSearch, closeSearch, showSearch, toggleSavePath, showSavePath]);

  useEffect(() => {
    if (searchTerm && searchAddonRef.current) {
      searchAddonRef.current.findNext(searchTerm, { caseSensitive: false, wholeWord: false, regex: false });
    }
  }, [searchTerm]);

  // Load saved path on mount
  useEffect(() => {
    window.electronAPI.localGetSavedPath().then(path => {
      setSavedPath(path);
      setPathInput(path);
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      onKeyDownCapture={handleContainerKeyDown}
      tabIndex={-1}
    >
      {/* Search Bar */}
      {showSearch && (
        <div className="terminal-search-bar">
          <div className="search-input-wrapper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className="search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(e.shiftKey ? 'prev' : 'next');
                }
                if (e.key === 'Escape') {
                  closeSearch();
                }
              }}
              placeholder="Search in terminal..."
            />
          </div>
          <div className="search-buttons">
            <button
              className="search-nav-btn"
              onClick={() => handleSearch('prev')}
              title="Previous match (Shift+Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
            </button>
            <button
              className="search-nav-btn"
              onClick={() => handleSearch('next')}
              title="Next match (Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <button
              className="search-close-btn"
              onClick={closeSearch}
              title="Close (Escape)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Save Path Bar */}
      {showSavePath && (
        <div className="terminal-search-bar save-path-bar">
          <div className="search-input-wrapper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <input
              ref={pathInputRef}
              type="text"
              className="search-input"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSavePath();
                }
                if (e.key === 'Escape') {
                  setShowSavePath(false);
                  xtermRef.current?.focus();
                }
              }}
              placeholder="Enter path to save as default..."
            />
          </div>
          <div className="search-buttons">
            <button
              className="search-nav-btn save-path-btn"
              onClick={handleSavePath}
              title="Save path"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
            </button>
            <button
              className="search-close-btn"
              onClick={() => { setShowSavePath(false); xtermRef.current?.focus(); }}
              title="Close (Escape)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Save Message Toast */}
      {saveMessage && (
        <div className={`terminal-toast ${saveMessage.startsWith('Error') ? 'error' : 'success'}`}>
          {saveMessage}
        </div>
      )}

      {error && (
        <div className="terminal-error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>{error}</span>
        </div>
      )}
      {!isReady && !error && !shellClosed && (
        <div className="terminal-loading">
          <div className="loading-spinner"></div>
          <span>Starting local shell...</span>
        </div>
      )}
      {shellClosed && (
        <div className="terminal-reconnect-overlay">
          <div className="reconnect-content">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
              <line x1="12" y1="2" x2="12" y2="12"></line>
            </svg>
            <span className="reconnect-title">Shell Closed</span>
            <span className="reconnect-subtitle">The local shell has exited</span>
            <button
              className="reconnect-btn"
              onClick={handleReconnect}
              disabled={isReconnecting}
            >
              {isReconnecting ? (
                <>
                  <div className="loading-spinner-small"></div>
                  Restarting...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6"></path>
                    <path d="M1 20v-6h6"></path>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                  Restart Shell
                </>
              )}
            </button>
          </div>
        </div>
      )}
      <div ref={terminalRef} className="terminal-view" />
    </div>
  );
}

export default LocalConsole;
