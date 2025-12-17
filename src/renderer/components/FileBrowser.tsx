import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FileInfo, Shortcut } from '../types/electron';
import { v4 as uuidv4 } from 'uuid';
import './FileBrowser.css';

interface FileBrowserProps {
  connectionId: string;
  onPathChange?: (path: string) => void;
  onOpenTerminal?: (path: string) => void;
}

function FileBrowser({ connectionId, onPathChange, onOpenTerminal }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<{ file: string; count: number; total: number; skipped?: boolean } | null>(null);
  const [uploadMode, setUploadMode] = useState<'overwrite' | 'skip_existing' | 'newer_only'>('overwrite');
  const currentUploadIdRef = useRef<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sftpReady, setSftpReady] = useState(false);
  const dragCounterRef = useRef(0);
  const fileListRef = useRef<HTMLTableSectionElement>(null);

  // Dialog state for replacing prompt()
  const [inputDialog, setInputDialog] = useState<{
    isOpen: boolean;
    title: string;
    defaultValue: string;
    onConfirm: (value: string) => void;
  } | null>(null);
  const [inputValue, setInputValue] = useState('');

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDanger?: boolean;
  } | null>(null);

  // Clipboard state for copy/paste
  const [clipboard, setClipboard] = useState<{
    files: string[];
    sourcePath: string;
    operation: 'copy' | 'cut';
  } | null>(null);

  // Drag selection state
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'file' | 'empty';
    fileName?: string;
  } | null>(null);

  // Image viewer state
  const [imageViewer, setImageViewer] = useState<{
    fileName: string;
    content: string;
  } | null>(null);

  // Code editor state
  const [codeEditor, setCodeEditor] = useState<{
    fileName: string;
    content: string;
    remotePath: string;
  } | null>(null);
  const [codeEditorContent, setCodeEditorContent] = useState('');

  // Path suggestions state
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const [showPathSuggestions, setShowPathSuggestions] = useState(false);
  const [pathNotFound, setPathNotFound] = useState(false);

  // Clone repo dialog
  const [cloneDialog, setCloneDialog] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [githubRepos, setGithubRepos] = useState<{ name: string; full_name: string; clone_url: string; private: boolean; org?: string }[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [availableConnections, setAvailableConnections] = useState<{ id: string; name: string }[]>([]);
  const [selectedTargetServer, setSelectedTargetServer] = useState<string>('');

  // Copy to another server dialog
  const [copyToServerDialog, setCopyToServerDialog] = useState(false);
  const [copySourceFiles, setCopySourceFiles] = useState<string[]>([]);
  const [copyTargetPath, setCopyTargetPath] = useState('/');
  const [isCopying, setIsCopying] = useState(false);

  // Node modules exclusion dialog
  const [nodeModulesDialog, setNodeModulesDialog] = useState<{
    isOpen: boolean;
    folders: string[];
    targetPath: string;
    allFilePaths: string[];
  } | null>(null);

  // Upload settings dialog
  const [uploadSettingsDialog, setUploadSettingsDialog] = useState(false);

  // Internal drag-drop state
  const [draggedFiles, setDraggedFiles] = useState<string[]>([]);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const [dropTargetParent, setDropTargetParent] = useState(false);

  // Focused file index for keyboard navigation
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // File search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Keyboard type-ahead navigation
  const typeAheadBufferRef = useRef('');
  const typeAheadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Export to explorer state
  const [isPreparingNativeDrag, setIsPreparingNativeDrag] = useState(false);

  // Sorted files (memoized to avoid recalculation on every render)
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }

      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'modified':
          comparison = new Date(a.modified).getTime() - new Date(b.modified).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [files, sortBy, sortOrder]);

  // Filtered files based on search query
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) {
      return sortedFiles;
    }
    const query = searchQuery.toLowerCase();
    return sortedFiles.filter(f => f.name.toLowerCase().includes(query));
  }, [sortedFiles, searchQuery]);

  const initSftp = useCallback(async () => {
    try {
      await window.electronAPI.sftpInit(connectionId);
      setSftpReady(true);
      return true;
    } catch (err) {
      console.error('Failed to init SFTP:', err);
      return false;
    }
  }, [connectionId]);

  const loadDirectory = useCallback(async (path: string, saveAsLast = true) => {
    setIsLoading(true);
    setError(null);
    setSelectedFiles(new Set());

    try {
      if (!sftpReady) {
        await initSftp();
      }
      const fileList = await window.electronAPI.sftpList(connectionId, path);
      setFiles(fileList);
      setCurrentPath(path);
      setPathInput(path);

      // Notify parent of path change
      onPathChange?.(path);

      if (saveAsLast) {
        await window.electronAPI.saveLastPath(connectionId, path);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load directory');
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, sftpReady, initSftp]);

  const loadShortcuts = useCallback(async () => {
    try {
      const loadedShortcuts = await window.electronAPI.getShortcuts(connectionId);
      setShortcuts(loadedShortcuts);
    } catch (err) {
      console.error('Failed to load shortcuts:', err);
    }
  }, [connectionId]);

  useEffect(() => {
    const initializeFileBrowser = async () => {
      try {
        await initSftp();
        const lastPath = await window.electronAPI.getLastPath(connectionId);
        await loadShortcuts();
        await loadDirectory(lastPath, false);
      } catch (err) {
        await loadDirectory('/', false);
      }
    };

    initializeFileBrowser();
  }, [connectionId]);

  // Listen for detailed upload progress (from folder uploads)
  useEffect(() => {
    const removeListener = window.electronAPI.onUploadProgress((data) => {
      // Only update progress if it's for the current connection AND current upload
      if (data.connectionId === connectionId && data.uploadId && data.uploadId === currentUploadIdRef.current) {
        setUploadProgress({
          file: data.fileName,
          count: data.current,
          total: data.total,
          skipped: data.skipped,
        });
      }
    });

    return () => removeListener();
  }, [connectionId]);

  const navigateTo = (path: string) => {
    loadDirectory(path);
  };

  const navigateUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parentPath);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedPath = pathInput.trim() || '/';
    setIsEditingPath(false);
    if (normalizedPath !== currentPath) {
      navigateTo(normalizedPath);
    }
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setPathInput(currentPath);
      setIsEditingPath(false);
      setShowPathSuggestions(false);
      setPathNotFound(false);
    }
    // Auto-fill with Tab or Enter when there's only one suggestion
    if ((e.key === 'Tab' || e.key === 'Enter') && pathSuggestions.length === 1) {
      e.preventDefault();
      selectPathSuggestion(pathSuggestions[0]);
    }
  };

  const handleDoubleClick = (file: FileInfo) => {
    if (file.isDirectory) {
      const newPath = currentPath === '/'
        ? `/${file.name}`
        : `${currentPath}/${file.name}`;
      navigateTo(newPath);
    }
  };

  const handleSelect = (fileName: string, isMulti: boolean) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(isMulti ? prev : []);
      if (newSet.has(fileName)) {
        newSet.delete(fileName);
      } else {
        newSet.add(fileName);
      }
      return newSet;
    });
  };

  const uploadFiles = async (filePaths: string[], targetPath?: string, excludeNodeModules?: boolean) => {
    if (filePaths.length === 0) return;

    const uploadToPath = targetPath || currentPath;

    // Generate a unique upload ID for this batch
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    currentUploadIdRef.current = uploadId;

    try {
      // Separate files and folders
      const folders: string[] = [];
      const files: string[] = [];

      for (const filePath of filePaths) {
        const isDir = await window.electronAPI.isDirectory(filePath);
        if (isDir) {
          folders.push(filePath);
        } else {
          files.push(filePath);
        }
      }

      // Check if any folder contains node_modules (only if not already decided)
      if (excludeNodeModules === undefined && folders.length > 0) {
        const foldersWithNodeModules: string[] = [];
        for (const folderPath of folders) {
          const hasNodeModules = await window.electronAPI.hasNodeModules(folderPath);
          if (hasNodeModules) {
            foldersWithNodeModules.push(folderPath);
          }
        }

        if (foldersWithNodeModules.length > 0) {
          // Show the dialog and wait for user response
          setNodeModulesDialog({
            isOpen: true,
            folders: foldersWithNodeModules,
            targetPath: uploadToPath,
            allFilePaths: filePaths,
          });
          return; // Stop here, the dialog will handle continuing the upload
        }
      }

      // Calculate total items for progress (folders count as 1 each for now)
      const totalItems = files.length + folders.length;
      let completedItems = 0;

      setUploadProgress({ file: 'Preparing upload...', count: 0, total: totalItems });

      // Upload folders first
      const excludePatterns = excludeNodeModules ? ['node_modules'] : undefined;
      for (const folderPath of folders) {
        const folderName = folderPath.split(/[/\\]/).pop() || 'folder';
        setUploadProgress({ file: `Uploading folder: ${folderName}`, count: completedItems + 1, total: totalItems });

        const result = await window.electronAPI.sftpUploadFolder(
          connectionId,
          folderPath,
          uploadToPath,
          excludePatterns,
          uploadId,
          uploadMode
        );

        if (result.cancelled) {
          setUploadProgress(null);
          currentUploadIdRef.current = null;
          loadDirectory(currentPath);
          return;
        }
        completedItems++;
      }

      // Upload individual files with mode support
      for (const filePath of files) {
        // Check if cancelled
        if (currentUploadIdRef.current !== uploadId) {
          break;
        }

        const fileName = filePath.split(/[/\\]/).pop() || 'file';
        const remotePath = uploadToPath === '/'
          ? `/${fileName}`
          : `${uploadToPath}/${fileName}`;

        // Check upload mode for individual files
        if (uploadMode !== 'overwrite') {
          const remoteStat = await window.electronAPI.sftpStat(connectionId, remotePath);
          if (uploadMode === 'skip_existing' && remoteStat.exists) {
            completedItems++;
            setUploadProgress({ file: fileName, count: completedItems, total: totalItems, skipped: true });
            continue;
          }
          if (uploadMode === 'newer_only' && remoteStat.exists) {
            const localStats = await window.electronAPI.isDirectory(filePath); // We need local mtime
            // For individual files, we'll do a simple upload since we can't easily get local mtime here
            // The folder upload handles this properly
          }
        }

        setUploadProgress({ file: fileName, count: completedItems + 1, total: totalItems });
        await window.electronAPI.sftpUpload(connectionId, filePath, remotePath);
        completedItems++;
      }

      // Show completion message briefly
      const completedUploadId = uploadId;
      setUploadProgress({ file: 'Upload complete!', count: totalItems, total: totalItems });
      currentUploadIdRef.current = null;
      loadDirectory(currentPath);

      // Clear progress after a short delay so user sees completion
      // Only clear if no new upload has started
      setTimeout(() => {
        if (currentUploadIdRef.current === null) {
          setUploadProgress(null);
        }
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setUploadProgress(null);
      currentUploadIdRef.current = null;
    }
  };

  const cancelUpload = async () => {
    if (currentUploadIdRef.current) {
      await window.electronAPI.sftpCancelUpload(currentUploadIdRef.current);
      currentUploadIdRef.current = null;
      setUploadProgress(null);
    }
  };

  // Handler for node_modules exclusion dialog
  const handleNodeModulesDialogResponse = (excludeNodeModules: boolean) => {
    if (nodeModulesDialog) {
      const { allFilePaths, targetPath } = nodeModulesDialog;
      setNodeModulesDialog(null);
      uploadFiles(allFilePaths, targetPath, excludeNodeModules);
    }
  };

  const handleUpload = async () => {
    try {
      const localPaths = await window.electronAPI.openFileDialog();
      if (localPaths.length === 0) return;
      await uploadFiles(localPaths);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setUploadProgress(null);
    }
  };

  // Drag and Drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length === 0) return;

    const filePaths: string[] = [];
    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i];
      // In Electron, we can get the path from the File object
      if ((file as any).path) {
        filePaths.push((file as any).path);
      }
    }

    if (filePaths.length > 0) {
      await uploadFiles(filePaths);
    }
  };

  const handleDownload = async () => {
    if (selectedFiles.size === 0) return;

    try {
      for (const fileName of selectedFiles) {
        const remotePath = currentPath === '/'
          ? `/${fileName}`
          : `${currentPath}/${fileName}`;
        const localPath = await window.electronAPI.saveFileDialog(fileName);

        if (localPath) {
          await window.electronAPI.sftpDownload(connectionId, remotePath, localPath);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Download failed');
    }
  };

  const handleDelete = async () => {
    if (selectedFiles.size === 0) return;

    try {
      for (const fileName of selectedFiles) {
        const file = files.find((f) => f.name === fileName);
        if (!file) continue;

        const remotePath = currentPath === '/'
          ? `/${fileName}`
          : `${currentPath}/${fileName}`;

        if (file.isDirectory) {
          // Use rm -rf for folders (more reliable than SFTP recursive delete)
          await window.electronAPI.exec(connectionId, `rm -rf "${remotePath}"`);
        } else {
          // Use SFTP for single files
          await window.electronAPI.sftpDelete(connectionId, remotePath, false);
        }
      }

      loadDirectory(currentPath);
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    }
  };

  const handleNewFolder = () => {
    setInputValue('');
    setInputDialog({
      isOpen: true,
      title: 'Enter folder name:',
      defaultValue: '',
      onConfirm: async (folderName: string) => {
        if (!folderName) return;
        try {
          const remotePath = currentPath === '/'
            ? `/${folderName}`
            : `${currentPath}/${folderName}`;
          await window.electronAPI.sftpMkdir(connectionId, remotePath);
          loadDirectory(currentPath);
        } catch (err: any) {
          setError(err.message || 'Failed to create folder');
        }
      },
    });
  };

  const handleNewFile = () => {
    setInputValue('');
    setInputDialog({
      isOpen: true,
      title: 'Enter file name:',
      defaultValue: '',
      onConfirm: async (fileName: string) => {
        if (!fileName) return;
        try {
          const remotePath = currentPath === '/'
            ? `/${fileName}`
            : `${currentPath}/${fileName}`;
          await window.electronAPI.exec(connectionId, `touch "${remotePath}"`);
          loadDirectory(currentPath);
        } catch (err: any) {
          setError(err.message || 'Failed to create file');
        }
      },
    });
  };

  const handleSaveShortcut = () => {
    const defaultName = currentPath === '/' ? 'Root' : currentPath.split('/').pop() || 'Folder';
    setInputValue(defaultName);
    setInputDialog({
      isOpen: true,
      title: 'Enter shortcut name:',
      defaultValue: defaultName,
      onConfirm: async (name: string) => {
        if (!name) return;
        try {
          const shortcut: Shortcut = {
            id: uuidv4(),
            connectionId,
            name,
            path: currentPath,
            type: 'folder',
          };
          const updatedShortcuts = await window.electronAPI.saveShortcut(shortcut);
          setShortcuts(updatedShortcuts);
        } catch (err: any) {
          setError(err.message || 'Failed to save shortcut');
        }
      },
    });
  };

  const handleSaveFileShortcut = (fileName: string) => {
    setInputValue(fileName);
    setInputDialog({
      isOpen: true,
      title: 'Enter shortcut name:',
      defaultValue: fileName,
      onConfirm: async (name: string) => {
        if (!name) return;
        try {
          const filePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
          const shortcut: Shortcut = {
            id: uuidv4(),
            connectionId,
            name,
            path: filePath,
            type: 'file',
          };
          const updatedShortcuts = await window.electronAPI.saveShortcut(shortcut);
          setShortcuts(updatedShortcuts);
        } catch (err: any) {
          setError(err.message || 'Failed to save shortcut');
        }
      },
    });
  };

  const handleDeleteShortcut = async (shortcutId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updatedShortcuts = await window.electronAPI.deleteShortcut(shortcutId, connectionId);
      setShortcuts(updatedShortcuts);
    } catch (err: any) {
      setError(err.message || 'Failed to delete shortcut');
    }
  };

  const handleShortcutClick = async (shortcut: Shortcut) => {
    if (shortcut.type === 'file') {
      // Open the file in editor
      const fileName = shortcut.path.split('/').pop() || '';
      if (isCodeFile(fileName) || fileName.length > 0) {
        try {
          const result = await window.electronAPI.exec(connectionId, `cat "${shortcut.path}"`);
          if (result.code === 0) {
            setCodeEditor({
              fileName,
              content: result.stdout,
              remotePath: shortcut.path,
            });
            setCodeEditorContent(result.stdout);
          } else {
            setError('Failed to open file');
          }
        } catch (err: any) {
          setError(err.message || 'Failed to open file');
        }
      }
    } else {
      // Navigate to folder
      navigateTo(shortcut.path);
    }
  };

  // Delete with confirmation
  const handleDeleteWithConfirm = () => {
    if (selectedFiles.size === 0) return;

    const fileList = Array.from(selectedFiles);
    const selectedFileInfos = fileList.map(name => files.find(f => f.name === name)).filter(Boolean);
    const hasFolders = selectedFileInfos.some(f => f?.isDirectory);
    const folderCount = selectedFileInfos.filter(f => f?.isDirectory).length;
    const fileCount = selectedFileInfos.filter(f => !f?.isDirectory).length;

    let message = '';
    if (fileList.length === 1) {
      if (hasFolders) {
        message = `Are you sure you want to delete the folder "${fileList[0]}" and ALL its contents? This cannot be undone!`;
      } else {
        message = `Are you sure you want to delete "${fileList[0]}"?`;
      }
    } else {
      const parts = [];
      if (folderCount > 0) parts.push(`${folderCount} folder${folderCount > 1 ? 's' : ''}`);
      if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
      message = `Are you sure you want to delete ${parts.join(' and ')}?${hasFolders ? ' All folder contents will be deleted!' : ''}`;
    }

    setConfirmDialog({
      isOpen: true,
      title: hasFolders ? 'Delete Folder(s)' : 'Confirm Delete',
      message,
      isDanger: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        await handleDelete();
      },
    });
  };

  // Copy files to clipboard
  const handleCopy = () => {
    if (selectedFiles.size === 0) return;
    setClipboard({
      files: Array.from(selectedFiles),
      sourcePath: currentPath,
      operation: 'copy',
    });
  };

  // Cut files to clipboard
  const handleCut = () => {
    if (selectedFiles.size === 0) return;
    setClipboard({
      files: Array.from(selectedFiles),
      sourcePath: currentPath,
      operation: 'cut',
    });
  };

  // Handle paste from system clipboard (Ctrl+V with files/images from clipboard)
  const handleSystemClipboardPaste = async () => {
    // First, try to get files copied from file explorer (Windows)
    try {
      const clipboardResult = await window.electronAPI.getClipboardFiles();
      if (clipboardResult.success && clipboardResult.paths.length > 0) {
        // Upload files from file explorer clipboard
        await uploadFiles(clipboardResult.paths);
        return;
      }
    } catch (err) {
      console.log('Failed to read clipboard files:', err);
    }

    // Try to read images from system clipboard using Clipboard API
    try {
      const clipboardItems = await navigator.clipboard.read();
      const fileBlobs: { name: string; blob: Blob }[] = [];

      for (const item of clipboardItems) {
        // Check for files (images, etc.)
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
            const fileName = `pasted_image_${Date.now()}.${ext}`;
            fileBlobs.push({ name: fileName, blob });
          }
        }
      }

      if (fileBlobs.length > 0) {
        // Upload the clipboard files
        setUploadProgress({ file: fileBlobs[0].name, count: 0, total: fileBlobs.length });

        for (let i = 0; i < fileBlobs.length; i++) {
          const { name, blob } = fileBlobs[i];
          setUploadProgress({ file: name, count: i + 1, total: fileBlobs.length });

          // Convert blob to ArrayBuffer
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          // Save to temp file via IPC
          const saveResult = await window.electronAPI.saveTempFile(name, Array.from(uint8Array));
          if (!saveResult.success || !saveResult.path) {
            throw new Error(saveResult.error || 'Failed to save temp file');
          }

          // Upload to remote
          const remotePath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
          await window.electronAPI.sftpUpload(connectionId, saveResult.path, remotePath);

          // Clean up temp file
          await window.electronAPI.deleteTempFile(saveResult.path);
        }

        setUploadProgress(null);
        loadDirectory(currentPath);
        return;
      }
    } catch (err) {
      // Clipboard API failed or no files - that's okay, try internal clipboard
      console.log('Clipboard API returned no files, trying internal clipboard');
    }

    // Fall back to internal clipboard paste
    if (clipboard) {
      handlePaste();
    }
  };

  // Paste files from clipboard
  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0) return;
    if (clipboard.sourcePath === currentPath) {
      setError('Cannot paste in the same directory');
      return;
    }

    const fileList = clipboard.files;
    const operation = clipboard.operation === 'cut' ? 'move' : 'copy';
    const message = fileList.length === 1
      ? `${operation === 'copy' ? 'Copy' : 'Move'} "${fileList[0]}" to this folder?`
      : `${operation === 'copy' ? 'Copy' : 'Move'} ${fileList.length} items to this folder?`;

    setConfirmDialog({
      isOpen: true,
      title: `Confirm ${operation === 'copy' ? 'Copy' : 'Move'}`,
      message,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          for (const fileName of fileList) {
            const sourcePath = clipboard.sourcePath === '/'
              ? `/${fileName}`
              : `${clipboard.sourcePath}/${fileName}`;
            const destPath = currentPath === '/'
              ? `/${fileName}`
              : `${currentPath}/${fileName}`;

            if (operation === 'copy') {
              await window.electronAPI.exec(connectionId, `cp -r "${sourcePath}" "${destPath}"`);
            } else {
              await window.electronAPI.exec(connectionId, `mv "${sourcePath}" "${destPath}"`);
            }
          }

          if (operation === 'move') {
            setClipboard(null);
          }

          loadDirectory(currentPath);
        } catch (err: any) {
          setError(err.message || `${operation} failed`);
        }
      },
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs (except search input for Escape)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Allow Escape to close search even when in search input
        if (e.key === 'Escape' && isSearching) {
          e.preventDefault();
          setIsSearching(false);
          setSearchQuery('');
        }
        return;
      }

      // Don't trigger shortcuts when focus is in the terminal
      const activeElement = document.activeElement;
      const isInTerminal = activeElement?.closest('.terminal-container') ||
                          activeElement?.closest('.xterm') ||
                          activeElement?.closest('.terminal-view') ||
                          activeElement?.classList.contains('xterm-helper-textarea');
      if (isInTerminal) {
        return;
      }

      // Ctrl+F - Open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearching(true);
        return;
      }

      // Escape - Close search
      if (e.key === 'Escape' && isSearching) {
        e.preventDefault();
        setIsSearching(false);
        setSearchQuery('');
        return;
      }

      // Delete key
      if (e.key === 'Delete' && selectedFiles.size > 0) {
        e.preventDefault();
        handleDeleteWithConfirm();
      }

      // Ctrl+C or Ctrl+Shift+C - Copy
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && selectedFiles.size > 0) {
        e.preventDefault();
        handleCopy();
      }

      // Ctrl+X - Cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selectedFiles.size > 0) {
        e.preventDefault();
        handleCut();
      }

      // Ctrl+V - Paste (check for system clipboard files first, then internal clipboard)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        handleSystemClipboardPaste();
      }

      // Ctrl+A - Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedFiles(new Set(filteredFiles.map(f => f.name)));
        setFocusedIndex(0);
      }

      // Arrow key navigation
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const maxIndex = filteredFiles.length - 1;
        let newIndex = focusedIndex;

        if (e.key === 'ArrowDown') {
          newIndex = focusedIndex < maxIndex ? focusedIndex + 1 : maxIndex;
        } else if (e.key === 'ArrowUp') {
          newIndex = focusedIndex > 0 ? focusedIndex - 1 : 0;
        }

        if (newIndex >= 0 && newIndex <= maxIndex) {
          setFocusedIndex(newIndex);
          const fileName = filteredFiles[newIndex].name;

          if (e.shiftKey) {
            // Multi-select with shift
            setSelectedFiles(prev => new Set([...prev, fileName]));
          } else {
            setSelectedFiles(new Set([fileName]));
          }

          // Scroll the row into view
          const row = fileListRef.current?.querySelector(`[data-filename="${fileName}"]`);
          row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

      // Enter to open selected folder
      if (e.key === 'Enter' && selectedFiles.size === 1) {
        const fileName = Array.from(selectedFiles)[0];
        const file = filteredFiles.find(f => f.name === fileName);
        if (file?.isDirectory) {
          e.preventDefault();
          const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
          navigateTo(newPath);
        }
      }

      // Type-ahead navigation - single letter or multiple letters typed quickly
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !isSearching) {
        // Clear previous timeout
        if (typeAheadTimeoutRef.current) {
          clearTimeout(typeAheadTimeoutRef.current);
        }

        // Add character to buffer
        typeAheadBufferRef.current += e.key.toLowerCase();
        const searchStr = typeAheadBufferRef.current;

        // Find first file/folder that starts with the typed characters
        const matchIndex = filteredFiles.findIndex(f =>
          f.name.toLowerCase().startsWith(searchStr)
        );

        if (matchIndex !== -1) {
          setFocusedIndex(matchIndex);
          setSelectedFiles(new Set([filteredFiles[matchIndex].name]));

          // Scroll into view
          const row = fileListRef.current?.querySelector(`[data-filename="${filteredFiles[matchIndex].name}"]`);
          row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        // Clear buffer after 1 second of no typing
        typeAheadTimeoutRef.current = setTimeout(() => {
          typeAheadBufferRef.current = '';
        }, 1000);
      }

      // Backspace to go up
      if (e.key === 'Backspace' && currentPath !== '/') {
        e.preventDefault();
        navigateUp();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedFiles, clipboard, filteredFiles, currentPath, focusedIndex, isSearching]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // ========== DRAG SELECTION ==========
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start drag selection on left click
    if (e.button !== 0) return;
    if (!containerRef.current) return;

    // Check if clicked on a file row (don't start selection on file rows)
    const target = e.target as HTMLElement;
    const isFileRow = target.closest('.file-row');
    const isOnTable = target.closest('.file-list');
    const isOnHeader = target.closest('th');

    // Allow selection start only in empty areas (container, or table but not on rows/headers)
    if (isFileRow || isOnHeader) return;

    e.preventDefault(); // Prevent text selection

    const rect = containerRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left + containerRef.current.scrollLeft;
    const startY = e.clientY - rect.top + containerRef.current.scrollTop;

    setIsDragSelecting(true);
    setSelectionBox({ startX, startY, endX: startX, endY: startY });
    setSelectedFiles(new Set());
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragSelecting || !containerRef.current || !selectionBox) return;

    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const scrollTop = containerRef.current.scrollTop;
    const endX = e.clientX - rect.left + scrollLeft;
    const endY = e.clientY - rect.top + scrollTop;

    setSelectionBox({ ...selectionBox, endX, endY });

    // Calculate selection rectangle (in scroll-adjusted coordinates)
    const minX = Math.min(selectionBox.startX, endX);
    const maxX = Math.max(selectionBox.startX, endX);
    const minY = Math.min(selectionBox.startY, endY);
    const maxY = Math.max(selectionBox.startY, endY);

    // Check which files are in the selection
    const rows = fileListRef.current?.querySelectorAll('.file-row');
    const newSelection = new Set<string>();

    rows?.forEach((row) => {
      const rowRect = row.getBoundingClientRect();
      // Convert row coordinates to scroll-adjusted container coordinates
      const rowTop = rowRect.top - rect.top + scrollTop;
      const rowBottom = rowRect.bottom - rect.top + scrollTop;

      if (rowTop < maxY && rowBottom > minY) {
        const fileName = row.getAttribute('data-filename');
        if (fileName) newSelection.add(fileName);
      }
    });

    setSelectedFiles(newSelection);
  };

  const handleMouseUp = () => {
    setIsDragSelecting(false);
    setSelectionBox(null);
  };

  // ========== FILE HELPERS ==========
  const isImageFile = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext || '');
  };

  const isCodeFile = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
      'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'md', 'txt', 'sh', 'bash',
      'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'php', 'pl', 'lua', 'vim', 'conf', 'ini',
      'toml', 'env', 'gitignore', 'dockerfile', 'makefile'].includes(ext || '');
  };

  // ========== DOUBLE CLICK HANDLER ==========
  const handleFileDoubleClick = async (file: FileInfo) => {
    if (file.isDirectory) {
      const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      navigateTo(newPath);
      return;
    }

    const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;

    // Image file - view it
    if (isImageFile(file.name)) {
      try {
        // Download to temp and get base64
        const result = await window.electronAPI.exec(connectionId, `base64 "${remotePath}" 2>/dev/null | tr -d '\\n'`);
        if (result.code === 0 && result.stdout) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          setImageViewer({
            fileName: file.name,
            content: `data:${mimeType};base64,${result.stdout}`,
          });
        } else {
          setError('Failed to load image');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load image');
      }
      return;
    }

    // Code/text file - open in editor
    if (isCodeFile(file.name) || file.size < 1024 * 1024) { // < 1MB
      try {
        const result = await window.electronAPI.exec(connectionId, `cat "${remotePath}"`);
        if (result.code === 0) {
          setCodeEditor({
            fileName: file.name,
            content: result.stdout,
            remotePath,
          });
          setCodeEditorContent(result.stdout);
        } else {
          setError('Failed to load file');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load file');
      }
    }
  };

  // Save code editor content
  const handleSaveCode = async () => {
    if (!codeEditor) return;
    try {
      // Escape content for shell
      const escaped = codeEditorContent.replace(/'/g, "'\\''");
      await window.electronAPI.exec(connectionId, `cat > "${codeEditor.remotePath}" << 'EOFCONTENT'\n${codeEditorContent}\nEOFCONTENT`);
      setCodeEditor(null);
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(err.message || 'Failed to save file');
    }
  };

  // ========== CONTEXT MENU HANDLERS ==========
  const handleContextMenu = (e: React.MouseEvent, type: 'file' | 'empty', fileName?: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (type === 'file' && fileName) {
      // Select the file if not already selected
      if (!selectedFiles.has(fileName)) {
        setSelectedFiles(new Set([fileName]));
      }
    }

    // Calculate position with viewport boundary check
    const menuWidth = 220; // Approximate menu width
    const menuHeight = 400; // Max menu height
    const padding = 10;

    let x = e.clientX;
    let y = e.clientY;

    // Check right boundary
    if (x + menuWidth + padding > window.innerWidth) {
      x = window.innerWidth - menuWidth - padding;
    }

    // Check bottom boundary
    if (y + menuHeight + padding > window.innerHeight) {
      y = window.innerHeight - menuHeight - padding;
    }

    // Ensure not negative
    x = Math.max(padding, x);
    y = Math.max(padding, y);

    setContextMenu({
      x,
      y,
      type,
      fileName,
    });
  };

  // Download single file
  const handleDownloadFile = async (fileName: string) => {
    try {
      const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
      const localPath = await window.electronAPI.saveFileDialog(fileName);
      if (localPath) {
        await window.electronAPI.sftpDownload(connectionId, remotePath, localPath);
      }
    } catch (err: any) {
      setError(err.message || 'Download failed');
    }
    setContextMenu(null);
  };

  // Compress file/folder
  const handleCompress = async (fileName: string) => {
    try {
      const sourcePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
      const archiveName = `${fileName}.tar.gz`;
      const archivePath = currentPath === '/' ? `/${archiveName}` : `${currentPath}/${archiveName}`;

      await window.electronAPI.exec(connectionId, `tar -czf "${archivePath}" -C "${currentPath}" "${fileName}"`);
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(err.message || 'Compression failed');
    }
    setContextMenu(null);
  };

  // Compress and download
  const handleCompressAndDownload = async (fileName: string) => {
    try {
      const sourcePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
      const archiveName = `${fileName}.tar.gz`;
      const tempArchive = `/tmp/${archiveName}`;

      // Compress to temp
      await window.electronAPI.exec(connectionId, `tar -czf "${tempArchive}" -C "${currentPath}" "${fileName}"`);

      // Download
      const localPath = await window.electronAPI.saveFileDialog(archiveName);
      if (localPath) {
        await window.electronAPI.sftpDownload(connectionId, tempArchive, localPath);
        // Clean up temp file
        await window.electronAPI.exec(connectionId, `rm "${tempArchive}"`);
      }
    } catch (err: any) {
      setError(err.message || 'Compress and download failed');
    }
    setContextMenu(null);
  };

  // Open folder in terminal
  const handleOpenInTerminal = () => {
    onOpenTerminal?.(currentPath);
    setContextMenu(null);
  };

  // Download current folder (compress and download)
  const handleDownloadCurrentFolder = async () => {
    try {
      const folderName = currentPath === '/' ? 'root' : currentPath.split('/').pop() || 'folder';
      const archiveName = `${folderName}.tar.gz`;
      const tempArchive = `/tmp/${archiveName}`;

      // Compress current folder to temp
      const parentPath = currentPath === '/' ? '/' : currentPath.split('/').slice(0, -1).join('/') || '/';
      const targetName = currentPath === '/' ? '.' : currentPath.split('/').pop();

      await window.electronAPI.exec(connectionId, `tar -czf "${tempArchive}" -C "${parentPath}" "${targetName}"`);

      // Download
      const localPath = await window.electronAPI.saveFileDialog(archiveName);
      if (localPath) {
        await window.electronAPI.sftpDownload(connectionId, tempArchive, localPath);
        // Clean up temp file
        await window.electronAPI.exec(connectionId, `rm "${tempArchive}"`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to download folder');
    }
    setContextMenu(null);
  };

  // Internal move files to folder
  const handleMoveToFolder = async (targetFolder: string) => {
    if (draggedFiles.length === 0) return;

    const targetPath = currentPath === '/'
      ? `/${targetFolder}`
      : `${currentPath}/${targetFolder}`;

    try {
      for (const fileName of draggedFiles) {
        const sourcePath = currentPath === '/'
          ? `/${fileName}`
          : `${currentPath}/${fileName}`;
        const destPath = `${targetPath}/${fileName}`;

        await window.electronAPI.exec(connectionId, `mv "${sourcePath}" "${destPath}"`);
      }

      loadDirectory(currentPath);
    } catch (err: any) {
      setError(err.message || 'Failed to move files');
    }

    setDraggedFiles([]);
    setDropTargetFolder(null);
  };

  // Move files to parent directory
  const handleMoveToParent = async () => {
    if (draggedFiles.length === 0 || currentPath === '/') return;

    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';

    try {
      for (const fileName of draggedFiles) {
        const sourcePath = currentPath === '/'
          ? `/${fileName}`
          : `${currentPath}/${fileName}`;
        const destPath = parentPath === '/'
          ? `/${fileName}`
          : `${parentPath}/${fileName}`;

        await window.electronAPI.exec(connectionId, `mv "${sourcePath}" "${destPath}"`);
      }

      loadDirectory(currentPath);
    } catch (err: any) {
      setError(err.message || 'Failed to move files to parent');
    }

    setDraggedFiles([]);
    setDropTargetParent(false);
  };

  // Export files to temp folder and open in File Explorer
  // User can then drag files from Explorer to wherever they want
  const handleExportToExplorer = async () => {
    if (selectedFiles.size === 0) return;

    const selectedFileNames = Array.from(selectedFiles);
    // Only allow files (not directories) for this
    const filesToExport = selectedFileNames.filter(name => {
      const file = files.find(f => f.name === name);
      return file && !file.isDirectory;
    });

    if (filesToExport.length === 0) {
      setError('Export only supports files, not folders. Use "Download Folder" for folders.');
      return;
    }

    setIsPreparingNativeDrag(true);

    try {
      const localPaths: string[] = [];

      for (const fileName of filesToExport) {
        const remotePath = currentPath === '/'
          ? `/${fileName}`
          : `${currentPath}/${fileName}`;

        const result = await window.electronAPI.sftpDownloadToTemp(connectionId, remotePath, fileName);
        if (result.success && result.localPath) {
          localPaths.push(result.localPath);
        }
      }

      if (localPaths.length > 0) {
        // Open the temp folder in File Explorer, selecting the first file
        await window.electronAPI.showItemInFolder(localPaths[0]);
      }

      // Clean up old temp files in background (files older than 5 min)
      window.electronAPI.nativeCleanupTempFiles();
    } catch (err: any) {
      setError(err.message || 'Failed to export files');
    } finally {
      setIsPreparingNativeDrag(false);
    }
  };

  // Handle drag start for internal file moves
  const handleFileDragStart = (e: React.DragEvent, file: FileInfo) => {
    // If file is selected, drag all selected files, otherwise just this one
    const filesToDrag = selectedFiles.has(file.name)
      ? Array.from(selectedFiles)
      : [file.name];
    setDraggedFiles(filesToDrag);

    // Internal drag for moving files between folders
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', filesToDrag.join(','));
  };

  // Fetch GitHub repos when clone dialog opens
  const fetchGithubRepos = async () => {
    const token = localStorage.getItem('githubToken');
    if (!token) {
      setGithubRepos([]);
      return;
    }

    setIsLoadingRepos(true);
    try {
      const result = await window.electronAPI.githubGetRepos(token);
      if (result.success && result.repos) {
        setGithubRepos(result.repos.map((r: any) => ({
          name: r.name,
          full_name: r.full_name,
          clone_url: r.clone_url,
          private: r.private,
          org: r.org,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  // Open clone dialog and fetch repos
  const openCloneDialog = async () => {
    setCloneDialog(true);
    setCloneUrl('');
    setRepoSearchQuery('');
    setContextMenu(null);
    fetchGithubRepos();
  };

  // Clone GitHub repo
  const handleCloneRepo = async (targetConnectionId?: string) => {
    if (!cloneUrl) return;

    const targetId = targetConnectionId || connectionId;
    const targetPath = currentPath;

    // If GitHub token is available and URL is HTTPS, inject token for authentication
    let authenticatedUrl = cloneUrl;
    const githubToken = localStorage.getItem('githubToken');
    if (githubToken && cloneUrl.includes('https://github.com/')) {
      authenticatedUrl = cloneUrl.replace('https://github.com/', `https://${githubToken}@github.com/`);
    }

    try {
      const result = await window.electronAPI.exec(targetId, `cd "${targetPath}" && git clone "${authenticatedUrl}"`);
      if (result.code !== 0) {
        // Don't show token in error message
        const safeError = (result.stderr || 'Clone failed').replace(githubToken || '', '***');
        setError(safeError);
      } else {
        if (targetId === connectionId) {
          loadDirectory(currentPath);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Clone failed');
    }
    setCloneDialog(false);
    setCloneToServerDialog(false);
    setCloneUrl('');
    setSelectedTargetServer('');
  };

  // Open copy to another server dialog
  const openCopyToServerDialog = async (fileNames?: string[]) => {
    try {
      const connections = await window.electronAPI.getConnections();
      // Filter out current connection
      setAvailableConnections(connections.filter(c => c.id !== connectionId));

      // Determine what to copy
      let filesToCopy: string[] = [];
      if (fileNames && fileNames.length > 0) {
        filesToCopy = fileNames;
      } else if (selectedFiles.size > 0) {
        filesToCopy = Array.from(selectedFiles);
      } else {
        // Copy current directory contents
        filesToCopy = ['.'];
      }

      setCopySourceFiles(filesToCopy);
      setCopyTargetPath(currentPath);
      setSelectedTargetServer('');
      setCopyToServerDialog(true);
      setContextMenu(null);
    } catch (err) {
      setError('Failed to load connections');
    }
  };

  // Handle copying files to another server
  const handleCopyToServer = async () => {
    if (!selectedTargetServer || copySourceFiles.length === 0) return;

    setIsCopying(true);
    try {
      // Ensure target server connection and SFTP are ready
      await window.electronAPI.ensureReady(selectedTargetServer);

      for (const fileName of copySourceFiles) {
        const sourcePath = fileName === '.'
          ? currentPath
          : (currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`);

        const targetPath = fileName === '.'
          ? copyTargetPath
          : (copyTargetPath === '/' ? `/${fileName}` : `${copyTargetPath}/${fileName}`);

        // Download from source server to temp, then upload to target server
        const tempPath = await window.electronAPI.getTempPath(fileName === '.' ? 'folder' : fileName);

        // Download from current server
        await window.electronAPI.sftpDownload(connectionId, sourcePath, tempPath);

        // Upload to target server
        await window.electronAPI.sftpUpload(selectedTargetServer, tempPath, targetPath);
      }

      setCopyToServerDialog(false);
      setCopySourceFiles([]);
    } catch (err: any) {
      setError(err.message || 'Copy to server failed');
    } finally {
      setIsCopying(false);
    }
  };

  // ========== PATH SUGGESTIONS ==========
  const fetchPathSuggestions = async (inputPath: string) => {
    if (!inputPath || inputPath === '/') {
      setPathSuggestions([]);
      setShowPathSuggestions(false);
      setPathNotFound(false);
      return;
    }

    // Get parent directory
    const parts = inputPath.split('/').filter(Boolean);
    const searchTerm = parts.pop() || '';
    const parentPath = '/' + parts.join('/') || '/';

    try {
      const result = await window.electronAPI.sftpList(connectionId, parentPath);
      const suggestions = result
        .filter(f => f.isDirectory && f.name.toLowerCase().startsWith(searchTerm.toLowerCase()))
        .map(f => parentPath === '/' ? `/${f.name}` : `${parentPath}/${f.name}`);

      setPathSuggestions(suggestions);
      setShowPathSuggestions(suggestions.length > 0 || searchTerm.length > 0);
      setPathNotFound(suggestions.length === 0 && searchTerm.length > 0);
    } catch {
      setPathSuggestions([]);
      setShowPathSuggestions(true);
      setPathNotFound(true);
    }
  };

  const handlePathInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPathInput(value);
    fetchPathSuggestions(value);
  };

  const selectPathSuggestion = (path: string) => {
    setPathInput(path);
    setShowPathSuggestions(false);
    setPathNotFound(false);
    navigateTo(path);
    setIsEditingPath(false);
  };

  const handleCreateFolder = async () => {
    if (!pathInput) return;
    try {
      await window.electronAPI.exec(connectionId, `mkdir -p "${pathInput}"`);
      navigateTo(pathInput);
      setIsEditingPath(false);
      setShowPathSuggestions(false);
      setPathNotFound(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create folder');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSort = (column: 'name' | 'size' | 'modified') => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const getFileIcon = (file: FileInfo) => {
    if (file.isDirectory) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="icon-folder">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      );
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'md'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'];
    const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z'];

    if (codeExts.includes(ext || '')) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="icon-code">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
      );
    }

    if (imageExts.includes(ext || '')) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="icon-image">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      );
    }

    if (archiveExts.includes(ext || '')) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="icon-archive">
          <path d="M21 8v13H3V8"></path>
          <path d="M1 3h22v5H1z"></path>
          <path d="M10 12h4"></path>
        </svg>
      );
    }

    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="icon-file">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
    );
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div
      className={`file-browser ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Input Dialog Modal */}
      {inputDialog?.isOpen && (
        <div className="dialog-overlay" onClick={() => setInputDialog(null)}>
          <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{inputDialog.title}</div>
            <input
              type="text"
              className="dialog-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  inputDialog.onConfirm(inputValue);
                  setInputDialog(null);
                } else if (e.key === 'Escape') {
                  setInputDialog(null);
                }
              }}
              autoFocus
            />
            <div className="dialog-buttons">
              <button
                className="dialog-btn dialog-btn-cancel"
                onClick={() => setInputDialog(null)}
              >
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-confirm"
                onClick={() => {
                  inputDialog.onConfirm(inputValue);
                  setInputDialog(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}


      <div className="file-browser-toolbar">
        <div className="path-section">
          {isEditingPath ? (
            <div className="path-input-container">
              <form onSubmit={handlePathSubmit} className="path-form">
                <input
                  type="text"
                  value={pathInput}
                  onChange={handlePathInputChange}
                  onBlur={() => {
                    setTimeout(() => {
                      setShowPathSuggestions(false);
                      setPathNotFound(false);
                      if (!pathSuggestions.length) {
                        setPathInput(currentPath);
                        setIsEditingPath(false);
                      }
                    }, 200);
                  }}
                  onKeyDown={handlePathKeyDown}
                  autoFocus
                  className="path-input"
                  placeholder="Enter path..."
                />
              </form>
              {showPathSuggestions && (
                <div className="path-suggestions">
                  {pathSuggestions.length > 0 ? (
                    pathSuggestions.map((suggestion, idx) => (
                      <div
                        key={idx}
                        className="path-suggestion-item"
                        onMouseDown={() => selectPathSuggestion(suggestion)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        {suggestion}
                      </div>
                    ))
                  ) : pathNotFound ? (
                    <div className="path-not-found">
                      <span>Folder not found</span>
                      <button
                        className="create-folder-btn"
                        onMouseDown={handleCreateFolder}
                      >
                        Create "{pathInput}"?
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className="breadcrumb" onClick={() => setIsEditingPath(true)}>
              <button
                className="breadcrumb-item root"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateTo('/');
                }}
                title="Root"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                </svg>
              </button>
              {pathParts.map((part, index) => (
                <React.Fragment key={index}>
                  <span className="breadcrumb-separator">/</span>
                  <button
                    className="breadcrumb-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateTo('/' + pathParts.slice(0, index + 1).join('/'));
                    }}
                  >
                    {part}
                  </button>
                </React.Fragment>
              ))}
              <span className="path-edit-hint">Click to edit</span>
            </div>
          )}
        </div>
        {isSearching ? (
          <div className="search-input-container">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              autoFocus
            />
            <span className="search-results-count">
              {filteredFiles.length} / {sortedFiles.length}
            </span>
            <button
              className="search-close-btn"
              onClick={() => {
                setIsSearching(false);
                setSearchQuery('');
              }}
              title="Close search (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ) : (
          <button
            className="toolbar-btn search-btn"
            onClick={() => setIsSearching(true)}
            title="Search files (Ctrl+F)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        )}
        <div className="toolbar-actions">
          <button className="toolbar-btn favorite-btn" onClick={handleSaveShortcut} title="Save as Shortcut">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button className="toolbar-btn" onClick={handleUpload} title="Upload Files">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Upload
          </button>
          <button
            className={`toolbar-btn upload-settings-btn ${uploadMode !== 'overwrite' ? 'active' : ''}`}
            onClick={() => setUploadSettingsDialog(true)}
            title={`Upload Mode: ${uploadMode === 'overwrite' ? 'Overwrite' : uploadMode === 'skip_existing' ? 'Skip Existing' : 'Newer Only'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button
            className="toolbar-btn"
            onClick={handleDownload}
            disabled={selectedFiles.size === 0}
            title="Download Selected"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download
          </button>
          <button
            className="toolbar-btn"
            onClick={handleExportToExplorer}
            disabled={selectedFiles.size === 0 || isPreparingNativeDrag}
            title="Export selected files to temp folder and open in File Explorer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <path d="M12 11v6"></path>
              <path d="M9 14l3 3 3-3"></path>
            </svg>
            {isPreparingNativeDrag ? 'Exporting...' : 'Open in Explorer'}
          </button>
          <button className="toolbar-btn" onClick={handleNewFolder} title="New Folder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </button>
          <button className="toolbar-btn" onClick={handleNewFile} title="New File">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
          </button>
          <button
            className="toolbar-btn"
            onClick={handleCopy}
            disabled={selectedFiles.size === 0}
            title="Copy (Ctrl+C)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button
            className="toolbar-btn"
            onClick={handleCut}
            disabled={selectedFiles.size === 0}
            title="Cut (Ctrl+X)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="6" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
              <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
              <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
            </svg>
          </button>
          <button
            className="toolbar-btn"
            onClick={handlePaste}
            disabled={!clipboard}
            title="Paste (Ctrl+V)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
          </button>
          <button
            className="toolbar-btn danger"
            onClick={handleDeleteWithConfirm}
            disabled={selectedFiles.size === 0}
            title="Delete (Del)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <button className="toolbar-btn" onClick={() => loadDirectory(currentPath)} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
        </div>
      </div>

      {uploadProgress && (
        <div className={`upload-progress ${uploadProgress.file === 'Upload complete!' ? 'complete' : ''}`}>
          <div className="upload-progress-info">
            <span>
              {uploadProgress.file === 'Upload complete!' ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  Upload complete! ({uploadProgress.total} files)
                </>
              ) : (
                <>
                  {uploadProgress.skipped ? 'Skipped: ' : 'Uploading: '}
                  {uploadProgress.file} ({uploadProgress.count}/{uploadProgress.total})
                </>
              )}
            </span>
            {uploadProgress.file !== 'Upload complete!' && (
              <button
                className="upload-cancel-btn"
                onClick={cancelUpload}
                title="Cancel upload"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                Stop
              </button>
            )}
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(uploadProgress.count / uploadProgress.total) * 100}%` }}></div>
          </div>
        </div>
      )}

      {error && (
        <div className="file-browser-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="file-browser-main">
        <div
          ref={containerRef}
          className="file-list-container"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => handleContextMenu(e, 'empty')}
        >
          {/* Selection box */}
          {selectionBox && (
            <div
              className="selection-box"
              style={{
                left: Math.min(selectionBox.startX, selectionBox.endX),
                top: Math.min(selectionBox.startY, selectionBox.endY),
                width: Math.abs(selectionBox.endX - selectionBox.startX),
                height: Math.abs(selectionBox.endY - selectionBox.startY),
              }}
            />
          )}

          {/* Loading overlay - shows on top of existing content */}
          {isLoading && files.length > 0 && (
            <div className="file-loading-overlay">
              <div className="loading-spinner-small"></div>
            </div>
          )}

          {/* Initial loading - only show full spinner when no files yet */}
          {isLoading && files.length === 0 ? (
            <div className="file-loading">
              <div className="loading-spinner"></div>
              <span>Loading files...</span>
            </div>
          ) : (
            <table className={`file-list ${isLoading ? 'loading' : ''}`}>
              <thead>
                <tr>
                  <th className="col-name" onClick={() => handleSort('name')}>
                    Name
                    {sortBy === 'name' && (
                      <span className="sort-indicator">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                  <th className="col-size" onClick={() => handleSort('size')}>
                    Size
                    {sortBy === 'size' && (
                      <span className="sort-indicator">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                  <th className="col-modified" onClick={() => handleSort('modified')}>
                    Modified
                    {sortBy === 'modified' && (
                      <span className="sort-indicator">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody ref={fileListRef}>
                {currentPath !== '/' && (
                  <tr
                    className={`file-row ${dropTargetParent ? 'drop-target' : ''}`}
                    onDoubleClick={navigateUp}
                    onDragOver={(e) => {
                      e.preventDefault();
                      const hasExternalFiles = e.dataTransfer.types.includes('Files');
                      e.dataTransfer.dropEffect = hasExternalFiles ? 'copy' : 'move';
                      setDropTargetParent(true);
                    }}
                    onDragLeave={() => setDropTargetParent(false)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const droppedFiles = e.dataTransfer.files;
                      if (droppedFiles.length > 0) {
                        // External files - upload to parent folder
                        const filePaths: string[] = [];
                        for (let i = 0; i < droppedFiles.length; i++) {
                          const f = droppedFiles[i];
                          if ((f as any).path) {
                            filePaths.push((f as any).path);
                          }
                        }
                        if (filePaths.length > 0) {
                          const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
                          await uploadFiles(filePaths, parentPath);
                        }
                      } else if (draggedFiles.length > 0) {
                        handleMoveToParent();
                      }
                      setDropTargetParent(false);
                    }}
                  >
                    <td className="col-name">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="icon-folder">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                      </svg>
                      <span>..</span>
                    </td>
                    <td className="col-size">—</td>
                    <td className="col-modified">—</td>
                  </tr>
                )}
                {filteredFiles.map((file, index) => (
                  <tr
                    key={file.name}
                    data-filename={file.name}
                    className={`file-row ${selectedFiles.has(file.name) ? 'selected' : ''} ${draggedFiles.includes(file.name) ? 'dragging' : ''} ${dropTargetFolder === file.name ? 'drop-target' : ''} ${focusedIndex === index ? 'focused' : ''}`}
                    draggable
                    onClick={(e) => {
                      handleSelect(file.name, e.ctrlKey || e.metaKey);
                      setFocusedIndex(index);
                    }}
                    onDoubleClick={() => handleFileDoubleClick(file)}
                    onContextMenu={(e) => handleContextMenu(e, 'file', file.name)}
                    onDragStart={(e) => handleFileDragStart(e, file)}
                    onDragOver={(e) => {
                      if (file.isDirectory && !draggedFiles.includes(file.name)) {
                        e.preventDefault();
                        // Check if it's an external drag (files from File Explorer)
                        const hasExternalFiles = e.dataTransfer.types.includes('Files');
                        e.dataTransfer.dropEffect = hasExternalFiles ? 'copy' : 'move';
                        setDropTargetFolder(file.name);
                      }
                    }}
                    onDragLeave={() => {
                      setDropTargetFolder(null);
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (file.isDirectory && !draggedFiles.includes(file.name)) {
                        // Check if it's an external file drop
                        const droppedFiles = e.dataTransfer.files;
                        if (droppedFiles.length > 0) {
                          // External files - upload to this folder
                          const filePaths: string[] = [];
                          for (let i = 0; i < droppedFiles.length; i++) {
                            const f = droppedFiles[i];
                            if ((f as any).path) {
                              filePaths.push((f as any).path);
                            }
                          }
                          if (filePaths.length > 0) {
                            const targetPath = currentPath === '/'
                              ? `/${file.name}`
                              : `${currentPath}/${file.name}`;
                            await uploadFiles(filePaths, targetPath);
                          }
                        } else {
                          // Internal drag - move files
                          handleMoveToFolder(file.name);
                        }
                      }
                      setDropTargetFolder(null);
                    }}
                    onDragEnd={() => {
                      setDraggedFiles([]);
                      setDropTargetFolder(null);
                    }}
                  >
                    <td className="col-name">
                      {getFileIcon(file)}
                      <span>{file.name}</span>
                    </td>
                    <td className="col-size">{file.isDirectory ? '—' : formatFileSize(file.size)}</td>
                    <td className="col-modified">{formatDate(file.modified)}</td>
                  </tr>
                ))}
                {sortedFiles.length === 0 && currentPath === '/' && (
                  <tr>
                    <td colSpan={3} className="empty-folder">
                      This folder is empty
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {shortcuts.length > 0 && (
          <div className="shortcuts-panel">
            <div className="shortcuts-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              <span>Shortcuts</span>
            </div>
            <div className="shortcuts-list">
              {shortcuts.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className={`shortcut-item ${shortcut.type === 'file' ? 'file' : ''} ${currentPath === shortcut.path ? 'active' : ''}`}
                  onClick={() => handleShortcutClick(shortcut)}
                  title={shortcut.path}
                >
                  {shortcut.type === 'file' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="icon-file">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="icon-folder">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                  )}
                  <span className="shortcut-name">{shortcut.name}</span>
                  <button
                    className="shortcut-delete"
                    onClick={(e) => handleDeleteShortcut(shortcut.id, e)}
                    title="Remove shortcut"
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
        )}
      </div>

      <div className="file-browser-status">
        <span>{files.length} items</span>
        {selectedFiles.size > 0 && <span>{selectedFiles.size} selected</span>}
        {clipboard && (
          <span className="clipboard-status">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
            {clipboard.files.length} {clipboard.operation === 'cut' ? 'cut' : 'copied'}
          </span>
        )}
        <span className="drag-hint">Drag files here to upload</span>
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog?.isOpen && (
        <div className="dialog-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="dialog-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{confirmDialog.title}</div>
            <div className="dialog-message">{confirmDialog.message}</div>
            <div className="dialog-buttons">
              <button
                className="dialog-btn dialog-btn-cancel"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                className={`dialog-btn ${confirmDialog.isDanger ? 'dialog-btn-danger' : 'dialog-btn-confirm'}`}
                onClick={confirmDialog.onConfirm}
              >
                {confirmDialog.isDanger ? 'Delete' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Node Modules Exclusion Dialog */}
      {nodeModulesDialog?.isOpen && (
        <div className="dialog-overlay" onClick={() => setNodeModulesDialog(null)}>
          <div className="dialog-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Exclude node_modules?</div>
            <div className="dialog-message">
              The folder{nodeModulesDialog.folders.length > 1 ? 's' : ''} you're uploading contain{nodeModulesDialog.folders.length === 1 ? 's' : ''} a <strong>node_modules</strong> directory.
              Would you like to exclude it from the upload?
            </div>
            <div className="dialog-buttons">
              <button
                className="dialog-btn dialog-btn-cancel"
                onClick={() => handleNodeModulesDialogResponse(false)}
              >
                No
              </button>
              <button
                className="dialog-btn dialog-btn-confirm"
                onClick={() => handleNodeModulesDialogResponse(true)}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Settings Dialog */}
      {uploadSettingsDialog && (
        <div className="dialog-overlay" onClick={() => setUploadSettingsDialog(false)}>
          <div className="dialog-content upload-settings-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Upload Settings</div>
            <div className="dialog-body">
              <div className="upload-mode-options">
                <label className={`upload-mode-option ${uploadMode === 'overwrite' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="uploadMode"
                    value="overwrite"
                    checked={uploadMode === 'overwrite'}
                    onChange={() => setUploadMode('overwrite')}
                  />
                  <div className="upload-mode-content">
                    <span className="upload-mode-title">Overwrite All</span>
                    <span className="upload-mode-desc">Replace all files, even if they exist on the server</span>
                  </div>
                </label>
                <label className={`upload-mode-option ${uploadMode === 'skip_existing' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="uploadMode"
                    value="skip_existing"
                    checked={uploadMode === 'skip_existing'}
                    onChange={() => setUploadMode('skip_existing')}
                  />
                  <div className="upload-mode-content">
                    <span className="upload-mode-title">Skip Existing</span>
                    <span className="upload-mode-desc">Only upload files that don't exist on the server</span>
                  </div>
                </label>
                <label className={`upload-mode-option ${uploadMode === 'newer_only' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="uploadMode"
                    value="newer_only"
                    checked={uploadMode === 'newer_only'}
                    onChange={() => setUploadMode('newer_only')}
                  />
                  <div className="upload-mode-content">
                    <span className="upload-mode-title">Newer Only</span>
                    <span className="upload-mode-desc">Only upload files that are newer than server version</span>
                  </div>
                </label>
              </div>
            </div>
            <div className="dialog-buttons">
              <button
                className="dialog-btn dialog-btn-confirm"
                onClick={() => setUploadSettingsDialog(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Context Menu */}
      {contextMenu && contextMenu.type === 'file' && contextMenu.fileName && (() => {
        const isFolder = files.find(f => f.name === contextMenu.fileName)?.isDirectory;
        return (
          <div
            className="file-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {!isFolder ? (
              <button onClick={() => { handleDownloadFile(contextMenu.fileName!); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download
              </button>
            ) : (
              <button onClick={() => { handleCompressAndDownload(contextMenu.fileName!); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download Folder
              </button>
            )}
            <button onClick={() => { handleCompress(contextMenu.fileName!); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 8v13H3V8"></path>
                <path d="M1 3h22v5H1z"></path>
                <path d="M10 12h4"></path>
              </svg>
              Compress
            </button>
            {!isFolder && (
              <button onClick={() => { handleCompressAndDownload(contextMenu.fileName!); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 8v13H3V8"></path>
                  <path d="M1 3h22v5H1z"></path>
                  <polyline points="7 16 12 21 17 16"></polyline>
                </svg>
                Compress & Download
              </button>
            )}
            <div className="context-menu-divider"></div>
            <button onClick={() => { handleCopy(); setContextMenu(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy
            </button>
            <button onClick={() => { handleCut(); setContextMenu(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="6" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
              </svg>
              Cut
            </button>
            {!isFolder && (
              <button onClick={() => { handleSaveFileShortcut(contextMenu.fileName!); setContextMenu(null); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                Add to Shortcuts
              </button>
            )}
            <button onClick={() => openCopyToServerDialog(contextMenu.fileName ? [contextMenu.fileName] : undefined)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
                <path d="M16 6l2 2-2 2"></path>
                <path d="M8 18l-2-2 2-2"></path>
              </svg>
              Copy to Another Server
            </button>
            <div className="context-menu-divider"></div>
            <button className="danger" onClick={() => { handleDeleteWithConfirm(); setContextMenu(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Delete
            </button>
          </div>
        );
      })()}

      {/* Empty Space Context Menu */}
      {contextMenu && contextMenu.type === 'empty' && (
        <div
          className="file-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { handleOpenInTerminal(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            Open in Terminal
          </button>
          <div className="context-menu-divider"></div>
          <button onClick={() => { handleNewFolder(); setContextMenu(null); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
            New Folder
          </button>
          <button onClick={() => { handleNewFile(); setContextMenu(null); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
            New File
          </button>
          <button onClick={openCloneDialog}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Clone Git Repository
          </button>
          <button onClick={() => openCopyToServerDialog()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
              <path d="M16 6l2 2-2 2"></path>
              <path d="M8 18l-2-2 2-2"></path>
            </svg>
            Copy to Another Server
          </button>
          <div className="context-menu-divider"></div>
          <button onClick={() => { handleDownloadCurrentFolder(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Current Folder
          </button>
          <button onClick={() => { loadDirectory(currentPath); setContextMenu(null); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Refresh
          </button>
        </div>
      )}

      {/* Image Viewer Modal */}
      {imageViewer && (
        <div className="dialog-overlay" onClick={() => setImageViewer(null)}>
          <div className="image-viewer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-viewer-header">
              <span>{imageViewer.fileName}</span>
              <button className="modal-close" onClick={() => setImageViewer(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="image-viewer-content">
              <img src={imageViewer.content} alt={imageViewer.fileName} />
            </div>
          </div>
        </div>
      )}

      {/* Code Editor Modal */}
      {codeEditor && (
        <div className="dialog-overlay" onClick={() => setCodeEditor(null)}>
          <div className="code-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="code-editor-header">
              <span>{codeEditor.fileName}</span>
              <div className="code-editor-actions">
                <button className="save-btn" onClick={handleSaveCode}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                  Save
                </button>
                <button className="modal-close" onClick={() => setCodeEditor(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>
            <textarea
              className="code-editor-textarea"
              value={codeEditorContent}
              onChange={(e) => setCodeEditorContent(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* Clone Repository Dialog */}
      {cloneDialog && (
        <div className="dialog-overlay" onClick={() => setCloneDialog(false)}>
          <div className="dialog-content clone-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Clone Git Repository</div>

            {/* GitHub Repos Section */}
            {localStorage.getItem('githubToken') && (
              <div className="form-group">
                <label>Your GitHub Repositories</label>
                {githubRepos.length > 5 && (
                  <div className="repo-search-wrapper">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                      type="text"
                      className="repo-search-input"
                      value={repoSearchQuery}
                      onChange={(e) => setRepoSearchQuery(e.target.value)}
                      placeholder="Search repositories..."
                    />
                    {repoSearchQuery && (
                      <button className="repo-search-clear" onClick={() => setRepoSearchQuery('')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                {isLoadingRepos ? (
                  <div className="repos-loading">Loading repositories...</div>
                ) : githubRepos.length > 0 ? (
                  <div className="repos-list">
                    {githubRepos
                      .filter(repo =>
                        !repoSearchQuery ||
                        repo.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
                        repo.full_name.toLowerCase().includes(repoSearchQuery.toLowerCase())
                      )
                      .slice(0, 15)
                      .map(repo => (
                        <button
                          key={repo.full_name}
                          className={`repo-item ${cloneUrl === repo.clone_url ? 'selected' : ''}`}
                          onClick={() => setCloneUrl(repo.clone_url)}
                        >
                          <span className="repo-name">{repo.full_name}</span>
                          {repo.org && <span className="repo-org">{repo.org}</span>}
                          {repo.private && <span className="repo-private">Private</span>}
                        </button>
                      ))}
                    {!repoSearchQuery && githubRepos.length > 15 && (
                      <div className="repos-more">+{githubRepos.length - 15} more repos (use search)</div>
                    )}
                    {repoSearchQuery && githubRepos.filter(repo =>
                      repo.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
                      repo.full_name.toLowerCase().includes(repoSearchQuery.toLowerCase())
                    ).length === 0 && (
                      <div className="repos-empty">No matching repositories</div>
                    )}
                  </div>
                ) : (
                  <div className="repos-empty">No repositories found</div>
                )}
              </div>
            )}

            {!localStorage.getItem('githubToken') && (
              <div className="github-hint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Connect GitHub in Dashboard to see your private repos
              </div>
            )}

            <div className="form-group">
              <label>Or enter Repository URL</label>
              <input
                type="text"
                className="dialog-input"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cloneUrl.trim()) handleCloneRepo();
                  if (e.key === 'Escape') setCloneDialog(false);
                }}
              />
            </div>
            <div className="clone-path-info">
              Clone to: <code>{currentPath}</code>
            </div>
            <div className="dialog-buttons">
              <button className="dialog-btn dialog-btn-cancel" onClick={() => setCloneDialog(false)}>
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-confirm"
                onClick={() => handleCloneRepo()}
                disabled={!cloneUrl.trim()}
              >
                Clone
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy to Another Server Dialog */}
      {copyToServerDialog && (
        <div className="dialog-overlay" onClick={() => setCopyToServerDialog(false)}>
          <div className="dialog-content clone-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Copy to Another Server</div>

            {/* Files to Copy */}
            <div className="form-group">
              <label>Files to Copy</label>
              <div className="copy-files-list">
                {copySourceFiles.map((file, idx) => (
                  <div key={idx} className="copy-file-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {file === '.' ? (
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                      ) : (
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      )}
                    </svg>
                    <span>{file === '.' ? `Current folder (${currentPath})` : file}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Target Server Selection */}
            <div className="form-group">
              <label>Select Target Server</label>
              {availableConnections.length > 0 ? (
                <div className="server-list">
                  {availableConnections.map(conn => (
                    <button
                      key={conn.id}
                      className={`server-item ${selectedTargetServer === conn.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTargetServer(conn.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                        <line x1="6" y1="6" x2="6.01" y2="6"></line>
                        <line x1="6" y1="18" x2="6.01" y2="18"></line>
                      </svg>
                      <span>{conn.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="repos-empty">No other servers connected</div>
              )}
            </div>

            {/* Target Path */}
            <div className="form-group">
              <label>Target Path on Server</label>
              <input
                type="text"
                className="dialog-input"
                value={copyTargetPath}
                onChange={(e) => setCopyTargetPath(e.target.value)}
                placeholder="/path/to/destination"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && selectedTargetServer) handleCopyToServer();
                  if (e.key === 'Escape') setCopyToServerDialog(false);
                }}
              />
            </div>

            <div className="dialog-buttons">
              <button className="dialog-btn dialog-btn-cancel" onClick={() => setCopyToServerDialog(false)}>
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-confirm"
                onClick={handleCopyToServer}
                disabled={!selectedTargetServer || isCopying}
              >
                {isCopying ? 'Copying...' : 'Copy to Server'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileBrowser;
