import React, { useState, useEffect } from 'react';
import './Preferences.css';

interface PreferencesConfig {
  hideIPs: boolean;
  hidePorts: boolean;
  hideUsernames: boolean;
  accentColor: string;
  terminalFontSize: number;
  terminalFontFamily: string;
  theme: 'dark' | 'darker' | 'midnight';
  // Custom colors
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderColor: string;
  // GitHub Sync settings
  githubSyncEnabled: boolean;
  githubToken: string;
  githubRepo: string;
  githubFilePath: string;
  githubAutoSync: boolean;
}

const DEFAULT_PREFERENCES: PreferencesConfig = {
  hideIPs: false,
  hidePorts: false,
  hideUsernames: false,
  accentColor: '#7aa2f7',
  terminalFontSize: 14,
  terminalFontFamily: 'JetBrains Mono',
  theme: 'dark',
  // Custom colors - Tokyo Night defaults
  bgPrimary: '#1a1b26',
  bgSecondary: '#16161e',
  bgTertiary: '#1f2335',
  textPrimary: '#c0caf5',
  textSecondary: '#a9b1d6',
  textMuted: '#565f89',
  borderColor: '#292e42',
  // GitHub Sync defaults
  githubSyncEnabled: false,
  githubToken: '',
  githubRepo: '',
  githubFilePath: 'nice-ssh-config.json',
  githubAutoSync: false,
};

const ACCENT_COLORS = [
  { name: 'Blue', value: '#7aa2f7' },
  { name: 'Purple', value: '#bb9af7' },
  { name: 'Green', value: '#9ece6a' },
  { name: 'Orange', value: '#ff9e64' },
  { name: 'Pink', value: '#f7768e' },
  { name: 'Cyan', value: '#7dcfff' },
  { name: 'Yellow', value: '#e0af68' },
];

const FONT_FAMILIES = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Source Code Pro',
  'Monaco',
  'Consolas',
  'Menlo',
];

interface PreferencesProps {
  isOpen: boolean;
  onClose: () => void;
  onPreferencesChange: (prefs: PreferencesConfig) => void;
}

