import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard } from 'electron';
import * as path from 'path';
import { Client, SFTPWrapper } from 'ssh2';
import Store from 'electron-store';
import * as fs from 'fs';
import * as net from 'net';
import * as dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';

// Load .env file from app root
dotenv.config({ path: path.join(app.getAppPath(), '.env') });

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  avatarIcon?: string;
  avatarColor?: string;
}

interface Shortcut {
  id: string;
  connectionId: string;
  name: string;
  path: string;
}

interface PackageShortcut {
  id: string;
  name: string;
  description: string;
  installCommand: string;
  checkCommand: string;
  icon?: string;
  category: 'container' | 'runtime' | 'tool' | 'custom';
}

interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

interface StoreSchema {
  connections: Connection[];
  shortcuts: Shortcut[];
  lastPaths: Record<string, string>;
  packageShortcuts: PackageShortcut[];
  tabGroups: TabGroup[];
}

const defaultPackageShortcuts: PackageShortcut[] = [
  {
    id: 'docker',
    name: 'Docker',
    description: 'Container runtime',
    installCommand: 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER',
    checkCommand: 'docker --version',
    icon: 'docker',
    category: 'container',
  },
  {
    id: 'docker-compose',
    name: 'Docker Compose',
    description: 'Multi-container orchestration',
    installCommand: 'sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose',
    checkCommand: 'docker-compose --version',
    icon: 'docker',
    category: 'container',
  },
  {
    id: 'coolify',
    name: 'Coolify',
    description: 'Self-hosted PaaS',
    installCommand: 'curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash',
    checkCommand: 'docker ps | grep -q coolify && echo "Coolify is running"',
    icon: 'cloud',
    category: 'container',
  },
  {
    id: 'nodejs-lts',
    name: 'Node.js LTS',
    description: 'JavaScript runtime (via nvm)',
    installCommand: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts',
    checkCommand: 'node --version',
    icon: 'nodejs',
    category: 'runtime',
  },
  {
    id: 'nodejs-latest',
    name: 'Node.js Latest',
    description: 'JavaScript runtime (latest)',
    installCommand: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install node',
    checkCommand: 'node --version',
    icon: 'nodejs',
    category: 'runtime',
  },
  {
    id: 'python3',
    name: 'Python 3',
    description: 'Python runtime & pip',
    installCommand: 'sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv',
    checkCommand: 'python3 --version',
    icon: 'python',
    category: 'runtime',
  },
  {
    id: 'go',
    name: 'Go',
    description: 'Go programming language',
    installCommand: 'wget -q https://go.dev/dl/go1.22.0.linux-amd64.tar.gz && sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz && rm go1.22.0.linux-amd64.tar.gz && echo "export PATH=$PATH:/usr/local/go/bin" >> ~/.bashrc',
    checkCommand: '/usr/local/go/bin/go version || go version',
    icon: 'go',
    category: 'runtime',
  },
  {
    id: 'rust',
    name: 'Rust & Cargo',
    description: 'Rust programming language',
    installCommand: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"',
    checkCommand: 'source "$HOME/.cargo/env" 2>/dev/null; rustc --version && cargo --version',
    icon: 'rust',
    category: 'runtime',
  },
  {
    id: 'nginx',
    name: 'Nginx',
    description: 'Web server & reverse proxy',
    installCommand: 'sudo apt-get update && sudo apt-get install -y nginx && sudo systemctl enable nginx && sudo systemctl start nginx',
    checkCommand: 'nginx -v',
    icon: 'server',
    category: 'tool',
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Version control system',
    installCommand: 'sudo apt-get update && sudo apt-get install -y git',
    checkCommand: 'git --version',
    icon: 'git',
    category: 'tool',
  },
  {
    id: 'pm2',
    name: 'PM2',
    description: 'Node.js process manager',
    installCommand: 'npm install -g pm2',
    checkCommand: 'pm2 --version',
    icon: 'process',
    category: 'tool',
  },
];

const store = new Store<StoreSchema>({
  defaults: {
    connections: [],
    shortcuts: [],
    lastPaths: {},
    packageShortcuts: defaultPackageShortcuts,
    tabGroups: [],
  },
});

let mainWindow: BrowserWindow | null = null;
const allWindows: Set<BrowserWindow> = new Set();
interface Tunnel {
  id: string;
  connectionId: string;
  type: 'local' | 'remote';
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: 'active' | 'error';
  server?: ReturnType<typeof import('net').createServer>;
}

interface ShellSession {
  stream: any;
  connectionId: string;
}

const activeConnections: Map<string, { client: Client; sftp?: SFTPWrapper; pendingChannels?: number; tunnels?: Tunnel[] }> = new Map();
const activeTunnels: Map<string, Tunnel> = new Map();
const activeShells: Map<string, ShellSession> = new Map(); // shellId -> ShellSession
const activeUploads: Map<string, { cancelled: boolean }> = new Map(); // uploadId -> upload state

// Local shell sessions (personal console)
interface LocalShellSession {
  process: ChildProcess;
  cols: number;
  rows: number;
}
const activeLocalShells: Map<string, LocalShellSession> = new Map(); // shellId -> LocalShellSession

// Channel limiter to prevent too many concurrent channels
const MAX_CONCURRENT_CHANNELS = 5;
const channelQueue: Map<string, Array<() => void>> = new Map();

async function waitForChannel(connectionId: string): Promise<void> {
  const conn = activeConnections.get(connectionId);
  if (!conn) return;

  const pending = conn.pendingChannels || 0;
  if (pending < MAX_CONCURRENT_CHANNELS) {
    conn.pendingChannels = pending + 1;
    return;
  }

  // Wait in queue
  return new Promise((resolve) => {
    let queue = channelQueue.get(connectionId);
    if (!queue) {
      queue = [];
      channelQueue.set(connectionId, queue);
    }
    queue.push(() => {
      const c = activeConnections.get(connectionId);
      if (c) c.pendingChannels = (c.pendingChannels || 0) + 1;
      resolve();
    });
  });
}

function releaseChannel(connectionId: string): void {
  const conn = activeConnections.get(connectionId);
  if (conn && conn.pendingChannels) {
    conn.pendingChannels--;
  }

  const queue = channelQueue.get(connectionId);
  if (queue && queue.length > 0) {
    const next = queue.shift();
    if (next) next();
  }
}

// Check if connection is still alive by attempting a simple operation
async function isConnectionAlive(connectionId: string): Promise<boolean> {
  const conn = activeConnections.get(connectionId);
  if (!conn) return false;

  return new Promise((resolve) => {
    // Set a short timeout for the check
    const timeout = setTimeout(() => {
      resolve(false);
    }, 3000);

    // Try to execute a simple command to test the connection
    conn.client.exec('echo 1', (err, stream) => {
      clearTimeout(timeout);
      if (err) {
        resolve(false);
        return;
      }
      stream.on('close', () => {
        resolve(true);
      });
      stream.on('error', () => {
        resolve(false);
      });
      // Close the stream after we get a response
      stream.on('data', () => {
        stream.close();
      });
    });
  });
}

