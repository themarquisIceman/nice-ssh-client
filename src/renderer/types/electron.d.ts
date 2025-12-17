export interface Connection {
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

export interface FileInfo {
  name: string;
  size: number;
  isDirectory: boolean;
  modified: string;
  permissions: number;
}

export interface Shortcut {
  id: string;
  connectionId: string;
  name: string;
  path: string;
  type?: 'folder' | 'file';
}

export interface PackageShortcut {
  id: string;
  name: string;
  description: string;
  installCommand: string;
  checkCommand: string;
  icon?: string;
  category: 'container' | 'runtime' | 'tool' | 'custom';
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  createNewWindow: (connectionId: string, mode?: string) => Promise<{ success: boolean; windowId: number }>;

  getConnections: () => Promise<Connection[]>;
  saveConnection: (connection: Connection) => Promise<Connection[]>;
  deleteConnection: (id: string) => Promise<Connection[]>;
  saveAllConnections: (connections: Connection[]) => Promise<Connection[]>;

  connect: (connectionId: string) => Promise<{ success: boolean; connectionId: string }>;
  disconnect: (connectionId: string) => Promise<{ success: boolean }>;
  ensureReady: (connectionId: string) => Promise<{ success: boolean; connectionId: string }>;
  shell: (connectionId: string, shellId?: string) => Promise<{ success: boolean; shellId: string }>;
  shellClose: (shellId: string) => Promise<{ success: boolean }>;
  write: (shellId: string, data: string) => Promise<void>;
  resize: (shellId: string, cols: number, rows: number) => Promise<void>;
  exec: (connectionId: string, command: string) => Promise<CommandResult>;
  execSudo: (connectionId: string, command: string, password?: string) => Promise<CommandResult>;

  onData: (shellId: string, callback: (data: string) => void) => () => void;
  onClose: (shellId: string, callback: () => void) => () => void;

  // Local Shell (Personal Console)
  localShell: () => Promise<{ success: boolean; shellId: string }>;
  localShellClose: (shellId: string) => Promise<{ success: boolean }>;
  localWrite: (shellId: string, data: string) => Promise<void>;
  localResize: (shellId: string, cols: number, rows: number) => Promise<void>;
  onLocalData: (shellId: string, callback: (data: string) => void) => () => void;
  onLocalClose: (shellId: string, callback: (code: number) => void) => () => void;
  localSavePath: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  localGetSavedPath: () => Promise<string>;

  sftpInit: (connectionId: string) => Promise<{ success: boolean }>;
  sftpList: (connectionId: string, path: string) => Promise<FileInfo[]>;
  sftpUpload: (connectionId: string, localPath: string, remotePath: string) => Promise<{ success: boolean }>;
  sftpDownload: (connectionId: string, remotePath: string, localPath: string) => Promise<{ success: boolean }>;
  sftpDelete: (connectionId: string, path: string, isDirectory: boolean) => Promise<{ success: boolean }>;
  sftpMkdir: (connectionId: string, path: string) => Promise<{ success: boolean }>;
  sftpUploadMultiple: (connectionId: string, files: { localPath: string; remotePath: string }[]) => Promise<{ file: string; success: boolean; error?: string }[]>;
  sftpUploadFolder: (connectionId: string, localFolderPath: string, remoteFolderPath: string, excludePatterns?: string[]) => Promise<{ success: boolean; filesUploaded: number; folderName: string }>;
  isDirectory: (filePath: string) => Promise<boolean>;
  hasNodeModules: (folderPath: string) => Promise<boolean>;
  onUploadProgress: (callback: (data: { connectionId: string; current: number; total: number; fileName: string }) => void) => () => void;

  openFileDialog: () => Promise<string[]>;
  saveFileDialog: (defaultName: string) => Promise<string | undefined>;
  selectPrivateKey: () => Promise<string | undefined>;
  getTempPath: (fileName: string) => Promise<string>;
  saveTempFile: (fileName: string, data: number[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  deleteTempFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;

  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  showItemInFolder: (filePath: string) => Promise<{ success: boolean }>;
  fetchFavicon: (url: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  healthCheck: (url: string, expectedStatus: number) => Promise<{
    success: boolean;
    status?: number;
    isUp?: boolean;
    responseTime?: number;
    error?: string;
  }>;

  // GitHub Device Flow
  githubStartDeviceFlow: () => Promise<{
    success: boolean;
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
  }>;
  githubPollDeviceFlow: (deviceCode: string) => Promise<{
    success: boolean;
    access_token?: string;
    pending?: boolean;
    slow_down?: boolean;
    error?: string;
  }>;
  githubGetUser: (token: string) => Promise<{ success: boolean; user?: any; error?: string }>;
  githubGetRepos: (token: string) => Promise<{ success: boolean; repos?: any[]; error?: string }>;
  githubPush: (token: string, repo: string, filePath: string) => Promise<{ success: boolean; error?: string }>;
  githubPull: (token: string, repo: string, filePath: string) => Promise<{ success: boolean; error?: string }>;

  getShortcuts: (connectionId: string) => Promise<Shortcut[]>;
  saveShortcut: (shortcut: Shortcut) => Promise<Shortcut[]>;
  deleteShortcut: (shortcutId: string, connectionId: string) => Promise<Shortcut[]>;

  getLastPath: (connectionId: string) => Promise<string>;
  saveLastPath: (connectionId: string, path: string) => Promise<string>;

  getPackages: () => Promise<PackageShortcut[]>;
  savePackage: (pkg: PackageShortcut) => Promise<PackageShortcut[]>;
  deletePackage: (packageId: string) => Promise<PackageShortcut[]>;
  resetPackages: () => Promise<PackageShortcut[]>;

  getTabGroups: () => Promise<TabGroup[]>;
  saveTabGroups: (groups: TabGroup[]) => Promise<TabGroup[]>;
  deleteTabGroup: (groupId: string) => Promise<TabGroup[]>;

  // Native drag-out
  sftpDownloadToTemp: (connectionId: string, remotePath: string, fileName: string) => Promise<{ success: boolean; localPath: string }>;
  nativeStartDrag: (filePaths: string[]) => void;
  nativeCleanupTempFiles: () => Promise<{ success: boolean; error?: string }>;

  // Terminal copy event
  onTerminalCopy: (callback: () => void) => () => void;

  // Tunnel management
  tunnelCreate: (connectionId: string, config: {
    type: 'local' | 'remote';
    localHost: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
  }) => Promise<{ success: boolean; tunnel?: TunnelInfo; error?: string }>;
  tunnelClose: (tunnelId: string) => Promise<{ success: boolean }>;
  tunnelList: (connectionId: string) => Promise<TunnelInfo[]>;
  tunnelListAll: () => Promise<TunnelInfo[]>;
}

export interface TunnelInfo {
  id: string;
  connectionId: string;
  type: 'local' | 'remote';
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: 'active' | 'error';
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