function Preferences({ isOpen, onClose, onPreferencesChange }: PreferencesProps) {
  const [preferences, setPreferences] = useState<PreferencesConfig>(DEFAULT_PREFERENCES);
  const [hasChanges, setHasChanges] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'pushing' | 'pulling' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [showToken, setShowToken] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    const saved = localStorage.getItem('app-preferences');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPreferences({ ...DEFAULT_PREFERENCES, ...parsed });
      } catch (e) {
        console.error('Failed to parse preferences:', e);
      }
    }
  }, []);

  // Save preferences
  const savePreferences = () => {
    localStorage.setItem('app-preferences', JSON.stringify(preferences));
    onPreferencesChange(preferences);
    setHasChanges(false);
  };

  // Update a preference
  const updatePref = <K extends keyof PreferencesConfig>(key: K, value: PreferencesConfig[K]) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // Reset to defaults
  const resetToDefaults = () => {
    setPreferences(DEFAULT_PREFERENCES);
    setHasChanges(true);
  };

  // GitHub Sync - Push config to GitHub
  const pushToGitHub = async () => {
    if (!preferences.githubToken || !preferences.githubRepo) {
      setSyncStatus('error');
      setSyncMessage('Please configure GitHub token and repository first');
      return;
    }

    setSyncStatus('pushing');
    setSyncMessage('Pushing configuration to GitHub...');

    try {
      const result = await window.electronAPI.githubPush(
        preferences.githubToken,
        preferences.githubRepo,
        preferences.githubFilePath
      );

      if (result.success) {
        setSyncStatus('success');
        setSyncMessage('Configuration pushed to GitHub successfully!');
      } else {
        setSyncStatus('error');
        setSyncMessage(result.error || 'Failed to push to GitHub');
      }
    } catch (err: any) {
      setSyncStatus('error');
      setSyncMessage(err.message || 'Failed to push to GitHub');
    }

    // Reset status after 3 seconds
    setTimeout(() => {
      setSyncStatus('idle');
      setSyncMessage('');
    }, 3000);
  };

  // GitHub Sync - Pull config from GitHub
  const pullFromGitHub = async () => {
    if (!preferences.githubToken || !preferences.githubRepo) {
      setSyncStatus('error');
      setSyncMessage('Please configure GitHub token and repository first');
      return;
    }

    setSyncStatus('pulling');
    setSyncMessage('Pulling configuration from GitHub...');

    try {
      const result = await window.electronAPI.githubPull(
        preferences.githubToken,
        preferences.githubRepo,
        preferences.githubFilePath
      );

      if (result.success) {
        setSyncStatus('success');
        setSyncMessage('Configuration pulled from GitHub successfully! Reload to apply.');
      } else {
        setSyncStatus('error');
        setSyncMessage(result.error || 'Failed to pull from GitHub');
      }
    } catch (err: any) {
      setSyncStatus('error');
      setSyncMessage(err.message || 'Failed to pull from GitHub');
    }

    // Reset status after 3 seconds
    setTimeout(() => {
      setSyncStatus('idle');
      setSyncMessage('');
    }, 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="preferences-overlay" onClick={onClose}>
      <div className="preferences-modal" onClick={e => e.stopPropagation()}>
        <div className="preferences-header">
          <h2>Preferences</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="preferences-body">
          {/* Privacy Section */}
          <section className="pref-section">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0110 0v4"></path>
              </svg>
              Privacy (Streamer Mode)
            </h3>
            <p className="section-desc">Hide sensitive information when recording or streaming</p>

            <label className="pref-toggle">
              <span>Hide IP Addresses</span>
              <input
                type="checkbox"
                checked={preferences.hideIPs}
                onChange={e => updatePref('hideIPs', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>

            <label className="pref-toggle">
              <span>Hide Ports</span>
              <input
                type="checkbox"
                checked={preferences.hidePorts}
                onChange={e => updatePref('hidePorts', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>

            <label className="pref-toggle">
              <span>Hide Usernames</span>
              <input
                type="checkbox"
                checked={preferences.hideUsernames}
                onChange={e => updatePref('hideUsernames', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </section>

          {/* Appearance Section */}
          <section className="pref-section">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
              </svg>
              Appearance
            </h3>

            <div className="pref-group">
              <label>Accent Color</label>
              <div className="color-options">
                {ACCENT_COLORS.map(color => (
                  <button
                    key={color.value}
                    className={`color-option ${preferences.accentColor === color.value ? 'selected' : ''}`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => updatePref('accentColor', color.value)}
                    title={color.name}
                  />
                ))}
                <input
                  type="color"
                  value={preferences.accentColor}
                  onChange={e => updatePref('accentColor', e.target.value)}
                  className="color-picker-input"
                  title="Custom color"
                />
              </div>
            </div>

            <div className="pref-group">
              <label>Custom Colors</label>
              <div className="custom-colors-grid">
                <div className="color-field">
                  <label>Background Primary</label>
                  <input
                    type="color"
                    value={preferences.bgPrimary}
                    onChange={e => updatePref('bgPrimary', e.target.value)}
                  />
                  <span className="color-value">{preferences.bgPrimary}</span>
                </div>
                <div className="color-field">
                  <label>Background Secondary</label>
                  <input
                    type="color"
                    value={preferences.bgSecondary}
                    onChange={e => updatePref('bgSecondary', e.target.value)}
                  />
                  <span className="color-value">{preferences.bgSecondary}</span>
                </div>
                <div className="color-field">
                  <label>Background Tertiary</label>
                  <input
                    type="color"
                    value={preferences.bgTertiary}
                    onChange={e => updatePref('bgTertiary', e.target.value)}
                  />
                  <span className="color-value">{preferences.bgTertiary}</span>
                </div>
                <div className="color-field">
                  <label>Text Primary</label>
                  <input
                    type="color"
                    value={preferences.textPrimary}
                    onChange={e => updatePref('textPrimary', e.target.value)}
                  />
                  <span className="color-value">{preferences.textPrimary}</span>
                </div>
                <div className="color-field">
                  <label>Text Secondary</label>
                  <input
                    type="color"
                    value={preferences.textSecondary}
                    onChange={e => updatePref('textSecondary', e.target.value)}
                  />
                  <span className="color-value">{preferences.textSecondary}</span>
                </div>
                <div className="color-field">
                  <label>Text Muted</label>
                  <input
                    type="color"
                    value={preferences.textMuted}
                    onChange={e => updatePref('textMuted', e.target.value)}
                  />
                  <span className="color-value">{preferences.textMuted}</span>
                </div>
                <div className="color-field">
                  <label>Border Color</label>
                  <input
                    type="color"
                    value={preferences.borderColor}
                    onChange={e => updatePref('borderColor', e.target.value)}
                  />
                  <span className="color-value">{preferences.borderColor}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Terminal Section */}
          <section className="pref-section">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              Terminal
            </h3>

            <div className="pref-group">
              <label>Font Size</label>
              <div className="range-input">
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={preferences.terminalFontSize}
                  onChange={e => updatePref('terminalFontSize', parseInt(e.target.value))}
                />
                <span className="range-value">{preferences.terminalFontSize}px</span>
              </div>
            </div>

            <div className="pref-group">
              <label>Font Family</label>
              <select
                value={preferences.terminalFontFamily}
                onChange={e => updatePref('terminalFontFamily', e.target.value)}
              >
                {FONT_FAMILIES.map(font => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
            </div>
          </section>

          {/* GitHub Sync Section */}
          <section className="pref-section">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub Sync (Optional)
            </h3>
            <p className="section-desc">Sync your connections and settings to a private GitHub repository</p>

            <label className="pref-toggle">
              <span>Enable GitHub Sync</span>
              <input
                type="checkbox"
                checked={preferences.githubSyncEnabled}
                onChange={e => updatePref('githubSyncEnabled', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>

            {preferences.githubSyncEnabled && (
              <>
                <div className="pref-group">
                  <label>Personal Access Token</label>
                  <div className="token-input-wrapper">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={preferences.githubToken}
                      onChange={e => updatePref('githubToken', e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxx"
                    />
                    <button
                      type="button"
                      className="toggle-visibility-btn"
                      onClick={() => setShowToken(!showToken)}
                      title={showToken ? 'Hide token' : 'Show token'}
                    >
                      {showToken ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      )}
                    </button>
                  </div>
                  <span className="field-hint">
                    Create at GitHub → Settings → Developer settings → Personal access tokens
                    <br />Needs <code>repo</code> scope for private repos
                  </span>
                </div>

                <div className="pref-group">
                  <label>Repository (owner/repo)</label>
                  <input
                    type="text"
                    value={preferences.githubRepo}
                    onChange={e => updatePref('githubRepo', e.target.value)}
                    placeholder="username/my-ssh-config"
                  />
                  <span className="field-hint">Use a private repo to keep your configs secure</span>
                </div>

                <div className="pref-group">
                  <label>File Path</label>
                  <input
                    type="text"
                    value={preferences.githubFilePath}
                    onChange={e => updatePref('githubFilePath', e.target.value)}
                    placeholder="nice-ssh-config.json"
                  />
                </div>

                <label className="pref-toggle">
                  <span>Auto-sync on changes</span>
                  <input
                    type="checkbox"
                    checked={preferences.githubAutoSync}
                    onChange={e => updatePref('githubAutoSync', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>

                <div className="sync-actions">
                  <button
                    className="sync-btn push-btn"
                    onClick={pushToGitHub}
                    disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7"/>
                    </svg>
                    {syncStatus === 'pushing' ? 'Pushing...' : 'Push to GitHub'}
                  </button>
                  <button
                    className="sync-btn pull-btn"
                    onClick={pullFromGitHub}
                    disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12l7 7 7-7"/>
                    </svg>
                    {syncStatus === 'pulling' ? 'Pulling...' : 'Pull from GitHub'}
                  </button>
                </div>

                {syncMessage && (
                  <div className={`sync-status ${syncStatus}`}>
                    {syncStatus === 'success' && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                    {syncStatus === 'error' && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                      </svg>
                    )}
                    {(syncStatus === 'pushing' || syncStatus === 'pulling') && (
                      <span className="sync-spinner"></span>
                    )}
                    {syncMessage}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Keyboard Shortcuts Reference */}
          <section className="pref-section">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h8"></path>
              </svg>
              Keyboard Shortcuts
            </h3>
            <div className="shortcuts-list">
              <div className="shortcut-item">
                <kbd>Ctrl+K</kbd>
                <span>Command Palette</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl+Shift+F</kbd>
                <span>Search in Terminal</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl+Shift+R</kbd>
                <span>Split Terminal Right</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl+Shift+D</kbd>
                <span>Split Terminal Down</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl+Shift+M</kbd>
                <span>Multi-Server Command</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl+Shift+H</kbd>
                <span>Server Health Overview</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl+Shift+T</kbd>
                <span>SSH Tunnel Manager</span>
              </div>
            </div>
          </section>
        </div>

        <div className="preferences-footer">
          <div className="footer-left">
            <button className="reset-btn" onClick={resetToDefaults}>
              Reset to Defaults
            </button>
          </div>
          <div className="footer-right">
            <button className="cancel-btn" onClick={onClose}>Cancel</button>
            <button
              className="save-btn"
              onClick={savePreferences}
              disabled={!hasChanges}
            >
              Save Changes
            </button>
          </div>
        </div>

        {/* Buy Me a Coffee */}
        {/* <div className="support-banner">
          <span>Do you like it? Only if you can afford to drink coffee everyday like nothing</span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI.openExternal('https://buymeacoffee.com/icemanisme');
            }}
            className="coffee-link"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 21V19H20V21H2ZM20 8V5H18V8H20ZM20 3C20.5304 3 21.0391 3.21071 21.4142 3.58579C21.7893 3.96086 22 4.46957 22 5V8C22 8.53043 21.7893 9.03914 21.4142 9.41421C21.0391 9.78929 20.5304 10 20 10H18V12C18 13.5913 17.3679 15.1174 16.2426 16.2426C15.1174 17.3679 13.5913 18 12 18H8C6.4087 18 4.88258 17.3679 3.75736 16.2426C2.63214 15.1174 2 13.5913 2 12V3H20ZM18 8V5H4V12C4 13.0609 4.42143 14.0783 5.17157 14.8284C5.92172 15.5786 6.93913 16 8 16H12C13.0609 16 14.0783 15.5786 14.8284 14.8284C15.5786 14.0783 16 13.0609 16 12V3H18V8Z"/>
            </svg>
            Buy me a coffee
          </a>
        </div> */}
      </div>
    </div>
  );
}

export default Preferences;

// Export the preferences type and helper to get current preferences
export type { PreferencesConfig };

export function getPreferences(): PreferencesConfig {
  const saved = localStorage.getItem('app-preferences');
  if (saved) {
    try {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }
  return DEFAULT_PREFERENCES;
}

export function maskIP(ip: string, hide: boolean): string {
  if (!hide) return ip;
  // Replace middle parts with asterisks
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.***.***. ${parts[3]}`;
  }
  return '***.***.***. ***';
}

export function maskPort(port: number | string, hide: boolean): string {
  if (!hide) return String(port);
  return '****';
}

export function maskUsername(username: string, hide: boolean): string {
  if (!hide) return username;
  if (username.length <= 2) return '***';
  return username[0] + '***' + username[username.length - 1];
}

// Apply theme to CSS variables - exported for use in App.tsx
export function applyTheme(prefs: PreferencesConfig) {
  document.documentElement.style.setProperty('--accent-primary', prefs.accentColor);
  document.documentElement.style.setProperty('--terminal-font-size', `${prefs.terminalFontSize}px`);
  document.documentElement.style.setProperty('--terminal-font-family', prefs.terminalFontFamily);
  // Apply custom colors
  document.documentElement.style.setProperty('--bg-primary', prefs.bgPrimary);
  document.documentElement.style.setProperty('--bg-secondary', prefs.bgSecondary);
  document.documentElement.style.setProperty('--bg-tertiary', prefs.bgTertiary);
  document.documentElement.style.setProperty('--text-primary', prefs.textPrimary);
  document.documentElement.style.setProperty('--text-secondary', prefs.textSecondary);
  document.documentElement.style.setProperty('--text-muted', prefs.textMuted);
  document.documentElement.style.setProperty('--border-color', prefs.borderColor);
}