// Reconnect a stale connection
async function reconnectConnection(connectionId: string): Promise<boolean> {
  const connections = store.get('connections');
  const connection = connections.find((c) => c.id === connectionId);

  if (!connection) {
    return false;
  }

  // Clean up old connection
  const oldConn = activeConnections.get(connectionId);
  if (oldConn) {
    try {
      oldConn.client.end();
    } catch (e) {
      // Ignore errors when closing stale connection
    }
    activeConnections.delete(connectionId);
  }

  // Clear any pending channel queues
  channelQueue.delete(connectionId);

  // Close all shells associated with this connection
  for (const [shellId, shell] of activeShells.entries()) {
    if (shell.connectionId === connectionId) {
      try {
        shell.stream.end();
      } catch (e) {
        // Ignore
      }
      activeShells.delete(shellId);
    }
  }

  // Establish new connection
  return new Promise((resolve) => {
    const client = new Client();

    const timeout = setTimeout(() => {
      client.end();
      resolve(false);
    }, 10000);

    client.on('ready', () => {
      clearTimeout(timeout);
      activeConnections.set(connectionId, { client, pendingChannels: 0 });
      console.log(`Reconnected to ${connection.name} (${connectionId})`);
      resolve(true);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`Reconnection failed for ${connection.name}:`, err.message);
      resolve(false);
    });

    const config: any = {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      readyTimeout: 10000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    if (connection.privateKey) {
      try {
        config.privateKey = fs.readFileSync(connection.privateKey);
      } catch (err) {
        clearTimeout(timeout);
        resolve(false);
        return;
      }
    } else if (connection.password) {
      config.password = connection.password;
    }

    client.connect(config);
  });
}

function createWindow(): void {
  // Icon path differs between dev and production
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../../build/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    backgroundColor: '#1a1b26',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  allWindows.add(mainWindow);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open DevTools if ENV is set to development in .env
  if (process.env.ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    allWindows.delete(mainWindow!);
    mainWindow = null;
  });

  // Intercept Ctrl+Shift+C to prevent DevTools inspect element and allow terminal copy
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'c') {
      // Don't prevent - let the renderer handle it
      // But we need to prevent DevTools from capturing it
      event.preventDefault();
      // Send to renderer to handle copy
      mainWindow?.webContents.send('terminal-copy');
    }
  });
}

function createDetachedWindow(connectionId: string, mode: string = 'terminal'): BrowserWindow {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../../build/icon.ico');

  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1b26',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  allWindows.add(newWindow);

  // Pass connection info via query params
  const queryParams = `?connectionId=${encodeURIComponent(connectionId)}&mode=${encodeURIComponent(mode)}&detached=true`;

  if (process.env.NODE_ENV === 'development') {
    newWindow.loadURL(`http://localhost:3000${queryParams}`);
  } else {
    newWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { connectionId, mode, detached: 'true' }
    });
  }

  if (process.env.ENV === 'development') {
    newWindow.webContents.openDevTools();
  }

  newWindow.on('closed', () => {
    allWindows.delete(newWindow);
  });

  // Intercept Ctrl+Shift+C to prevent DevTools inspect element and allow terminal copy
  newWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'c') {
      event.preventDefault();
      newWindow.webContents.send('terminal-copy');
    }
  });

  return newWindow;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Close all SSH connections
  activeConnections.forEach((conn) => {
    conn.client.end();
  });
  activeConnections.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Window controls - use sender window, not mainWindow
ipcMain.handle('window:minimize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.minimize();
});

ipcMain.handle('window:maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window?.isMaximized()) {
    window.unmaximize();
  } else {
    window?.maximize();
  }
});

ipcMain.handle('window:close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.close();
});

ipcMain.handle('window:createNew', (_event, connectionId: string, mode: string = 'terminal') => {
  const newWindow = createDetachedWindow(connectionId, mode);
  return { success: true, windowId: newWindow.id };
});

// Connection management
ipcMain.handle('connections:getAll', () => {
  return store.get('connections');
});

ipcMain.handle('connections:save', (_event, connection: Connection) => {
  const connections = store.get('connections');
  const existingIndex = connections.findIndex((c) => c.id === connection.id);

  if (existingIndex >= 0) {
    connections[existingIndex] = connection;
  } else {
    connections.push(connection);
  }

  store.set('connections', connections);
  return connections;
});

ipcMain.handle('connections:delete', (_event, id: string) => {
  const connections = store.get('connections').filter((c) => c.id !== id);
  store.set('connections', connections);
  return connections;
});

// Save all connections (for reordering)
ipcMain.handle('connections:saveAll', (_event, newConnections: Connection[]) => {
  store.set('connections', newConnections);
  return newConnections;
});

// SSH connection
ipcMain.handle('ssh:connect', async (_event, connectionId: string) => {
  const connections = store.get('connections');
  const connection = connections.find((c) => c.id === connectionId);

  if (!connection) {
    throw new Error('Connection not found');
  }

  return new Promise((resolve, reject) => {
    const client = new Client();

    client.on('ready', () => {
      activeConnections.set(connectionId, { client });
      resolve({ success: true, connectionId });
    });

    client.on('error', (err) => {
      reject(err);
    });

    const config: any = {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000, // Send keepalive every 10 seconds
      keepaliveCountMax: 3, // Disconnect after 3 failed keepalives
    };

    if (connection.privateKey) {
      try {
        config.privateKey = fs.readFileSync(connection.privateKey);
      } catch (err) {
        reject(new Error('Failed to read private key file'));
        return;
      }
    } else if (connection.password) {
      config.password = connection.password;
    }

    // Handle connection close event
    client.on('close', () => {
      console.log(`Connection ${connectionId} closed`);
      // Clean up shells for this connection
      for (const [shellId, shell] of activeShells.entries()) {
        if (shell.connectionId === connectionId) {
          activeShells.delete(shellId);
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send(`ssh:close:${shellId}`);
            }
          });
        }
      }
      activeConnections.delete(connectionId);
    });

    client.connect(config);
  });
});

ipcMain.handle('ssh:disconnect', (_event, connectionId: string) => {
  const conn = activeConnections.get(connectionId);
  if (conn) {
    conn.client.end();
    activeConnections.delete(connectionId);
  }
  return { success: true };
});

