import { contextBridge, ipcRenderer } from 'electron';

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

interface FileInfo {
  name: string;
  size: number;
  isDirectory: boolean;
  modified: string;
  permissions: number;
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

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

const electronAPI = {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  createNewWindow: (connectionId: string, mode?: string): Promise<{ success: boolean; windowId: number }> =>
    ipcRenderer.invoke('window:createNew', connectionId, mode),

  // Connection management
  getConnections: (): Promise<Connection[]> => ipcRenderer.invoke('connections:getAll'),
  saveConnection: (connection: Connection): Promise<Connection[]> =>
    ipcRenderer.invoke('connections:save', connection),
  deleteConnection: (id: string): Promise<Connection[]> => ipcRenderer.invoke('connections:delete', id),
  saveAllConnections: (connections: Connection[]): Promise<Connection[]> =>
    ipcRenderer.invoke('connections:saveAll', connections),

  // SSH
  connect: (connectionId: string) => ipcRenderer.invoke('ssh:connect', connectionId),
  disconnect: (connectionId: string) => ipcRenderer.invoke('ssh:disconnect', connectionId),
  ensureReady: (connectionId: string): Promise<{ success: boolean; connectionId: string }> =>
    ipcRenderer.invoke('ssh:ensureReady', connectionId),
  shell: (connectionId: string, shellId?: string): Promise<{ success: boolean; shellId: string }> =>
    ipcRenderer.invoke('ssh:shell', connectionId, shellId),
  shellClose: (shellId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('ssh:shellClose', shellId),
  write: (shellId: string, data: string) => ipcRenderer.invoke('ssh:write', shellId, data),
  resize: (shellId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('ssh:resize', shellId, cols, rows),
  exec: (connectionId: string, command: string): Promise<CommandResult> =>
    ipcRenderer.invoke('ssh:exec', connectionId, command),
  execSudo: (connectionId: string, command: string, password?: string): Promise<CommandResult> =>
    ipcRenderer.invoke('ssh:execSudo', connectionId, command, password),

  // SSH event listeners - now use shellId instead of connectionId
  onData: (shellId: string, callback: (data: string) => void) => {
    const channel = `ssh:data:${shellId}`;
    const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onClose: (shellId: string, callback: () => void) => {
    const channel = `ssh:close:${shellId}`;
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // Local Shell (Personal Console)
  localShell: (): Promise<{ success: boolean; shellId: string }> =>
    ipcRenderer.invoke('local:shell'),
  localShellClose: (shellId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('local:shellClose', shellId),
  localWrite: (shellId: string, data: string) =>
    ipcRenderer.invoke('local:write', shellId, data),
  localResize: (shellId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('local:resize', shellId, cols, rows),
  onLocalData: (shellId: string, callback: (data: string) => void) => {
    const channel = `local:data:${shellId}`;
    const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onLocalClose: (shellId: string, callback: (code: number) => void) => {
    const channel = `local:close:${shellId}`;
    const listener = (_event: Electron.IpcRendererEvent, code: number) => callback(code);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  localSavePath: (dirPath: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('local:savePath', dirPath),
  localGetSavedPath: (): Promise<string> =>
    ipcRenderer.invoke('local:getSavedPath'),

  // SFTP
  sftpInit: (connectionId: string) => ipcRenderer.invoke('sftp:init', connectionId),
  sftpList: (connectionId: string, path: string): Promise<FileInfo[]> =>
    ipcRenderer.invoke('sftp:list', connectionId, path),
  sftpUpload: (connectionId: string, localPath: string, remotePath: string) =>
    ipcRenderer.invoke('sftp:upload', connectionId, localPath, remotePath),
  sftpDownload: (connectionId: string, remotePath: string, localPath: string) =>
    ipcRenderer.invoke('sftp:download', connectionId, remotePath, localPath),
  sftpDelete: (connectionId: string, path: string, isDirectory: boolean) =>
    ipcRenderer.invoke('sftp:delete', connectionId, path, isDirectory),
  sftpMkdir: (connectionId: string, path: string) => ipcRenderer.invoke('sftp:mkdir', connectionId, path),
  sftpUploadMultiple: (connectionId: string, files: { localPath: string; remotePath: string }[]) =>
    ipcRenderer.invoke('sftp:uploadMultiple', connectionId, files),
  sftpUploadFolder: (
    connectionId: string,
    localFolderPath: string,
    remoteFolderPath: string,
    excludePatterns?: string[],
    uploadId?: string,
    uploadMode?: 'overwrite' | 'skip_existing' | 'newer_only'
  ): Promise<{ success: boolean; filesUploaded: number; skippedFiles?: number; folderName: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('sftp:uploadFolder', connectionId, localFolderPath, remoteFolderPath, excludePatterns, uploadId, uploadMode),
  sftpCancelUpload: (uploadId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sftp:cancelUpload', uploadId),
  sftpStat: (connectionId: string, remotePath: string): Promise<{ exists: boolean; size?: number; mtime?: number; isDirectory?: boolean }> =>
    ipcRenderer.invoke('sftp:stat', connectionId, remotePath),
  isDirectory: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:isDirectory', filePath),
  hasNodeModules: (folderPath: string, maxDepth?: number): Promise<boolean> =>
    ipcRenderer.invoke('fs:hasNodeModules', folderPath, maxDepth),
  getClipboardFiles: (): Promise<{ success: boolean; paths: string[]; error?: string }> =>
    ipcRenderer.invoke('clipboard:getFiles'),
  onUploadProgress: (callback: (data: { connectionId: string; uploadId?: string; current: number; total: number; fileName: string; skipped?: boolean }) => void) => {
    const listener = (_event: any, data: { connectionId: string; uploadId?: string; current: number; total: number; fileName: string; skipped?: boolean }) => callback(data);
    ipcRenderer.on('sftp:uploadProgress', listener);
    return () => ipcRenderer.removeListener('sftp:uploadProgress', listener);
  },

  // Dialogs
  openFileDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (defaultName: string): Promise<string | undefined> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),
  selectPrivateKey: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:selectPrivateKey'),
  getTempPath: (fileName: string): Promise<string> => ipcRenderer.invoke('app:getTempPath', fileName),
  saveTempFile: (fileName: string, data: number[]): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('app:saveTempFile', fileName, data),
  deleteTempFile: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:deleteTempFile', filePath),

  // Shell
  openExternal: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (filePath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('shell:showItemInFolder', filePath),
  fetchFavicon: (url: string): Promise<{ success: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('fetchFavicon', url),
  healthCheck: (url: string, expectedStatus: number): Promise<{
    success: boolean;
    status?: number;
    isUp?: boolean;
    responseTime?: number;
    error?: string;
  }> => ipcRenderer.invoke('healthCheck', url, expectedStatus),

  // GitHub Device Flow
  githubStartDeviceFlow: (): Promise<{
    success: boolean;
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
  }> => ipcRenderer.invoke('github:startDeviceFlow'),
  githubPollDeviceFlow: (deviceCode: string): Promise<{
    success: boolean;
    access_token?: string;
    pending?: boolean;
    slow_down?: boolean;
    error?: string;
  }> => ipcRenderer.invoke('github:pollDeviceFlow', deviceCode),
  githubGetUser: (token: string): Promise<{ success: boolean; user?: any; error?: string }> =>
    ipcRenderer.invoke('github:getUser', token),
  githubGetRepos: (token: string): Promise<{ success: boolean; repos?: any[]; error?: string }> =>
    ipcRenderer.invoke('github:getRepos', token),
  githubPush: (token: string, repo: string, filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('github:push', token, repo, filePath),
  githubPull: (token: string, repo: string, filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('github:pull', token, repo, filePath),

  // Shortcuts
  getShortcuts: (connectionId: string): Promise<Shortcut[]> =>
    ipcRenderer.invoke('shortcuts:getAll', connectionId),
  saveShortcut: (shortcut: Shortcut): Promise<Shortcut[]> =>
    ipcRenderer.invoke('shortcuts:save', shortcut),
  deleteShortcut: (shortcutId: string, connectionId: string): Promise<Shortcut[]> =>
    ipcRenderer.invoke('shortcuts:delete', shortcutId, connectionId),

  // Last path
  getLastPath: (connectionId: string): Promise<string> =>
    ipcRenderer.invoke('lastPath:get', connectionId),
  saveLastPath: (connectionId: string, path: string): Promise<string> =>
    ipcRenderer.invoke('lastPath:save', connectionId, path),

  // Package shortcuts
  getPackages: (): Promise<PackageShortcut[]> =>
    ipcRenderer.invoke('packages:getAll'),
  savePackage: (pkg: PackageShortcut): Promise<PackageShortcut[]> =>
    ipcRenderer.invoke('packages:save', pkg),
  deletePackage: (packageId: string): Promise<PackageShortcut[]> =>
    ipcRenderer.invoke('packages:delete', packageId),
  resetPackages: (): Promise<PackageShortcut[]> =>
    ipcRenderer.invoke('packages:reset'),

  // Tab groups
  getTabGroups: (): Promise<TabGroup[]> =>
    ipcRenderer.invoke('tabGroups:getAll'),
  saveTabGroups: (groups: TabGroup[]): Promise<TabGroup[]> =>
    ipcRenderer.invoke('tabGroups:save', groups),
  deleteTabGroup: (groupId: string): Promise<TabGroup[]> =>
    ipcRenderer.invoke('tabGroups:delete', groupId),

  // Native drag-out
  sftpDownloadToTemp: (connectionId: string, remotePath: string, fileName: string): Promise<{ success: boolean; localPath: string }> =>
    ipcRenderer.invoke('sftp:downloadToTemp', connectionId, remotePath, fileName),
  nativeStartDrag: (filePaths: string[]): void =>
    ipcRenderer.send('native:startDrag', filePaths),
  nativeCleanupTempFiles: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('native:cleanupTempFiles'),

  // Terminal copy event listener
  onTerminalCopy: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('terminal-copy', listener);
    return () => ipcRenderer.removeListener('terminal-copy', listener);
  },

  // Tunnel management
  tunnelCreate: (connectionId: string, config: {
    type: 'local' | 'remote';
    localHost: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
  }): Promise<{ success: boolean; tunnel?: any; error?: string }> =>
    ipcRenderer.invoke('tunnel:create', connectionId, config),
  tunnelClose: (tunnelId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('tunnel:close', tunnelId),
  tunnelList: (connectionId: string): Promise<any[]> =>
    ipcRenderer.invoke('tunnel:list', connectionId),
  tunnelListAll: (): Promise<any[]> =>
    ipcRenderer.invoke('tunnel:listAll'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
