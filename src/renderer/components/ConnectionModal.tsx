import React, { useState, useEffect } from 'react';
import { Connection } from '../types/electron';
import { v4 as uuidv4 } from 'uuid';
import './ConnectionModal.css';

interface ConnectionModalProps {
  connection: Connection | null;
  onSave: (connection: Connection) => void;
  onClose: () => void;
}

function ConnectionModal({ connection, onSave, onClose }: ConnectionModalProps) {
  const [formData, setFormData] = useState<Connection>({
    id: '',
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKey: '',
  });
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>('password');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (connection) {
      setFormData(connection);
      setAuthMethod(connection.privateKey ? 'key' : 'password');
    } else {
      setFormData({
        id: uuidv4(),
        name: '',
        host: '',
        port: 22,
        username: '',
        password: '',
        privateKey: '',
      });
    }
  }, [connection]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'port' ? parseInt(value) || 22 : value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleSelectPrivateKey = async () => {
    const path = await window.electronAPI.selectPrivateKey();
    if (path) {
      setFormData((prev) => ({ ...prev, privateKey: path }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (!formData.host.trim()) {
      newErrors.host = 'Host is required';
    }
    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    }
    if (authMethod === 'password' && !formData.password) {
      newErrors.password = 'Password is required';
    }
    if (authMethod === 'key' && !formData.privateKey) {
      newErrors.privateKey = 'Private key is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      const savedData = {
        ...formData,
        password: authMethod === 'password' ? formData.password : undefined,
        privateKey: authMethod === 'key' ? formData.privateKey : undefined,
      };
      onSave(savedData);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        <div className="modal-header">
          <h2>{connection ? 'Edit Connection' : 'New Connection'}</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Connection Name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="My Server"
              className={errors.name ? 'error' : ''}
            />
            {errors.name && <span className="error-text">{errors.name}</span>}
          </div>

          <div className="form-row">
            <div className="form-group flex-1">
              <label htmlFor="host">Host</label>
              <input
                type="text"
                id="host"
                name="host"
                value={formData.host}
                onChange={handleChange}
                placeholder="192.168.1.1 or hostname.com"
                className={errors.host ? 'error' : ''}
              />
              {errors.host && <span className="error-text">{errors.host}</span>}
            </div>
            <div className="form-group port-group">
              <label htmlFor="port">Port</label>
              <input
                type="number"
                id="port"
                name="port"
                value={formData.port}
                onChange={handleChange}
                min="1"
                max="65535"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleChange}
              placeholder="root"
              className={errors.username ? 'error' : ''}
            />
            {errors.username && <span className="error-text">{errors.username}</span>}
          </div>

          <div className="form-group">
            <label>Authentication Method</label>
            <div className="auth-toggle">
              <button
                type="button"
                className={`auth-btn ${authMethod === 'password' ? 'active' : ''}`}
                onClick={() => setAuthMethod('password')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                Password
              </button>
              <button
                type="button"
                className={`auth-btn ${authMethod === 'key' ? 'active' : ''}`}
                onClick={() => setAuthMethod('key')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                </svg>
                Private Key
              </button>
            </div>
          </div>

          {authMethod === 'password' ? (
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password || ''}
                onChange={handleChange}
                placeholder="Enter password"
                className={errors.password ? 'error' : ''}
              />
              {errors.password && <span className="error-text">{errors.password}</span>}
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="privateKey">Private Key</label>
              <div className="file-input">
                <input
                  type="text"
                  id="privateKey"
                  name="privateKey"
                  value={formData.privateKey || ''}
                  onChange={handleChange}
                  placeholder="Select private key file..."
                  readOnly
                  className={errors.privateKey ? 'error' : ''}
                />
                <button type="button" onClick={handleSelectPrivateKey}>
                  Browse
                </button>
              </div>
              {errors.privateKey && <span className="error-text">{errors.privateKey}</span>}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="save-btn">
              {connection ? 'Save Changes' : 'Add Connection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ConnectionModal;