// Ensure connection is ready with SFTP initialized
ipcMain.handle('ssh:ensureReady', async (_event, connectionId: string) => {
  let conn = activeConnections.get(connectionId);

  // If not connected, establish connection
  if (!conn) {
    const connections = store.get('connections');
    const connection = connections.find((c) => c.id === connectionId);

    if (!connection) {
      throw new Error('Connection not found');
    }

    // Connect
    await new Promise<void>((resolve, reject) => {
      const client = new Client();

      client.on('ready', () => {
        activeConnections.set(connectionId, { client });
        conn = activeConnections.get(connectionId);
        resolve();
      });

      client.on('error', (err) => {
        reject(err);
      });

      const config: any = {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        readyTimeout: 15000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      if (connection.privateKey) {
        try {
          config.privateKey = fs.readFileSync(connection.privateKey);
        } catch (err) {
          reject(new Error('Failed to read private key file'));
          return;
        }
      } else if (connection.password) {
        config.password = connection.password;
      }

      // Handle connection close event
      client.on('close', () => {
        console.log(`Connection ${connectionId} closed (ensureReady)`);
        for (const [shellId, shell] of activeShells.entries()) {
          if (shell.connectionId === connectionId) {
            activeShells.delete(shellId);
            allWindows.forEach(win => {
              if (!win.isDestroyed()) {
                win.webContents.send(`ssh:close:${shellId}`);
              }
            });
          }
        }
        activeConnections.delete(connectionId);
      });

      client.connect(config);
    });
  }

  // If SFTP not initialized, initialize it
  if (conn && !conn.sftp) {
    await new Promise<void>((resolve, reject) => {
      conn!.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        conn!.sftp = sftp;
        resolve();
      });
    });
  }

  return { success: true, connectionId };
});

// SSH Shell - now supports multiple shells per connection with auto-reconnect
ipcMain.handle('ssh:shell', async (_event, connectionId: string, shellId?: string) => {
  let conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error('Not connected');
  }

  // Generate shell ID if not provided
  const actualShellId = shellId || `shell-${connectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Helper function to create shell on a connection
  const createShell = (client: Client): Promise<{ success: boolean; shellId: string }> => {
    return new Promise((resolve, reject) => {
      client.shell((err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        // Store the shell session
        activeShells.set(actualShellId, { stream, connectionId });

        stream.on('data', (data: Buffer) => {
          // Send data to the specific shell channel
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send(`ssh:data:${actualShellId}`, data.toString());
            }
          });
        });

        stream.on('close', () => {
          // Clean up and notify - only if not already cleaned up by shellClose
          if (activeShells.has(actualShellId)) {
            activeShells.delete(actualShellId);
            releaseChannel(connectionId);
          }
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send(`ssh:close:${actualShellId}`);
            }
          });
        });

        resolve({ success: true, shellId: actualShellId });
      });
    });
  };

  // Wait for available channel slot
  await waitForChannel(connectionId);

  // First attempt - try with current connection
  try {
    const result = await createShell(conn.client);
    return result;
  } catch (err: any) {
    // If channel open failure, try to reconnect
    if (err.message?.includes('Channel open failure') || err.message?.includes('Channel closed')) {
      console.log(`Channel failure for ${connectionId}, attempting reconnection...`);
      releaseChannel(connectionId);

      // Check if connection is alive
      const isAlive = await isConnectionAlive(connectionId);

      if (!isAlive) {
        // Connection is dead, try to reconnect
        const reconnected = await reconnectConnection(connectionId);

        if (reconnected) {
          // Get the new connection and try again
          conn = activeConnections.get(connectionId);
          if (conn) {
            await waitForChannel(connectionId);
            try {
              const result = await createShell(conn.client);
              return result;
            } catch (retryErr: any) {
              releaseChannel(connectionId);
              throw retryErr;
            }
          }
        }

        throw new Error('Connection lost. Please reconnect to the server.');
      } else {
        // Connection is alive but channel failed - wait and retry once
        await new Promise(r => setTimeout(r, 500));
        await waitForChannel(connectionId);
        try {
          const result = await createShell(conn.client);
          return result;
        } catch (retryErr: any) {
          releaseChannel(connectionId);
          throw retryErr;
        }
      }
    }

    releaseChannel(connectionId);
    throw err;
  }
});

// Close a specific shell
ipcMain.handle('ssh:shellClose', async (_event, shellId: string) => {
  const shell = activeShells.get(shellId);
  if (shell) {
    // Remove from map first to prevent double-release from stream 'close' event
    activeShells.delete(shellId);
    releaseChannel(shell.connectionId);
    try {
      shell.stream.end();
    } catch (e) {
      // Stream may already be closed
    }
  }
  return { success: true };
});

ipcMain.handle('ssh:write', (_event, shellId: string, data: string) => {
  const shell = activeShells.get(shellId);
  if (shell) {
    shell.stream.write(data);
  }
});

ipcMain.handle('ssh:resize', (_event, shellId: string, cols: number, rows: number) => {
  const shell = activeShells.get(shellId);
  if (shell) {
    shell.stream.setWindow(rows, cols, 0, 0);
  }
});

// Local Shell (Personal Console) handlers
ipcMain.handle('local:shell', async (_event) => {
  const shellId = `local-shell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Determine the shell to use based on platform
  const isWindows = process.platform === 'win32';
  const shellCmd = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
  const shellArgs = isWindows ? [] : [];

  // Use saved path or default to home directory
  const savedPath = store.get('lastLocalConsolePath') as string | undefined;
  const defaultPath = process.env.HOME || process.env.USERPROFILE || '/';
  let startPath = savedPath || defaultPath;

  // Verify the path exists, fallback to default if not
  if (savedPath && !fs.existsSync(savedPath)) {
    startPath = defaultPath;
  }

  const proc = spawn(shellCmd, shellArgs, {
    cwd: startPath,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
    shell: false,
    windowsHide: false,
  });

  activeLocalShells.set(shellId, { process: proc, cols: 80, rows: 24 });

  proc.stdout?.on('data', (data: Buffer) => {
    allWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(`local:data:${shellId}`, data.toString());
      }
    });
  });

  proc.stderr?.on('data', (data: Buffer) => {
    allWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(`local:data:${shellId}`, data.toString());
      }
    });
  });

  proc.on('close', (code) => {
    activeLocalShells.delete(shellId);
    allWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(`local:close:${shellId}`, code);
      }
    });
  });

  proc.on('error', (err) => {
    console.error('Local shell error:', err);
    activeLocalShells.delete(shellId);
    allWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(`local:close:${shellId}`, -1);
      }
    });
  });

  return { success: true, shellId };
});

ipcMain.handle('local:shellClose', async (_event, shellId: string) => {
  const localShell = activeLocalShells.get(shellId);
  if (localShell) {
    activeLocalShells.delete(shellId);
    try {
      localShell.process.kill();
    } catch (e) {
      // Process may already be closed
    }
  }
  return { success: true };
});

ipcMain.handle('local:write', (_event, shellId: string, data: string) => {
  const localShell = activeLocalShells.get(shellId);
  if (localShell && localShell.process.stdin) {
    localShell.process.stdin.write(data);
  }
});

