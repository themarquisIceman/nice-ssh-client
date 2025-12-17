import React from 'react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  isConnecting: boolean;
  error: string | null;
  onNewConnection: () => void;
}

function WelcomeScreen({ isConnecting, error, onNewConnection }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        {isConnecting ? (
          <div className="connecting-state">
            <div className="connecting-animation">
              <div className="pulse-ring"></div>
              <div className="pulse-ring delay"></div>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
            </div>
            <h2>Connecting...</h2>
            <p>Establishing secure connection</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h2>Connection Failed</h2>
            <p className="error-message">{error}</p>
            <button onClick={onNewConnection}>Try Again</button>
          </div>
        ) : (
          <>
            <div className="welcome-logo">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
            </div>
            <h1>Welcome to Nice SSH</h1>
            <p>A beautiful SSH client for managing your servers</p>

            <div className="quick-actions">
              <button className="primary-action" onClick={onNewConnection}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add New Connection
              </button>
            </div>

            <div className="features">
              <div className="feature">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 17 10 11 4 5"></polyline>
                  <line x1="12" y1="19" x2="20" y2="19"></line>
                </svg>
                <div>
                  <h3>Terminal Access</h3>
                  <p>Full SSH terminal with customizable themes</p>
                </div>
              </div>
              <div className="feature">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <div>
                  <h3>File Browser</h3>
                  <p>SFTP file management with drag and drop</p>
                </div>
              </div>
              <div className="feature">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                </svg>
                <div>
                  <h3>Secure Connections</h3>
                  <p>Password and key-based authentication</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default WelcomeScreen;
