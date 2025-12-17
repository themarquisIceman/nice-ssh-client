import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { v4 as uuidv4 } from 'uuid';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

interface CommandShortcut {
  id: string;
  name: string;
  command: string;
}

interface TerminalProps {
  connectionId: string;
  initialPath?: string;
}

export interface TerminalRef {
  sendCommand: (command: string) => void;
}

const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal({ connectionId, initialPath }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shellIdRef = useRef<string | null>(null); // Unique shell ID for this terminal instance
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shellClosed, setShellClosed] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null);

  // Command history tracking
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const currentCommandRef = useRef<string>('');
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandMenuPos, setCommandMenuPos] = useState({ x: 0, y: 0 });
  const [commandShortcuts, setCommandShortcuts] = useState<CommandShortcut[]>([]);

  // Save shortcut dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveCommandName, setSaveCommandName] = useState('');
  const [commandToSave, setCommandToSave] = useState('');

  // Load command shortcuts (global - not per connection)
  useEffect(() => {
    const loadShortcuts = async () => {
      try {
        const stored = localStorage.getItem('globalCommandShortcuts');
        if (stored) {
          setCommandShortcuts(JSON.parse(stored));
        }
      } catch (err) {
        console.error('Failed to load command shortcuts:', err);
      }
    };
    loadShortcuts();
  }, []);

  const saveShortcut = () => {
    if (!saveCommandName.trim() || !commandToSave.trim()) return;
    const newShortcut: CommandShortcut = {
      id: uuidv4(),
      name: saveCommandName.trim(),
      command: commandToSave.trim(),
    };
    const updated = [...commandShortcuts, newShortcut];
    setCommandShortcuts(updated);
    localStorage.setItem('globalCommandShortcuts', JSON.stringify(updated));
    setShowSaveDialog(false);
    setSaveCommandName('');
    setCommandToSave('');
  };

  const deleteShortcut = (id: string) => {
    const updated = commandShortcuts.filter(s => s.id !== id);
    setCommandShortcuts(updated);
    localStorage.setItem('globalCommandShortcuts', JSON.stringify(updated));
  };

  const executeShortcut = (command: string) => {
    if (xtermRef.current && shellIdRef.current) {
      window.electronAPI.write(shellIdRef.current, command + '\n');
    }
    setShowCommandMenu(false);
  };

  // Store selection when context menu opens (since right-click may clear it)
  const savedSelectionRef = useRef<string>('');

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Save the current selection before showing menu (right-click may clear it)
    if (xtermRef.current) {
      savedSelectionRef.current = xtermRef.current.getSelection() || '';
    }
    setCommandMenuPos({ x: e.clientX, y: e.clientY });
    setShowCommandMenu(true);
  };

  const openSaveDialog = (command?: string) => {
    const cmd = command || currentCommandRef.current || (commandHistory.length > 0 ? commandHistory[commandHistory.length - 1] : '');
    setCommandToSave(cmd);
    setSaveCommandName('');
    setShowSaveDialog(true);
    setShowCommandMenu(false);
  };

  // Expose sendCommand method via ref
  useImperativeHandle(ref, () => ({
    sendCommand: (command: string) => {
      if (shellIdRef.current) {
        window.electronAPI.write(shellIdRef.current, command);
      }
    }
  }), []);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Get container dimensions before creating terminal
    const containerRect = terminalRef.current.getBoundingClientRect();

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      // Set initial rows/cols based on container size to prevent infinite scrolling
      rows: Math.max(10, Math.floor((containerRect.height - 16) / 17)), // 17 ≈ fontSize * lineHeight
      cols: Math.max(40, Math.floor((containerRect.width - 16) / 8.4)), // 8.4 ≈ avg char width
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
      allowTransparency: false, // Disable for better performance
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

    // Custom key handler for Ctrl+Shift+C (copy) and Ctrl+Shift+V (paste)
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Only handle keydown events
      if (e.type !== 'keydown') return true;

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Let app-level shortcuts pass through (Ctrl+Shift+M/H/T, Ctrl+K, Ctrl+,)
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'M' || e.key === 'm' || e.key === 'H' || e.key === 'h' || e.key === 'T' || e.key === 't')) {
        return true; // Let it bubble up to App.tsx
      }
      if (isCtrlOrCmd && (e.key === 'k' || e.key === 'K' || e.key === ',')) {
        return true; // Let it bubble up to App.tsx
      }
      const isKeyC = e.code === 'KeyC' || e.key === 'c' || e.key === 'C';

      // Ctrl+Shift+C - Copy selected text (including multi-line)
      if (isCtrlOrCmd && e.shiftKey && isKeyC) {
        const selection = term.getSelection();
        if (selection) {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard.writeText(selection).then(() => {
            // Optional: visual feedback could be added here
          }).catch(err => {
            console.error('Failed to copy:', err);
          });
          return false; // Prevent xterm from processing this key
        }
        // Even without selection, prevent the key from being sent to terminal
        return false;
      }

      // Ctrl+Shift+V - Paste
      const isKeyV = e.code === 'KeyV' || e.key === 'v' || e.key === 'V';
      if (isCtrlOrCmd && e.shiftKey && isKeyV) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.readText().then(text => {
          if (text && shellIdRef.current) {
            window.electronAPI.write(shellIdRef.current, text);
          }
        }).catch(err => {
          console.error('Failed to paste:', err);
        });
        return false;
      }

      // Ctrl+C without shift - let xterm handle it (sends SIGINT)
      // Ctrl+V without shift - let xterm handle it
      return true;
    });

    // Debounce timer for resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      if (!fitAddonRef.current || !xtermRef.current || !terminalRef.current) return;

      // Check if container has valid dimensions
      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) return; // Skip if too small (not visible)

      try {
        fitAddonRef.current.fit();

        // Only send resize if dimensions are valid and shell is ready
        const cols = xtermRef.current.cols;
        const rows = xtermRef.current.rows;
        if (cols > 0 && rows > 0 && shellIdRef.current) {
          window.electronAPI.resize(shellIdRef.current, cols, rows);
        }
      } catch (e) {
        // Ignore fit errors when terminal is not visible
      }
    };

    const debouncedResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 100);
    };

    // Initial fit after a short delay to ensure DOM is ready
    setTimeout(() => {
      handleResize();
      initializeShell();
    }, 150);

    window.addEventListener('resize', debouncedResize);

    // Use ResizeObserver to detect container size changes (e.g., when tab becomes visible)
    const resizeObserver = new ResizeObserver(() => {
      debouncedResize();
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // Handle terminal input and track commands
    term.onData((data) => {
      // Only write if shell is ready
      if (shellIdRef.current) {
        window.electronAPI.write(shellIdRef.current, data);
      }

      // Track command input
      if (data === '\r' || data === '\n') {
        // Enter pressed - save command to history
        const cmd = currentCommandRef.current.trim();
        if (cmd) {
          setCommandHistory(prev => [...prev.slice(-49), cmd]);
        }
        currentCommandRef.current = '';
      } else if (data === '\x7f' || data === '\b') {
        // Backspace
        currentCommandRef.current = currentCommandRef.current.slice(0, -1);
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        // Printable character
        currentCommandRef.current += data;
      }
    });

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', debouncedResize);
      resizeObserver.disconnect();
      // Close the shell session when terminal is disposed
      if (shellIdRef.current) {
        window.electronAPI.shellClose(shellIdRef.current);
        shellIdRef.current = null;
      }
      term.dispose();
    };
  }, [connectionId]);

  const initializeShell = async () => {
    try {
      // Request a new shell session with a unique ID
      const result = await window.electronAPI.shell(connectionId);
      shellIdRef.current = result.shellId;
      setIsReady(true);

      // Listen for data from this specific shell
      const removeDataListener = window.electronAPI.onData(result.shellId, (data) => {
        if (xtermRef.current) {
          xtermRef.current.write(data);
        }
      });

      // Listen for shell close
      const removeCloseListener = window.electronAPI.onClose(result.shellId, () => {
        if (xtermRef.current) {
          xtermRef.current.write('\r\n\x1b[31mShell closed.\x1b[0m\r\n');
        }
        shellIdRef.current = null;
        setShellClosed(true);
      });

      // Initial resize
      if (xtermRef.current && fitAddonRef.current) {
        fitAddonRef.current.fit();
        window.electronAPI.resize(
          result.shellId,
          xtermRef.current.cols,
          xtermRef.current.rows
        );
      }

      // Send initial cd command if path provided
      if (initialPath && initialPath !== '/') {
        setTimeout(() => {
          if (shellIdRef.current) {
            window.electronAPI.write(shellIdRef.current, `cd "${initialPath}"\n`);
          }
        }, 500); // Wait for shell prompt to be ready
      }

      return () => {
        removeDataListener();
        removeCloseListener();
      };
    } catch (err: any) {
      setError(err.message || 'Failed to start shell');
    }
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    setShellClosed(false);
    setError(null);

    try {
      // Clear the terminal before reconnecting
      if (xtermRef.current) {
        xtermRef.current.write('\r\n\x1b[33mReconnecting...\x1b[0m\r\n');
      }

      await initializeShell();
    } catch (err: any) {
      setError(err.message || 'Failed to reconnect');
      setShellClosed(true);
    } finally {
      setIsReconnecting(false);
    }
  };

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setShowCommandMenu(false);
    if (showCommandMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showCommandMenu]);

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
        // Opening search - focus input after render
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        // Closing search - clear decorations and focus terminal
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

  // Copy terminal selection to clipboard
  const copySelection = useCallback((useSaved: boolean = false) => {
    let selection = '';

    // Try saved selection first if requested, then current selection
    if (useSaved && savedSelectionRef.current) {
      selection = savedSelectionRef.current;
    } else if (xtermRef.current) {
      selection = xtermRef.current.getSelection() || '';
    }

    console.log('[Terminal] copySelection called, selection:', selection, 'length:', selection.length);

    if (selection) {
      navigator.clipboard.writeText(selection).then(() => {
        console.log('[Terminal] Successfully copied to clipboard:', selection.substring(0, 50) + '...');
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
      return true;
    }
    return false;
  }, []);

  // Listen for Ctrl+Shift+C from main process (intercepted before DevTools)
  useEffect(() => {
    const removeListener = window.electronAPI.onTerminalCopy(() => {
      console.log('[Terminal] Received terminal-copy event from main process');
      copySelection();
    });
    return removeListener;
  }, [copySelection]);

  // Paste from clipboard to terminal
  const pasteToTerminal = useCallback(() => {
    navigator.clipboard.readText().then(text => {
      if (text && shellIdRef.current) {
        window.electronAPI.write(shellIdRef.current, text);
      }
    }).catch(err => {
      console.error('Failed to paste:', err);
    });
  }, []);

  // Handle keyboard shortcuts on the container
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    // Ctrl+Shift+C - Copy selected text from terminal
    if (isCtrlOrCmd && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      e.stopPropagation();
      copySelection();
      return;
    }

    // Ctrl+Shift+V - Paste to terminal
    if (isCtrlOrCmd && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
      e.preventDefault();
      e.stopPropagation();
      pasteToTerminal();
      return;
    }

    // Ctrl+Shift+F - Toggle search
    if (isCtrlOrCmd && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      toggleSearch();
      return;
    }

    if (e.key === 'Escape' && showSearch) {
      closeSearch();
    }
  }, [copySelection, pasteToTerminal, toggleSearch, closeSearch, showSearch]);

  // Trigger search when searchTerm changes
  useEffect(() => {
    if (searchTerm && searchAddonRef.current) {
      searchAddonRef.current.findNext(searchTerm, { caseSensitive: false, wholeWord: false, regex: false });
    }
  }, [searchTerm]);

  // Window-level event listener for copy/paste (most reliable)
  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl+Shift+C - Copy (always try if we have a selection)
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.code === 'KeyC')) {
        if (xtermRef.current) {
          const selection = xtermRef.current.getSelection();
          if (selection) {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.writeText(selection).then(() => {
              console.log('[Terminal] Copied:', selection);
            }).catch(err => {
              console.error('[Terminal] Failed to copy:', err);
            });
            return;
          }
        }
      }

      // Ctrl+Shift+V - Paste (only if our terminal has focus)
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'V' || e.key === 'v' || e.code === 'KeyV')) {
        const activeEl = document.activeElement;
        const isOurTerminal = containerRef.current?.contains(activeEl) ||
                             terminalRef.current?.contains(activeEl);
        if (isOurTerminal && shellIdRef.current) {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard.readText().then(text => {
            if (text) {
              window.electronAPI.write(shellIdRef.current!, text);
            }
          });
        }
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true);
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
          <span>Starting shell...</span>
        </div>
      )}
      {shellClosed && (
        <div className="terminal-reconnect-overlay">
          <div className="reconnect-content">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
              <line x1="12" y1="2" x2="12" y2="12"></line>
            </svg>
            <span className="reconnect-title">Shell Disconnected</span>
            <span className="reconnect-subtitle">The shell session has ended</span>
            <button
              className="reconnect-btn"
              onClick={handleReconnect}
              disabled={isReconnecting}
            >
              {isReconnecting ? (
                <>
                  <div className="loading-spinner-small"></div>
                  Reconnecting...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6"></path>
                    <path d="M1 20v-6h6"></path>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                  Reconnect
                </>
              )}
            </button>
          </div>
        </div>
      )}
      <div ref={terminalRef} className="terminal-view" onContextMenu={handleContextMenu} />

      {/* Context Menu */}
      {showCommandMenu && (
        <div
          className="terminal-context-menu"
          style={{ left: commandMenuPos.x, top: commandMenuPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => {
            copySelection(true); // Use saved selection from when context menu opened
            setShowCommandMenu(false);
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
          <button onClick={() => {
            pasteToTerminal();
            setShowCommandMenu(false);
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
            Paste
          </button>
          <div className="context-menu-divider"></div>
          <button onClick={() => openSaveDialog()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Create Shortcut
          </button>
          {commandShortcuts.length > 0 && (
            <>
              <div className="context-menu-divider"></div>
              <div className="context-menu-label">Saved Shortcuts</div>
              {commandShortcuts.map((shortcut) => (
                <div key={shortcut.id} className="shortcut-item-row">
                  <button onClick={() => executeShortcut(shortcut.command)} className="shortcut-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                    </svg>
                    <span className="cmd-text">{shortcut.name}</span>
                  </button>
                  <button
                    className="shortcut-delete"
                    onClick={(e) => { e.stopPropagation(); deleteShortcut(shortcut.id); }}
                    title="Delete shortcut"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </>
          )}
          {commandHistory.length > 0 && (
            <>
              <div className="context-menu-divider"></div>
              <div className="context-menu-label">Recent Commands</div>
              {commandHistory.slice(-5).reverse().map((cmd, idx) => (
                <button key={idx} onClick={() => executeShortcut(cmd)} className="history-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5"></polyline>
                  </svg>
                  <span className="cmd-text">{cmd.length > 30 ? cmd.substring(0, 30) + '...' : cmd}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Save Command Dialog */}
      {showSaveDialog && (
        <div className="dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Create Command Shortcut</div>
            <div className="form-group">
              <label>Shortcut Name</label>
              <input
                type="text"
                className="dialog-input"
                value={saveCommandName}
                onChange={(e) => setSaveCommandName(e.target.value)}
                placeholder="Enter a name for this shortcut"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveShortcut();
                  if (e.key === 'Escape') setShowSaveDialog(false);
                }}
              />
            </div>
            <div className="form-group">
              <label>Command</label>
              <textarea
                className="dialog-input dialog-textarea"
                value={commandToSave}
                onChange={(e) => setCommandToSave(e.target.value)}
                placeholder="Enter the command"
                rows={3}
              />
            </div>
            <div className="dialog-buttons">
              <button className="dialog-btn dialog-btn-cancel" onClick={() => setShowSaveDialog(false)}>
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-confirm"
                onClick={saveShortcut}
                disabled={!saveCommandName.trim() || !commandToSave.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default Terminal;