ipcMain.handle('local:resize', (_event, shellId: string, cols: number, rows: number) => {
  const localShell = activeLocalShells.get(shellId);
  if (localShell) {
    localShell.cols = cols;
    localShell.rows = rows;
    // Note: child_process doesn't support resize like pty, but we store the values
    // For full PTY support, node-pty would be needed
  }
});

// Save the last local console path
ipcMain.handle('local:savePath', (_event, dirPath: string) => {
  if (dirPath && fs.existsSync(dirPath)) {
    store.set('lastLocalConsolePath', dirPath);
    return { success: true, path: dirPath };
  }
  return { success: false, error: 'Invalid path' };
});

// Get the saved local console path
ipcMain.handle('local:getSavedPath', () => {
  return store.get('lastLocalConsolePath') || process.env.HOME || process.env.USERPROFILE || '/';
});

// Execute SSH command and return output (for dashboard widgets)
ipcMain.handle('ssh:exec', async (_event, connectionId: string, command: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error('Not connected');
  }

  // Wait for available channel slot
  await waitForChannel(connectionId);

  try {
    // Retry logic for channel failures
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
          // Add timeout to prevent hanging
          const timeout = setTimeout(() => {
            reject(new Error('Command execution timed out'));
          }, 30000);

          conn.client.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              reject(err);
              return;
            }

            let stdout = '';
            let stderr = '';

            stream.on('data', (data: Buffer) => {
              stdout += data.toString();
            });

            stream.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });

            stream.on('close', (code: number) => {
              clearTimeout(timeout);
              resolve({ stdout, stderr, code });
            });

            stream.on('error', (streamErr: Error) => {
              clearTimeout(timeout);
              reject(streamErr);
            });
          });
        });
        return result;
      } catch (err: any) {
        lastError = err;
        // If it's a channel open failure, wait briefly and retry
        if (err.message?.includes('Channel open failure') && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error('Command execution failed');
  } finally {
    // Release channel slot
    releaseChannel(connectionId);
  }
});

// Execute SSH command with sudo (prompts for password if needed)
ipcMain.handle('ssh:execSudo', async (_event, connectionId: string, command: string, password?: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error('Not connected');
  }

  // Get the stored connection to retrieve password if available
  const connections = store.get('connections');
  const connection = connections.find((c) => c.id === connectionId);
  const sudoPassword = password || connection?.password || '';

  const sudoCommand = sudoPassword
    ? `echo '${sudoPassword.replace(/'/g, "'\\''")}' | sudo -S ${command}`
    : `sudo ${command}`;

  return new Promise((resolve, reject) => {
    conn.client.exec(sudoCommand, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';

      stream.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      stream.on('close', (code: number) => {
        // Filter out sudo password prompt from stderr
        stderr = stderr.replace(/\[sudo\] password for .+?:/, '').trim();
        resolve({ stdout, stderr, code });
      });
    });
  });
});

// Tunnel management
ipcMain.handle('tunnel:create', async (_event, connectionId: string, config: {
  type: 'local' | 'remote';
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}) => {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error('Not connected');
  }

  const tunnelId = `tunnel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  if (config.type === 'local') {
    // Local port forwarding: listen on local port, forward to remote
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        conn.client.forwardOut(
          config.localHost,
          config.localPort,
          config.remoteHost,
          config.remotePort,
          (err, stream) => {
            if (err) {
              socket.end();
              return;
            }
            socket.pipe(stream).pipe(socket);
          }
        );
      });

      server.on('error', (err) => {
        reject(err);
      });

      server.listen(config.localPort, config.localHost, () => {
        const tunnel: Tunnel = {
          id: tunnelId,
          connectionId,
          type: 'local',
          localHost: config.localHost,
          localPort: config.localPort,
          remoteHost: config.remoteHost,
          remotePort: config.remotePort,
          status: 'active',
          server,
        };
        activeTunnels.set(tunnelId, tunnel);

        // Add to connection's tunnel list
        if (!conn.tunnels) conn.tunnels = [];
        conn.tunnels.push(tunnel);

        resolve({
          success: true,
          tunnel: {
            id: tunnelId,
            connectionId,
            type: 'local',
            localHost: config.localHost,
            localPort: config.localPort,
            remoteHost: config.remoteHost,
            remotePort: config.remotePort,
            status: 'active',
          },
        });
      });
    });
  } else {
    // Remote port forwarding: listen on remote port, forward to local
    return new Promise((resolve, reject) => {
      conn.client.forwardIn(config.remoteHost, config.remotePort, (err) => {
        if (err) {
          reject(err);
          return;
        }

        const tunnel: Tunnel = {
          id: tunnelId,
          connectionId,
          type: 'remote',
          localHost: config.localHost,
          localPort: config.localPort,
          remoteHost: config.remoteHost,
          remotePort: config.remotePort,
          status: 'active',
        };
        activeTunnels.set(tunnelId, tunnel);

        // Add to connection's tunnel list
        if (!conn.tunnels) conn.tunnels = [];
        conn.tunnels.push(tunnel);

        // Handle incoming connections on the forwarded port
        conn.client.on('tcp connection', (info, accept, _reject) => {
          const stream = accept();
          const socket = net.connect(config.localPort, config.localHost, () => {
            stream.pipe(socket).pipe(stream);
          });
          socket.on('error', () => {
            stream.end();
          });
        });

        resolve({
          success: true,
          tunnel: {
            id: tunnelId,
            connectionId,
            type: 'remote',
            localHost: config.localHost,
            localPort: config.localPort,
            remoteHost: config.remoteHost,
            remotePort: config.remotePort,
            status: 'active',
          },
        });
      });
    });
  }
});

ipcMain.handle('tunnel:close', async (_event, tunnelId: string) => {
  const tunnel = activeTunnels.get(tunnelId);
  if (!tunnel) {
    throw new Error('Tunnel not found');
  }

  if (tunnel.type === 'local' && tunnel.server) {
    tunnel.server.close();
  } else if (tunnel.type === 'remote') {
    const conn = activeConnections.get(tunnel.connectionId);
    if (conn) {
      conn.client.unforwardIn(tunnel.remoteHost, tunnel.remotePort, () => {});
    }
  }

  activeTunnels.delete(tunnelId);

  // Remove from connection's tunnel list
  const conn = activeConnections.get(tunnel.connectionId);
  if (conn && conn.tunnels) {
    conn.tunnels = conn.tunnels.filter(t => t.id !== tunnelId);
  }

  return { success: true };
});

ipcMain.handle('tunnel:list', async (_event, connectionId: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    return [];
  }

  return (conn.tunnels || []).map(t => ({
    id: t.id,
    connectionId: t.connectionId,
    type: t.type,
    localHost: t.localHost,
    localPort: t.localPort,
    remoteHost: t.remoteHost,
    remotePort: t.remotePort,
    status: t.status,
  }));
});

ipcMain.handle('tunnel:listAll', async () => {
  return Array.from(activeTunnels.values()).map(t => ({
    id: t.id,
    connectionId: t.connectionId,
    type: t.type,
    localHost: t.localHost,
    localPort: t.localPort,
    remoteHost: t.remoteHost,
    remotePort: t.remotePort,
    status: t.status,
  }));
});

// SFTP operations
ipcMain.handle('sftp:init', async (_event, connectionId: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn) {
    throw new Error('Not connected');
  }

  return new Promise((resolve, reject) => {
    conn.client.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      conn.sftp = sftp;
      resolve({ success: true });
    });
  });
});

ipcMain.handle('sftp:list', async (_event, connectionId: string, remotePath: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  return new Promise((resolve, reject) => {
    conn.sftp!.readdir(remotePath, (err, list) => {
      if (err) {
        reject(err);
        return;
      }
      const files = list.map((item) => ({
        name: item.filename,
        size: item.attrs.size,
        isDirectory: item.attrs.isDirectory(),
        modified: new Date(item.attrs.mtime * 1000).toISOString(),
        permissions: item.attrs.mode,
      }));
      resolve(files);
    });
  });
});

ipcMain.handle('sftp:upload', async (_event, connectionId: string, localPath: string, remotePath: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  return new Promise((resolve, reject) => {
    conn.sftp!.fastPut(localPath, remotePath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ success: true });
    });
  });
});

// Upload folder recursively
// uploadMode: 'overwrite' | 'skip_existing' | 'newer_only'
ipcMain.handle('sftp:uploadFolder', async (
  _event,
  connectionId: string,
  localFolderPath: string,
  remoteFolderPath: string,
  excludePatterns?: string[],
  uploadId?: string,
  uploadMode: 'overwrite' | 'skip_existing' | 'newer_only' = 'overwrite'
) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  // Register upload for cancellation tracking
  const actualUploadId = uploadId || `upload-${Date.now()}`;
  activeUploads.set(actualUploadId, { cancelled: false });

  const sftp = conn.sftp!;
  const excludeSet = new Set(excludePatterns || []);

  // Helper to check if upload was cancelled
  const isCancelled = () => {
    const upload = activeUploads.get(actualUploadId);
    return upload?.cancelled || false;
  };

  // Helper to get remote file stats
  const getRemoteStat = (remotePath: string): Promise<{ exists: boolean; mtime?: number }> => {
    return new Promise((resolve) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          resolve({ exists: false });
        } else {
          resolve({ exists: true, mtime: stats.mtime * 1000 });
        }
      });
    });
  };

  // Helper to create directory (ignore if exists)
  const mkdirSafe = (remotePath: string): Promise<void> => {
    return new Promise((resolve) => {
      sftp.mkdir(remotePath, (err) => {
        // Ignore error if directory already exists
        resolve();
      });
    });
  };

  // Helper to upload a single file
  const uploadFile = (localPath: string, remotePath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  // Helper to check if file should be uploaded based on mode
  const shouldUploadFile = async (localPath: string, remotePath: string): Promise<boolean> => {
    if (uploadMode === 'overwrite') {
      return true;
    }

    const remoteStat = await getRemoteStat(remotePath);

    if (uploadMode === 'skip_existing') {
      return !remoteStat.exists;
    }

    if (uploadMode === 'newer_only') {
      if (!remoteStat.exists) {
        return true;
      }
      const localStat = fs.statSync(localPath);
      const localMtime = localStat.mtimeMs;
      return localMtime > (remoteStat.mtime || 0);
    }

    return true;
  };

  // Recursively collect all files and directories
  const collectItems = (dirPath: string, relativePath: string = ''): { files: { local: string; relative: string; mtime: number }[]; dirs: string[] } => {
    const result: { files: { local: string; relative: string; mtime: number }[]; dirs: string[] } = { files: [], dirs: [] };

    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        // Skip excluded directories
        if (excludeSet.has(item)) {
          continue;
        }

        const localItemPath = path.join(dirPath, item);
        const relativeItemPath = relativePath ? `${relativePath}/${item}` : item;

        try {
          const stat = fs.statSync(localItemPath);

          if (stat.isDirectory()) {
            result.dirs.push(relativeItemPath);
            const subItems = collectItems(localItemPath, relativeItemPath);
            result.files.push(...subItems.files);
            result.dirs.push(...subItems.dirs);
          } else if (stat.isFile()) {
            result.files.push({ local: localItemPath, relative: relativeItemPath, mtime: stat.mtimeMs });
          }
        } catch (e) {
          // Skip items we can't stat
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }

    return result;
  };

  try {
    // Get folder name from path
    const folderName = path.basename(localFolderPath);
    const targetPath = remoteFolderPath === '/' ? `/${folderName}` : `${remoteFolderPath}/${folderName}`;

    // Collect all items
    const items = collectItems(localFolderPath);
    const totalFiles = items.files.length;
    let uploadedCount = 0;
    let skippedCount = 0;

    // Check for cancellation
    if (isCancelled()) {
      activeUploads.delete(actualUploadId);
      return { success: false, cancelled: true, filesUploaded: 0, folderName };
    }

    // Create the root folder
    await mkdirSafe(targetPath);

    // Create all subdirectories (sorted by depth to ensure parents are created first)
    const sortedDirs = items.dirs.sort((a, b) => a.split('/').length - b.split('/').length);
    for (const dir of sortedDirs) {
      if (isCancelled()) {
        activeUploads.delete(actualUploadId);
        return { success: false, cancelled: true, filesUploaded: uploadedCount, skippedFiles: skippedCount, folderName };
      }
      const remoteDir = `${targetPath}/${dir}`;
      await mkdirSafe(remoteDir);
    }

    // Upload files in parallel with concurrency limit
    const CONCURRENCY_LIMIT = 10; // Upload 10 files at a time

    // Helper to upload a batch of files
    const uploadBatch = async (batch: { local: string; relative: string; mtime: number }[]): Promise<void> => {
      await Promise.all(batch.map(async (file) => {
        if (isCancelled()) return;

        const remoteFilePath = `${targetPath}/${file.relative}`;

        // Check if file should be uploaded based on mode
        const shouldUpload = await shouldUploadFile(file.local, remoteFilePath);
        if (!shouldUpload) {
          skippedCount++;
          uploadedCount++;
          // Send progress for skipped files too
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('sftp:uploadProgress', {
                connectionId,
                uploadId: actualUploadId,
                current: uploadedCount,
                total: totalFiles,
                fileName: path.basename(file.local),
                skipped: true,
              });
            }
          });
          return;
        }

        await uploadFile(file.local, remoteFilePath);
        uploadedCount++;

        // Send progress to all windows
        allWindows.forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send('sftp:uploadProgress', {
              connectionId,
              uploadId: actualUploadId,
              current: uploadedCount,
              total: totalFiles,
              fileName: path.basename(file.local),
              skipped: false,
            });
          }
        });
      }));
    };

    // Process files in batches
    for (let i = 0; i < items.files.length; i += CONCURRENCY_LIMIT) {
      if (isCancelled()) {
        activeUploads.delete(actualUploadId);
        return { success: false, cancelled: true, filesUploaded: uploadedCount, skippedFiles: skippedCount, folderName };
      }
      const batch = items.files.slice(i, i + CONCURRENCY_LIMIT);
      await uploadBatch(batch);
    }

    activeUploads.delete(actualUploadId);
    return { success: true, filesUploaded: uploadedCount - skippedCount, skippedFiles: skippedCount, folderName };
  } catch (err) {
    activeUploads.delete(actualUploadId);
    throw err;
  }
});

// Cancel an active upload
ipcMain.handle('sftp:cancelUpload', async (_event, uploadId: string) => {
  const upload = activeUploads.get(uploadId);
  if (upload) {
    upload.cancelled = true;
    return { success: true };
  }
  return { success: false, error: 'Upload not found' };
});

// Get remote file stats (for comparing modification times)
ipcMain.handle('sftp:stat', async (_event, connectionId: string, remotePath: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  return new Promise((resolve, reject) => {
    conn.sftp!.stat(remotePath, (err, stats) => {
      if (err) {
        // File doesn't exist or other error
        resolve({ exists: false });
        return;
      }
      resolve({
        exists: true,
        size: stats.size,
        mtime: stats.mtime * 1000, // Convert to milliseconds
        isDirectory: stats.isDirectory(),
      });
    });
  });
});

ipcMain.handle('sftp:download', async (_event, connectionId: string, remotePath: string, localPath: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  return new Promise((resolve, reject) => {
    conn.sftp!.fastGet(remotePath, localPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ success: true });
    });
  });
});

ipcMain.handle('sftp:delete', async (_event, connectionId: string, remotePath: string, isDirectory: boolean) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  const sftp = conn.sftp!;

  // Helper to delete a single file
  const deleteFile = (filePath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      sftp.unlink(filePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  // Helper to remove an empty directory
  const removeDir = (dirPath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      sftp.rmdir(dirPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  // Helper to list directory contents
  const listDir = (dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> => {
    return new Promise((resolve, reject) => {
      sftp.readdir(dirPath, (err, list) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(list.map(item => ({
          name: item.filename,
          isDirectory: item.attrs.isDirectory(),
        })));
      });
    });
  };

  // Recursive delete function
  const deleteRecursive = async (itemPath: string, isDir: boolean): Promise<void> => {
    if (!isDir) {
      await deleteFile(itemPath);
      return;
    }

    // List directory contents
    const items = await listDir(itemPath);

    // Delete all contents first
    for (const item of items) {
      const childPath = `${itemPath}/${item.name}`;
      await deleteRecursive(childPath, item.isDirectory);
    }

    // Now delete the empty directory
    await removeDir(itemPath);
  };

  await deleteRecursive(remotePath, isDirectory);
  return { success: true };
});

ipcMain.handle('sftp:mkdir', async (_event, connectionId: string, remotePath: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  return new Promise((resolve, reject) => {
    conn.sftp!.mkdir(remotePath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ success: true });
    });
  });
});

// Dialog for file selection
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
  });
  return result.filePaths;
});

// Open external URL in system browser
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Show item in folder (File Explorer)
ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

// Health check URL (bypasses CSP)
ipcMain.handle('healthCheck', async (_event, url: string, expectedStatus: number) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 Nice-SSH-Client Health-Check' },
    });
    const responseTime = Date.now() - startTime;

    clearTimeout(timeout);

    return {
      success: true,
      status: response.status,
      isUp: response.status === expectedStatus,
      responseTime,
    };
  } catch (error: any) {
    return {
      success: false,
      isUp: false,
      error: error.name === 'AbortError' ? 'Timeout' : error.message,
    };
  }
});

// Fetch favicon from URL (bypasses CSP)
ipcMain.handle('fetchFavicon', async (_event, url: string) => {
  try {
    const urlObj = new URL(url);
    const faviconUrls = [
      `https://${urlObj.hostname}/favicon.ico`,
      `https://${urlObj.hostname}/favicon.png`,
      `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`,
    ];

    for (const faviconUrl of faviconUrls) {
      try {
        const response = await fetch(faviconUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const contentType = response.headers.get('content-type') || 'image/x-icon';
          return { success: true, data: `data:${contentType};base64,${base64}` };
        }
      } catch {
        // Try next URL
      }
    }

    return { success: false, error: 'No favicon found' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// GitHub Device Flow Authentication
const GITHUB_CLIENT_ID = 'Ov23liSM7jN8gau6yri8';

ipcMain.handle('github:startDeviceFlow', async () => {
  try {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: 'repo read:user',
      }),
    });

    const data = await response.json() as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || data.error) {
      const errorMsg = data.error_description || data.error || `HTTP ${response.status}`;
      console.error('GitHub Device Flow error:', errorMsg);
      return { success: false, error: `GitHub API error: ${errorMsg}` };
    }

    if (!data.device_code || !data.user_code) {
      return { success: false, error: 'Invalid response from GitHub' };
    }

    return {
      success: true,
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || 'https://github.com/login/device',
      expires_in: data.expires_in || 900,
      interval: data.interval || 5,
    };
  } catch (error: any) {
    console.error('GitHub Device Flow exception:', error);
    return { success: false, error: error.message || 'Network error connecting to GitHub' };
  }
});

ipcMain.handle('github:pollDeviceFlow', async (_event, deviceCode: string) => {
  try {
    console.log('Polling GitHub with device_code:', deviceCode);
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = await response.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    console.log('GitHub poll response:', JSON.stringify(data));

    if (data.access_token) {
      return { success: true, access_token: data.access_token };
    } else if (data.error === 'authorization_pending') {
      return { success: false, pending: true };
    } else if (data.error === 'slow_down') {
      return { success: false, slow_down: true };
    } else if (data.error === 'expired_token') {
      return { success: false, error: 'Code expired. Please try again.' };
    } else if (data.error === 'access_denied') {
      return { success: false, error: 'Access denied by user.' };
    } else {
      return { success: false, error: data.error_description || data.error || 'Unknown error' };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('github:getUser', async (_event, token: string) => {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    const data = await response.json() as Record<string, unknown>;
    return { success: true, user: data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('github:getRepos', async (_event, token: string) => {
  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    };

    // Fetch user's own repos
    const userReposResponse = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator', {
      headers,
    });

    if (!userReposResponse.ok) {
      throw new Error('Failed to get user repos');
    }

    const userRepos = await userReposResponse.json() as Record<string, unknown>[];

    // Fetch user's organizations
    const orgsResponse = await fetch('https://api.github.com/user/orgs', {
      headers,
    });

    let orgRepos: Record<string, unknown>[] = [];
    if (orgsResponse.ok) {
      const orgs = await orgsResponse.json() as { login: string }[];

      // Fetch repos from each organization
      for (const org of orgs) {
        try {
          const orgReposResponse = await fetch(`https://api.github.com/orgs/${org.login}/repos?per_page=100&sort=updated`, {
            headers,
          });

          if (orgReposResponse.ok) {
            const repos = await orgReposResponse.json() as Record<string, unknown>[];
            // Add org name to each repo for display
            repos.forEach(repo => {
              (repo as any).org = org.login;
            });
            orgRepos.push(...repos);
          }
        } catch (e) {
          // Skip org repos that fail to fetch
          console.error(`Failed to fetch repos for org ${org.login}:`, e);
        }
      }
    }

    // Combine and deduplicate repos (by full_name)
    const allRepos = [...userRepos, ...orgRepos];
    const uniqueRepos = allRepos.filter((repo, index, self) =>
      index === self.findIndex(r => (r as any).full_name === (repo as any).full_name)
    );

    // Sort by updated_at
    uniqueRepos.sort((a, b) => {
      const dateA = new Date((a as any).updated_at || 0).getTime();
      const dateB = new Date((b as any).updated_at || 0).getTime();
      return dateB - dateA;
    });

    return { success: true, repos: uniqueRepos };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// GitHub Config Sync - Push to repo
ipcMain.handle('github:push', async (_event, token: string, repo: string, filePath: string) => {
  try {
    // Get connections and preferences from electron-store
    const connections = store.get('connections', []);
    const preferences = store.get('preferences', {});
    const shortcuts = store.get('shortcuts', []);
    const packages = store.get('packages', []);
    const tabGroups = store.get('tabGroups', []);

    // Create config object to sync (exclude sensitive GitHub token)
    const config = {
      version: 1,
      exportedAt: new Date().toISOString(),
      connections: connections,
      preferences: { ...preferences, githubToken: undefined }, // Don't sync the token
      shortcuts: shortcuts,
      packages: packages,
      tabGroups: tabGroups,
    };

    const content = JSON.stringify(config, null, 2);
    const contentBase64 = Buffer.from(content).toString('base64');

    // First, try to get the existing file to get its SHA (for updates)
    let sha: string | undefined;
    try {
      const getResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (getResponse.ok) {
        const existingFile = await getResponse.json() as { sha: string };
        sha = existingFile.sha;
      }
    } catch {
      // File doesn't exist, that's fine
    }

    // Create or update the file
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Update Nice SSH Client config - ${new Date().toLocaleString()}`,
        content: contentBase64,
        sha: sha,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as { message?: string };
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return { success: true };
  } catch (error: any) {
    console.error('GitHub push error:', error);
    return { success: false, error: error.message };
  }
});

// GitHub Config Sync - Pull from repo
ipcMain.handle('github:pull', async (_event, token: string, repo: string, filePath: string) => {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Config file not found in repository. Push your config first.');
      }
      const errorData = await response.json() as { message?: string };
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json() as { content: string; encoding: string };

    if (data.encoding !== 'base64') {
      throw new Error('Unexpected file encoding');
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const config = JSON.parse(content);

    // Validate the config
    if (!config.version || config.version !== 1) {
      throw new Error('Invalid or unsupported config version');
    }

    // Save to electron-store
    if (config.connections) {
      store.set('connections', config.connections);
    }
    if (config.preferences) {
      // Merge preferences but keep the local token
      const currentPrefs = store.get('preferences', {}) as Record<string, unknown>;
      store.set('preferences', { ...config.preferences, githubToken: currentPrefs.githubToken });
    }
    if (config.shortcuts) {
      store.set('shortcuts', config.shortcuts);
    }
    if (config.packages) {
      store.set('packages', config.packages);
    }
    if (config.tabGroups) {
      store.set('tabGroups', config.tabGroups);
    }

    return { success: true };
  } catch (error: any) {
    console.error('GitHub pull error:', error);
    return { success: false, error: error.message };
  }
});

// Upload multiple files from paths (for drag and drop) - parallel upload
ipcMain.handle('sftp:uploadMultiple', async (_event, connectionId: string, files: { localPath: string; remotePath: string }[]) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  const CONCURRENCY_LIMIT = 10;
  const results: { file: string; success: boolean; error?: string }[] = [];

  // Helper to upload a single file
  const uploadFile = async (file: { localPath: string; remotePath: string }) => {
    try {
      await new Promise<void>((resolve, reject) => {
        conn.sftp!.fastPut(file.localPath, file.remotePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return { file: file.localPath, success: true };
    } catch (err: any) {
      return { file: file.localPath, success: false, error: err.message };
    }
  };

  // Process files in batches
  for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
    const batch = files.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map(uploadFile));
    results.push(...batchResults);
  }

  return results;
});

ipcMain.handle('dialog:saveFile', async (_event, defaultName: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
  });
  return result.filePath;
});

ipcMain.handle('dialog:selectPrivateKey', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Private Key', extensions: ['pem', 'ppk', ''] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.filePaths[0];
});

ipcMain.handle('app:getTempPath', (_event, fileName: string) => {
  const tempDir = app.getPath('temp');
  const uniqueName = `${Date.now()}-${fileName}`;
  return path.join(tempDir, uniqueName);
});

// Save buffer to temp file (for clipboard paste)
ipcMain.handle('app:saveTempFile', async (_event, fileName: string, data: number[]) => {
  try {
    const tempDir = app.getPath('temp');
    const uniqueName = `${Date.now()}-${fileName}`;
    const tempPath = path.join(tempDir, uniqueName);

    // Convert number array back to Buffer and write to file
    const buffer = Buffer.from(data);
    fs.writeFileSync(tempPath, buffer);

    return { success: true, path: tempPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Delete temp file
ipcMain.handle('app:deleteTempFile', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Check if a local path is a directory
ipcMain.handle('fs:isDirectory', (_event, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    return stat.isDirectory();
  } catch (e) {
    return false;
  }
});

// Check if a folder contains node_modules (recursively with depth limit)
ipcMain.handle('fs:hasNodeModules', (_event, folderPath: string, maxDepth: number = 10) => {
  const checkForNodeModules = (dirPath: string, currentDepth: number = 0): boolean => {
    // Stop recursion if we've gone too deep
    if (currentDepth > maxDepth) {
      return false;
    }

    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        // Check if this item is node_modules first (fast path)
        if (item === 'node_modules') {
          const itemPath = path.join(dirPath, item);
          try {
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              return true;
            }
          } catch (e) {
            // Skip items we can't stat
          }
        }
      }

      // Then recursively check subdirectories
      for (const item of items) {
        // Skip common directories that won't contain node_modules
        if (item === '.git' || item === 'dist' || item === 'build' || item === 'out' || item === '.next') {
          continue;
        }

        const itemPath = path.join(dirPath, item);
        try {
          const stat = fs.statSync(itemPath);
          if (stat.isDirectory() && item !== 'node_modules') {
            // Recursively check subdirectories
            if (checkForNodeModules(itemPath, currentDepth + 1)) {
              return true;
            }
          }
        } catch (e) {
          // Skip items we can't stat (permission issues, etc.)
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  return checkForNodeModules(folderPath, 0);
});

// Read files from system clipboard (for paste from file explorer)
ipcMain.handle('clipboard:getFiles', () => {
  try {
    // On Windows, copied files are available via clipboard.read() with 'FileNameW' format
    // The clipboard module in Electron provides read/write access
    if (process.platform === 'win32') {
      // Read the file paths from clipboard
      const buffer = clipboard.readBuffer('FileNameW');
      if (buffer && buffer.length > 0) {
        // FileNameW is null-terminated UTF-16LE strings
        const str = buffer.toString('utf16le');
        // Split by null characters and filter empty strings
        const paths = str.split('\0').filter(p => p.trim().length > 0);
        // Validate paths exist
        const validPaths = paths.filter(p => {
          try {
            fs.accessSync(p);
            return true;
          } catch {
            return false;
          }
        });
        if (validPaths.length > 0) {
          return { success: true, paths: validPaths };
        }
      }
    }
    // macOS and Linux use different clipboard formats
    // For now, return empty for non-Windows
    return { success: false, paths: [] };
  } catch (e) {
    return { success: false, paths: [], error: String(e) };
  }
});

// Shortcuts management
ipcMain.handle('shortcuts:getAll', (_event, connectionId: string) => {
  const shortcuts = store.get('shortcuts');
  return shortcuts.filter((s) => s.connectionId === connectionId);
});

ipcMain.handle('shortcuts:save', (_event, shortcut: Shortcut) => {
  const shortcuts = store.get('shortcuts');
  const existingIndex = shortcuts.findIndex((s) => s.id === shortcut.id);

  if (existingIndex >= 0) {
    shortcuts[existingIndex] = shortcut;
  } else {
    shortcuts.push(shortcut);
  }

  store.set('shortcuts', shortcuts);
  return shortcuts.filter((s) => s.connectionId === shortcut.connectionId);
});

ipcMain.handle('shortcuts:delete', (_event, shortcutId: string, connectionId: string) => {
  const shortcuts = store.get('shortcuts').filter((s) => s.id !== shortcutId);
  store.set('shortcuts', shortcuts);
  return shortcuts.filter((s) => s.connectionId === connectionId);
});

// Last path management
ipcMain.handle('lastPath:get', (_event, connectionId: string) => {
  const lastPaths = store.get('lastPaths');
  return lastPaths[connectionId] || '/';
});

ipcMain.handle('lastPath:save', (_event, connectionId: string, path: string) => {
  const lastPaths = store.get('lastPaths');
  lastPaths[connectionId] = path;
  store.set('lastPaths', lastPaths);
  return path;
});

// Package shortcuts management
ipcMain.handle('packages:getAll', () => {
  return store.get('packageShortcuts');
});

ipcMain.handle('packages:save', (_event, pkg: PackageShortcut) => {
  const packages = store.get('packageShortcuts');
  const existingIndex = packages.findIndex((p) => p.id === pkg.id);

  if (existingIndex >= 0) {
    packages[existingIndex] = pkg;
  } else {
    packages.push(pkg);
  }

  store.set('packageShortcuts', packages);
  return packages;
});

ipcMain.handle('packages:delete', (_event, packageId: string) => {
  const packages = store.get('packageShortcuts').filter((p) => p.id !== packageId);
  store.set('packageShortcuts', packages);
  return packages;
});

ipcMain.handle('packages:reset', () => {
  store.set('packageShortcuts', defaultPackageShortcuts);
  return defaultPackageShortcuts;
});

// Tab groups management
ipcMain.handle('tabGroups:getAll', () => {
  return store.get('tabGroups');
});

ipcMain.handle('tabGroups:save', (_event, groups: TabGroup[]) => {
  store.set('tabGroups', groups);
  return groups;
});

ipcMain.handle('tabGroups:delete', (_event, groupId: string) => {
  const groups = store.get('tabGroups').filter((g) => g.id !== groupId);
  store.set('tabGroups', groups);
  return groups;
});

// Download file to temp directory for native drag-out
ipcMain.handle('sftp:downloadToTemp', async (_event, connectionId: string, remotePath: string, fileName: string) => {
  const conn = activeConnections.get(connectionId);
  if (!conn?.sftp) {
    throw new Error('SFTP not initialized');
  }

  const tempDir = path.join(app.getPath('temp'), 'nice-ssh-client-drag');

  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const localPath = path.join(tempDir, fileName);

  return new Promise((resolve, reject) => {
    conn.sftp!.fastGet(remotePath, localPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ success: true, localPath });
    });
  });
});

// Start native drag operation - uses 'on' instead of 'handle' for synchronous response
ipcMain.on('native:startDrag', (event, filePaths: string[]) => {
  if (!filePaths || filePaths.length === 0) {
    console.error('No files to drag');
    return;
  }

  try {
    // Create a simple file icon for the drag operation
    const iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADfSURBVFiF7ZcxDoMwDEV/qlgYGZm5CnfgDFyGM3AHrsJIODIywVIFk6BBFAK0UpfYS6T4/+ckTgIAFPgN+Ebgx0nUxDJZEuqZSABIAQNaQCegj0AfQAlQ9wEeQIVJBwUqgKIvUGL8sQCF7YBiv9YDV4BfCxA2gDoAvXKJ9X/LAhRACB2ggA6Q9wGeQIX8v0INwAFI+wBfoMLxzlIA+EZgB5D3AU5AhXwi7h3wjUDbB3gCFY5XgAIIAWof4AlUOJ4fByjwGwKu/3+OV8A3An+MAiJR4DeE8Y/xCkg8f8sfsAFz4DtZp5gAAAAASUVORK5CYII=';
    const icon = nativeImage.createFromDataURL(iconDataUrl);

    // startDrag requires 'file' property (first file), 'files' is optional for multiple
    event.sender.startDrag({
      file: filePaths[0],
      files: filePaths,
      icon: icon,
    });
  } catch (error: any) {
    console.error('startDrag failed:', error);
  }
});

// Clean up temp drag files
ipcMain.handle('native:cleanupTempFiles', async () => {
  const tempDir = path.join(app.getPath('temp'), 'nice-ssh-client-drag');

  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stat = fs.statSync(filePath);
        // Only remove files older than 5 minutes
        if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
          fs.unlinkSync(filePath);
        }
      }
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
