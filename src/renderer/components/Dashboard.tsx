import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PackageShortcut } from '../types/electron';
import { v4 as uuidv4 } from 'uuid';
import './Dashboard.css';

interface DashboardProps {
  connectionId: string;
  currentPath?: string;
}

interface GitAccount {
  provider: 'github' | 'gitlab' | 'custom';
  username: string;
  token: string;
  repos: { name: string; url: string; private: boolean }[];
}

interface SystemStats {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  network: { rx: number; tx: number };
  uptime: string;
  loadAvg: number[];
}

interface OpenPort {
  protocol: string;
  port: number;
  pid: string;
  process: string;
  address: string;
}

interface IptablesRule {
  chain: string;
  num: number;
  target: string;
  protocol: string;
  source: string;
  destination: string;
  options: string;
}

interface GitRepo {
  path: string;
  branch: string;
  status: string;
  hasChanges: boolean;
}

function Dashboard({ connectionId, currentPath = '/' }: DashboardProps) {
  // System Stats
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Package Installer
  const [packages, setPackages] = useState<PackageShortcut[]>([]);
  const [packageStatuses, setPackageStatuses] = useState<Record<string, 'installed' | 'not-installed' | 'checking' | 'installing'>>({});
  const [installOutput, setInstallOutput] = useState<string>('');
  const [showPackageModal, setShowPackageModal] = useState(false);
  const [editingPackage, setEditingPackage] = useState<PackageShortcut | null>(null);

  // Ports
  const [ports, setPorts] = useState<OpenPort[]>([]);
  const [portsLoading, setPortsLoading] = useState(false);

  // Firewall
  const [iptablesRules, setIptablesRules] = useState<IptablesRule[]>([]);
  const [firewallLoading, setFirewallLoading] = useState(false);
  const [showFirewallModal, setShowFirewallModal] = useState(false);
  const [newRule, setNewRule] = useState({ chain: 'INPUT', protocol: 'tcp', port: '', action: 'ACCEPT', source: '' });

  // Git
  const [gitRepos, setGitRepos] = useState<GitRepo[]>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);
  const [gitCloneUrl, setGitCloneUrl] = useState('');
  const [gitClonePath, setGitClonePath] = useState(currentPath);
  const [useSSH, setUseSSH] = useState(false);

  // Git Account
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [gitAccount, setGitAccount] = useState<GitAccount | null>(null);
  const [accountToken, setAccountToken] = useState('');
  const [accountProvider, setAccountProvider] = useState<'github' | 'gitlab'>('github');
  const [accountRepos, setAccountRepos] = useState<{ name: string; url: string; private: boolean }[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  // GitHub Device Flow
  const [deviceFlowActive, setDeviceFlowActive] = useState(false);
  const [deviceCode, setDeviceCode] = useState('');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [deviceFlowError, setDeviceFlowError] = useState('');
  const [githubUser, setGithubUser] = useState<{ login: string; avatar_url: string } | null>(null);
  const deviceFlowIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // General
  const [activeWidget, setActiveWidget] = useState<string>('stats');
  const [error, setError] = useState<string | null>(null);

  // Process details modal
  const [processModal, setProcessModal] = useState<{
    type: 'cpu' | 'memory';
    processes: { pid: string; user: string; cpu: string; mem: string; command: string }[];
  } | null>(null);
  const [processLoading, setProcessLoading] = useState(false);

  // Input dialog state
  const [inputDialog, setInputDialog] = useState<{
    isOpen: boolean;
    title: string;
    defaultValue: string;
    onConfirm: (value: string) => void;
  } | null>(null);
  const [inputValue, setInputValue] = useState('');

  // ========== SYSTEM STATS ==========
  const fetchStats = useCallback(async () => {
    try {
      const cmd = `
        echo "CPU:$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || echo "0")"
        echo "MEM:$(free -b | awk 'NR==2{printf "%d:%d:%.1f", $3, $2, $3*100/$2}')"
        echo "NET:$(cat /proc/net/dev | awk 'NR>2{rx+=$2;tx+=$10}END{print rx":"tx}')"
        echo "UPTIME:$(uptime -p 2>/dev/null || uptime | awk -F'up' '{print $2}' | awk -F',' '{print $1}')"
        echo "LOAD:$(cat /proc/loadavg | awk '{print $1":"$2":"$3}')"
      `;
      const result = await window.electronAPI.exec(connectionId, cmd);
      if (result.code === 0) {
        const lines = result.stdout.split('\n');
        const cpuLine = lines.find(l => l.startsWith('CPU:'));
        const memLine = lines.find(l => l.startsWith('MEM:'));
        const netLine = lines.find(l => l.startsWith('NET:'));
        const uptimeLine = lines.find(l => l.startsWith('UPTIME:'));
        const loadLine = lines.find(l => l.startsWith('LOAD:'));

        const cpu = parseFloat(cpuLine?.split(':')[1] || '0');
        const memParts = memLine?.split(':').slice(1) || ['0', '1', '0'];
        const netParts = netLine?.split(':').slice(1) || ['0', '0'];
        const loadParts = loadLine?.split(':').slice(1) || ['0', '0', '0'];

        setStats({
          cpu,
          memory: {
            used: parseInt(memParts[0]) || 0,
            total: parseInt(memParts[1]) || 1,
            percent: parseFloat(memParts[2]) || 0,
          },
          network: {
            rx: parseInt(netParts[0]) || 0,
            tx: parseInt(netParts[1]) || 0,
          },
          uptime: uptimeLine?.replace('UPTIME:', '').trim() || 'Unknown',
          loadAvg: loadParts.map(l => parseFloat(l) || 0),
        });
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchStats();
    statsIntervalRef.current = setInterval(fetchStats, 3000);
    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [fetchStats]);

  // ========== PACKAGE INSTALLER ==========
  const loadPackages = useCallback(async () => {
    try {
      const pkgs = await window.electronAPI.getPackages();
      setPackages(pkgs);
    } catch (err) {
      console.error('Failed to load packages:', err);
    }
  }, []);

  const checkPackageStatus = useCallback(async (pkg: PackageShortcut) => {
    setPackageStatuses(prev => ({ ...prev, [pkg.id]: 'checking' }));
    try {
      const result = await window.electronAPI.exec(connectionId, pkg.checkCommand);
      setPackageStatuses(prev => ({
        ...prev,
        [pkg.id]: result.code === 0 ? 'installed' : 'not-installed'
      }));
    } catch {
      setPackageStatuses(prev => ({ ...prev, [pkg.id]: 'not-installed' }));
    }
  }, [connectionId]);

  const checkAllPackages = useCallback(async () => {
    for (const pkg of packages) {
      await checkPackageStatus(pkg);
    }
  }, [packages, checkPackageStatus]);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  useEffect(() => {
    if (packages.length > 0) {
      checkAllPackages();
    }
  }, [packages]);

  const installPackage = async (pkg: PackageShortcut) => {
    setPackageStatuses(prev => ({ ...prev, [pkg.id]: 'installing' }));
    setInstallOutput(`Installing ${pkg.name}...\n`);
    try {
      const result = await window.electronAPI.execSudo(connectionId, pkg.installCommand);
      setInstallOutput(prev => prev + result.stdout + result.stderr);
      if (result.code === 0) {
        setPackageStatuses(prev => ({ ...prev, [pkg.id]: 'installed' }));
        setInstallOutput(prev => prev + `\n✓ ${pkg.name} installed successfully!`);
      } else {
        setPackageStatuses(prev => ({ ...prev, [pkg.id]: 'not-installed' }));
        setInstallOutput(prev => prev + `\n✗ Installation failed with code ${result.code}`);
      }
    } catch (err: any) {
      setInstallOutput(prev => prev + `\n✗ Error: ${err.message}`);
      setPackageStatuses(prev => ({ ...prev, [pkg.id]: 'not-installed' }));
    }
  };

  const savePackageShortcut = async (pkg: PackageShortcut) => {
    try {
      const updated = await window.electronAPI.savePackage(pkg);
      setPackages(updated);
      setShowPackageModal(false);
      setEditingPackage(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deletePackageShortcut = async (packageId: string) => {
    try {
      const updated = await window.electronAPI.deletePackage(packageId);
      setPackages(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ========== PORTS ==========
  const fetchPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      const result = await window.electronAPI.execSudo(connectionId,
        "ss -tulnp 2>/dev/null | tail -n +2 | awk '{print $1, $5, $7}' || netstat -tulnp 2>/dev/null | tail -n +3 | awk '{print $1, $4, $7}'"
      );
      if (result.code === 0) {
        const portList: OpenPort[] = [];
        const lines = result.stdout.trim().split('\n').filter(l => l.trim());
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            const protocol = parts[0].toLowerCase();
            const addrPort = parts[1];
            const pidInfo = parts[2] || '';

            const lastColon = addrPort.lastIndexOf(':');
            const address = addrPort.substring(0, lastColon) || '*';
            const port = parseInt(addrPort.substring(lastColon + 1)) || 0;

            const pidMatch = pidInfo.match(/pid=(\d+)|(\d+)\//);
            const pid = pidMatch ? (pidMatch[1] || pidMatch[2]) : '';
            const processMatch = pidInfo.match(/\("([^"]+)"|\/([^\/\s]+)/);
            const process = processMatch ? (processMatch[1] || processMatch[2]) : '';

            if (port > 0) {
              portList.push({ protocol, port, pid, process, address });
            }
          }
        }
        setPorts(portList.sort((a, b) => a.port - b.port));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPortsLoading(false);
    }
  }, [connectionId]);

  const killPort = async (port: OpenPort) => {
    if (!port.pid) {
      setError('No PID found for this port');
      return;
    }
    try {
      await window.electronAPI.execSudo(connectionId, `kill -9 ${port.pid}`);
      fetchPorts();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ========== FIREWALL ==========
  const fetchIptables = useCallback(async () => {
    setFirewallLoading(true);
    try {
      const result = await window.electronAPI.execSudo(connectionId,
        "iptables -L -n --line-numbers 2>/dev/null"
      );
      if (result.code === 0) {
        const rules: IptablesRule[] = [];
        let currentChain = '';
        const lines = result.stdout.split('\n');

        for (const line of lines) {
          if (line.startsWith('Chain ')) {
            currentChain = line.split(' ')[1];
          } else if (line.match(/^\d+/)) {
            const parts = line.split(/\s+/);
            rules.push({
              chain: currentChain,
              num: parseInt(parts[0]),
              target: parts[1],
              protocol: parts[2],
              source: parts[4],
              destination: parts[5],
              options: parts.slice(6).join(' '),
            });
          }
        }
        setIptablesRules(rules);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFirewallLoading(false);
    }
  }, [connectionId]);

  const addIptablesRule = async () => {
    try {
      let cmd = `iptables -A ${newRule.chain} -p ${newRule.protocol}`;
      if (newRule.port) cmd += ` --dport ${newRule.port}`;
      if (newRule.source) cmd += ` -s ${newRule.source}`;
      cmd += ` -j ${newRule.action}`;

      await window.electronAPI.execSudo(connectionId, cmd);
      setShowFirewallModal(false);
      setNewRule({ chain: 'INPUT', protocol: 'tcp', port: '', action: 'ACCEPT', source: '' });
      fetchIptables();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteIptablesRule = async (rule: IptablesRule) => {
    try {
      await window.electronAPI.execSudo(connectionId, `iptables -D ${rule.chain} ${rule.num}`);
      fetchIptables();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ========== GIT ==========
  const scanGitRepos = useCallback(async (searchPath: string = '~') => {
    setGitLoading(true);
    try {
      const result = await window.electronAPI.exec(connectionId,
        `find ${searchPath} -maxdepth 4 -type d -name ".git" 2>/dev/null | head -20`
      );
      if (result.code === 0) {
        const repos: GitRepo[] = [];
        const gitDirs = result.stdout.trim().split('\n').filter(l => l.trim());

        for (const gitDir of gitDirs) {
          const repoPath = gitDir.replace('/.git', '');
          const branchResult = await window.electronAPI.exec(connectionId,
            `cd "${repoPath}" && git branch --show-current 2>/dev/null`
          );
          const statusResult = await window.electronAPI.exec(connectionId,
            `cd "${repoPath}" && git status --porcelain 2>/dev/null | head -1`
          );

          repos.push({
            path: repoPath,
            branch: branchResult.stdout.trim() || 'unknown',
            status: statusResult.stdout.trim() ? 'modified' : 'clean',
            hasChanges: !!statusResult.stdout.trim(),
          });
        }
        setGitRepos(repos);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGitLoading(false);
    }
  }, [connectionId]);

  const gitPull = async (repoPath: string) => {
    try {
      setInstallOutput(`Pulling ${repoPath}...\n`);
      const result = await window.electronAPI.exec(connectionId, `cd "${repoPath}" && git pull`);
      setInstallOutput(prev => prev + result.stdout + result.stderr);
      scanGitRepos();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const gitClone = async () => {
    if (!gitCloneUrl) return;
    try {
      setInstallOutput(`Cloning ${gitCloneUrl}...\n`);

      // For private repos with token, modify the URL
      let cloneUrl = gitCloneUrl;
      if (gitAccount?.token && !useSSH && gitCloneUrl.startsWith('https://')) {
        const urlObj = new URL(gitCloneUrl);
        cloneUrl = `https://${gitAccount.token}@${urlObj.host}${urlObj.pathname}`;
      }

      const result = await window.electronAPI.exec(connectionId,
        `cd "${gitClonePath}" && git clone "${cloneUrl}"`
      );
      setInstallOutput(prev => prev + result.stdout + result.stderr);
      setShowGitModal(false);
      setGitCloneUrl('');
      scanGitRepos();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Sync gitClonePath with currentPath from FileBrowser
  useEffect(() => {
    if (currentPath && currentPath !== '/') {
      setGitClonePath(currentPath);
    }
  }, [currentPath]);

  // Fetch repos from GitHub/GitLab
  const fetchAccountRepos = async () => {
    if (!accountToken) return;
    setLoadingRepos(true);

    try {
      let repos: { name: string; url: string; private: boolean }[] = [];

      if (accountProvider === 'github') {
        // Use GitHub API via fetch
        const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
          headers: {
            'Authorization': `Bearer ${accountToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          repos = data.map((repo: any) => ({
            name: repo.full_name,
            url: useSSH ? repo.ssh_url : repo.clone_url,
            private: repo.private,
          }));
        } else {
          throw new Error('Failed to fetch GitHub repos');
        }
      } else if (accountProvider === 'gitlab') {
        const response = await fetch('https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at', {
          headers: {
            'PRIVATE-TOKEN': accountToken,
          },
        });

        if (response.ok) {
          const data = await response.json();
          repos = data.map((repo: any) => ({
            name: repo.path_with_namespace,
            url: useSSH ? repo.ssh_url_to_repo : repo.http_url_to_repo,
            private: repo.visibility === 'private',
          }));
        } else {
          throw new Error('Failed to fetch GitLab repos');
        }
      }

      setAccountRepos(repos);
      setGitAccount({
        provider: accountProvider,
        username: '',
        token: accountToken,
        repos,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingRepos(false);
    }
  };

  const selectRepoFromAccount = (repo: { name: string; url: string; private: boolean }) => {
    setGitCloneUrl(repo.url);
    setShowAccountModal(false);
  };

  // GitHub Device Flow
  const startDeviceFlow = async () => {
    setDeviceFlowError('');
    setDeviceFlowActive(true);

    try {
      const result = await window.electronAPI.githubStartDeviceFlow();

      if (!result.success) {
        setDeviceFlowError(result.error || 'Failed to start device flow');
        setDeviceFlowActive(false);
        return;
      }

      setDeviceCode(result.device_code!);
      setUserCode(result.user_code!);
      setVerificationUri(result.verification_uri!);

      // Open the verification URL in browser
      window.electronAPI.openExternal(result.verification_uri!);

      // Start polling for the token using recursive setTimeout for dynamic interval
      const deviceCodeToUse = result.device_code!;
      let currentInterval = (result.interval || 5) * 1000;
      console.log('Starting device flow polling with interval:', currentInterval, 'device_code:', deviceCodeToUse);

      const pollForToken = async () => {
        console.log('Polling for token...');
        const pollResult = await window.electronAPI.githubPollDeviceFlow(deviceCodeToUse);
        console.log('Poll result:', pollResult);

        if (pollResult.success && pollResult.access_token) {
          // Got the token!
          const token = pollResult.access_token;
          setAccountToken(token);
          setDeviceFlowActive(false);
          setUserCode('');
          setDeviceCode('');

          // Save token immediately to localStorage
          localStorage.setItem('githubToken', token);

          // Fetch user info
          const userResult = await window.electronAPI.githubGetUser(token);
          if (userResult.success && userResult.user) {
            setGithubUser({ login: userResult.user.login, avatar_url: userResult.user.avatar_url });
          }

          // Fetch repos
          const reposResult = await window.electronAPI.githubGetRepos(token);
          if (reposResult.success && reposResult.repos) {
            const repos = reposResult.repos.map((repo: any) => ({
              name: repo.full_name,
              url: useSSH ? repo.ssh_url : repo.clone_url,
              private: repo.private,
            }));
            setAccountRepos(repos);
            setGitAccount({
              provider: 'github',
              username: userResult.user?.login || '',
              token: token,
              repos,
            });
          }
        } else if (pollResult.error) {
          // Error (expired, denied, etc.)
          setDeviceFlowError(pollResult.error);
          setDeviceFlowActive(false);
          setUserCode('');
          setDeviceCode('');
        } else if (pollResult.slow_down) {
          // GitHub wants us to slow down - add 5 seconds
          currentInterval += 5000;
          console.log('Slowing down, new interval:', currentInterval);
          deviceFlowIntervalRef.current = setTimeout(pollForToken, currentInterval) as unknown as NodeJS.Timeout;
        } else {
          // Pending - continue polling at current interval
          deviceFlowIntervalRef.current = setTimeout(pollForToken, currentInterval) as unknown as NodeJS.Timeout;
        }
      };

      // Start first poll
      deviceFlowIntervalRef.current = setTimeout(pollForToken, currentInterval) as unknown as NodeJS.Timeout;
    } catch (err: any) {
      setDeviceFlowError(err.message);
      setDeviceFlowActive(false);
    }
  };

  const cancelDeviceFlow = () => {
    if (deviceFlowIntervalRef.current) {
      clearTimeout(deviceFlowIntervalRef.current);
      deviceFlowIntervalRef.current = null;
    }
    setDeviceFlowActive(false);
    setUserCode('');
    setDeviceCode('');
    setDeviceFlowError('');
  };

  const disconnectGitHub = () => {
    setGitAccount(null);
    setGithubUser(null);
    setAccountToken('');
    setAccountRepos([]);
    localStorage.removeItem('githubToken');
  };

  // Load saved GitHub token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('githubToken');
    if (savedToken) {
      setAccountToken(savedToken);
      // Fetch user and repos with saved token
      (async () => {
        const userResult = await window.electronAPI.githubGetUser(savedToken);
        if (userResult.success && userResult.user) {
          setGithubUser({ login: userResult.user.login, avatar_url: userResult.user.avatar_url });

          const reposResult = await window.electronAPI.githubGetRepos(savedToken);
          if (reposResult.success && reposResult.repos) {
            const repos = reposResult.repos.map((repo: any) => ({
              name: repo.full_name,
              url: useSSH ? repo.ssh_url : repo.clone_url,
              private: repo.private,
            }));
            setAccountRepos(repos);
            setGitAccount({
              provider: 'github',
              username: userResult.user.login,
              token: savedToken,
              repos,
            });
          }
        } else {
          // Token invalid, clear it
          localStorage.removeItem('githubToken');
        }
      })();
    }
  }, []);

  // Save token when it changes
  useEffect(() => {
    if (accountToken && gitAccount?.provider === 'github') {
      localStorage.setItem('githubToken', accountToken);
    }
  }, [accountToken, gitAccount]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (deviceFlowIntervalRef.current) {
        clearTimeout(deviceFlowIntervalRef.current);
      }
    };
  }, []);

  // ========== PROCESS DETAILS ==========
  const fetchTopProcesses = async (sortBy: 'cpu' | 'memory') => {
    setProcessLoading(true);
    try {
      const sortFlag = sortBy === 'cpu' ? '-pcpu' : '-pmem';
      const result = await window.electronAPI.exec(connectionId,
        `ps aux --sort=${sortFlag} | head -16 | tail -15 | awk '{printf "%s\\t%s\\t%s\\t%s\\t", $2, $1, $3, $4; for(i=11;i<=NF;i++) printf "%s ", $i; print ""}'`
      );

      if (result.code === 0) {
        const processes = result.stdout.trim().split('\n').map(line => {
          const parts = line.split('\t');
          return {
            pid: parts[0] || '',
            user: parts[1] || '',
            cpu: parts[2] || '0',
            mem: parts[3] || '0',
            command: parts[4]?.trim() || '',
          };
        }).filter(p => p.pid);

        setProcessModal({ type: sortBy, processes });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessLoading(false);
    }
  };

  const killProcess = async (pid: string) => {
    try {
      await window.electronAPI.execSudo(connectionId, `kill -9 ${pid}`);
      // Refresh the process list
      if (processModal) {
        fetchTopProcesses(processModal.type);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ========== HELPERS ==========
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getPackageIcon = (icon?: string) => {
    switch (icon) {
      case 'docker':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186h-2.119a.185.185 0 00-.186.185v1.888c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.185v1.888c0 .102.084.185.186.185m-2.92-2.715H2.17a.186.186 0 00-.186.185v1.888c0 .102.084.185.186.185h2.119a.185.185 0 00.185-.185V6.29a.185.185 0 00-.185-.185m15.042 5.016c-.18-.224-.393-.312-.636-.312-.171 0-.308.058-.469.159a4.8 4.8 0 01-.078.047.41.41 0 01-.153.026c-.211 0-.369-.058-.565-.2a2.96 2.96 0 01-.198-.141c-.251-.182-.527-.392-.857-.392-.18 0-.354.049-.517.137-.406.217-.637.612-.637 1.046 0 .358.12.66.35.908.206.221.463.372.747.442.306.075.64.084.988.084h5.358c.5 0 .927-.207 1.121-.582.061-.118.092-.261.092-.434 0-.255-.082-.589-.335-.952-.226-.33-.561-.63-.976-.844-.41-.212-.866-.331-1.334-.331-.316 0-.627.064-.913.184-.226.095-.432.214-.611.358"/>
          </svg>
        );
      case 'nodejs':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.998 24c-.321 0-.641-.084-.922-.247l-2.936-1.737c-.438-.245-.224-.332-.08-.383.585-.203.703-.25 1.328-.604.065-.037.151-.023.218.017l2.256 1.339c.082.045.198.045.275 0l8.795-5.076c.082-.047.134-.141.134-.238V6.921c0-.099-.053-.193-.137-.242l-8.791-5.072c-.081-.047-.189-.047-.271 0L3.075 6.68c-.085.049-.139.144-.139.243v10.15c0 .097.054.189.139.235l2.409 1.392c1.307.653 2.108-.116 2.108-.89V7.787c0-.142.114-.253.256-.253h1.115c.139 0 .255.112.255.253v10.021c0 1.745-.95 2.745-2.604 2.745-.508 0-.909 0-2.026-.551l-2.304-1.327C.576 18.122 0 17.208 0 16.228V6.078c0-.93.576-1.796 1.522-2.262L10.314.739c.927-.513 2.166-.513 3.089 0l8.793 5.077c.945.466 1.523 1.333 1.523 2.262v10.15c0 .929-.578 1.793-1.523 2.259l-8.793 5.076c-.28.163-.601.246-.923.246l.018.001zm2.709-6.998c-3.844 0-4.65-1.764-4.65-3.247 0-.142.113-.253.256-.253h1.137c.127 0 .234.091.253.215.172 1.163.687 1.75 3.026 1.75 1.862 0 2.655-.421 2.655-1.408 0-.569-.225-1.001-3.118-1.285-2.415-.239-3.909-.771-3.909-2.698 0-1.778 1.498-2.837 4.007-2.837 2.817 0 4.207.977 4.384 3.076.006.075-.021.147-.067.203-.044.055-.107.088-.175.088h-1.143c-.117 0-.22-.083-.248-.196-.276-1.224-.945-1.617-2.751-1.617-2.027 0-2.263.706-2.263 1.236 0 .64.279.827 3.023 1.188 2.717.358 4.007.865 4.007 2.776-.001 1.918-1.599 3.017-4.387 3.017l-.021-.008z"/>
          </svg>
        );
      case 'cloud':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
          </svg>
        );
      case 'server':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
        );
      case 'git':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187"/>
          </svg>
        );
      case 'rust':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.835 11.703a.699.699 0 00-.252-.604l-1.18-.839a.71.71 0 01-.212-.527l.072-1.443a.699.699 0 00-.37-.606l-1.291-.71a.71.71 0 01-.32-.47l-.31-1.418a.699.699 0 00-.469-.492l-1.392-.412a.71.71 0 01-.396-.374l-.612-1.329a.699.699 0 00-.546-.375l-1.452-.053a.71.71 0 01-.478-.231L14.15.38a.699.699 0 00-.598-.266l-1.44.144a.71.71 0 01-.518-.145L10.405.015a.699.699 0 00-.654 0l-1.189.098a.71.71 0 01-.518.145L6.604.114a.699.699 0 00-.598.266l-.977 1.04a.71.71 0 01-.478.231l-1.452.053a.699.699 0 00-.546.375l-.612 1.329a.71.71 0 01-.396.374l-1.392.412a.699.699 0 00-.469.492l-.31 1.418a.71.71 0 01-.32.47l-1.291.71a.699.699 0 00-.37.606l.072 1.443a.71.71 0 01-.212.527l-1.18.839a.699.699 0 000 1.134l1.18.839a.71.71 0 01.212.527l-.072 1.443a.699.699 0 00.37.606l1.291.71a.71.71 0 01.32.47l.31 1.418a.699.699 0 00.469.492l1.392.412a.71.71 0 01.396.374l.612 1.329a.699.699 0 00.546.375l1.452.053a.71.71 0 01.478.231l.977 1.04a.699.699 0 00.598.266l1.44-.144a.71.71 0 01.518.145l1.189.098a.699.699 0 00.654 0l1.189-.098a.71.71 0 01.518-.145l1.44.144a.699.699 0 00.598-.266l.977-1.04a.71.71 0 01.478-.231l1.452-.053a.699.699 0 00.546-.375l.612-1.329a.71.71 0 01.396-.374l1.392-.412a.699.699 0 00.469-.492l.31-1.418a.71.71 0 01.32-.47l1.291-.71a.699.699 0 00.37-.606l-.072-1.443a.71.71 0 01.212-.527l1.18-.839a.699.699 0 00.252-.53zM12 18.745a6.745 6.745 0 110-13.49 6.745 6.745 0 010 13.49z"/>
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
          </svg>
        );
    }
  };

  // ========== RENDER ==========
  return (
    <div className="dashboard">
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
              <button className="dialog-btn dialog-btn-cancel" onClick={() => setInputDialog(null)}>
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

      {/* Package Edit Modal */}
      {showPackageModal && (
        <div className="dialog-overlay" onClick={() => setShowPackageModal(false)}>
          <div className="dialog-content dialog-wide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{editingPackage ? 'Edit Package' : 'Add Custom Package'}</div>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                className="dialog-input"
                value={editingPackage?.name || ''}
                onChange={(e) => setEditingPackage(prev => prev ? { ...prev, name: e.target.value } : null)}
                placeholder="Package name"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input
                type="text"
                className="dialog-input"
                value={editingPackage?.description || ''}
                onChange={(e) => setEditingPackage(prev => prev ? { ...prev, description: e.target.value } : null)}
                placeholder="Short description"
              />
            </div>
            <div className="form-group">
              <label>Install Command</label>
              <textarea
                className="dialog-input dialog-textarea"
                value={editingPackage?.installCommand || ''}
                onChange={(e) => setEditingPackage(prev => prev ? { ...prev, installCommand: e.target.value } : null)}
                placeholder="Command to install the package"
              />
            </div>
            <div className="form-group">
              <label>Check Command</label>
              <input
                type="text"
                className="dialog-input"
                value={editingPackage?.checkCommand || ''}
                onChange={(e) => setEditingPackage(prev => prev ? { ...prev, checkCommand: e.target.value } : null)}
                placeholder="Command to check if installed (exit 0 = installed)"
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select
                className="dialog-input"
                value={editingPackage?.category || 'custom'}
                onChange={(e) => setEditingPackage(prev => prev ? { ...prev, category: e.target.value as any } : null)}
              >
                <option value="container">Container</option>
                <option value="runtime">Runtime</option>
                <option value="tool">Tool</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="dialog-buttons">
              <button className="dialog-btn dialog-btn-cancel" onClick={() => { setShowPackageModal(false); setEditingPackage(null); }}>
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-confirm"
                onClick={() => editingPackage && savePackageShortcut(editingPackage)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Clone Modal */}
      {showGitModal && (
        <div className="dialog-overlay" onClick={() => setShowGitModal(false)}>
          <div className="dialog-content dialog-wide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Clone Repository</div>
            <div className="form-group">
              <div className="input-with-button">
                <label>Repository URL</label>
                <button
                  className="browse-repos-btn"
                  onClick={() => setShowAccountModal(true)}
                  title="Browse your repositories"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/>
                  </svg>
                  My Repos
                </button>
              </div>
              <input
                type="text"
                className="dialog-input"
                value={gitCloneUrl}
                onChange={(e) => setGitCloneUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
              />
            </div>
            <div className="form-group">
              <label>Target Directory <span className="label-hint">(synced with Files browser)</span></label>
              <input
                type="text"
                className="dialog-input"
                value={gitClonePath}
                onChange={(e) => setGitClonePath(e.target.value)}
                placeholder="~"
              />
            </div>
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={useSSH}
                  onChange={(e) => setUseSSH(e.target.checked)}
                />
                Use SSH for cloning (requires SSH key on server)
              </label>
            </div>
            {gitAccount && (
              <div className="account-info">
                <span className="account-badge">
                  {gitAccount.provider === 'github' ? 'GitHub' : 'GitLab'} connected
                </span>
              </div>
            )}
            <div className="dialog-buttons">
              <button className="dialog-btn dialog-btn-cancel" onClick={() => setShowGitModal(false)}>
                Cancel
              </button>
              <button className="dialog-btn dialog-btn-confirm" onClick={gitClone}>
                Clone
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Account Modal */}
      {showAccountModal && (
        <div className="dialog-overlay" onClick={() => { setShowAccountModal(false); cancelDeviceFlow(); }}>
          <div className="dialog-content dialog-wide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Connect Git Account</div>

            {/* Provider Selector */}
            <div className="form-group">
              <label>Provider</label>
              <div className="provider-selector">
                <button
                  className={`provider-btn ${accountProvider === 'github' ? 'active' : ''}`}
                  onClick={() => { setAccountProvider('github'); cancelDeviceFlow(); }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  GitHub
                </button>
                <button
                  className={`provider-btn ${accountProvider === 'gitlab' ? 'active' : ''}`}
                  onClick={() => { setAccountProvider('gitlab'); cancelDeviceFlow(); }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
                  </svg>
                  GitLab
                </button>
              </div>
            </div>

            {/* GitHub - Device Flow */}
            {accountProvider === 'github' && (
              <>
                {/* Connected User */}
                {githubUser && !deviceFlowActive && (
                  <div className="connected-account">
                    <img src={githubUser.avatar_url} alt={githubUser.login} className="account-avatar" />
                    <div className="account-info">
                      <span className="account-name">{githubUser.login}</span>
                      <span className="account-status">Connected to GitHub</span>
                    </div>
                    <button className="disconnect-btn" onClick={disconnectGitHub}>
                      Disconnect
                    </button>
                  </div>
                )}

                {/* Device Flow Active - Show Code */}
                {deviceFlowActive && userCode && (
                  <div className="device-flow-active">
                    <div className="device-code-container">
                      <span className="device-code-label">Enter this code on GitHub:</span>
                      <div className="device-code">{userCode}</div>
                      <button
                        className="copy-code-btn"
                        onClick={() => navigator.clipboard.writeText(userCode)}
                      >
                        Copy Code
                      </button>
                    </div>
                    <div className="device-flow-info">
                      <div className="loading-spinner small"></div>
                      <span>Waiting for authorization...</span>
                    </div>
                    <a
                      className="verification-link"
                      onClick={() => window.electronAPI.openExternal(verificationUri)}
                    >
                      Open github.com/login/device
                    </a>
                    <button className="cancel-flow-btn" onClick={cancelDeviceFlow}>
                      Cancel
                    </button>
                  </div>
                )}

                {/* Not Connected - Show Login Button */}
                {!githubUser && !deviceFlowActive && (
                  <div className="github-login-section">
                    <button className="github-login-btn" onClick={startDeviceFlow}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                      Login with GitHub
                    </button>
                    <span className="login-hint">Opens browser for secure authentication</span>
                  </div>
                )}

                {deviceFlowError && (
                  <div className="device-flow-error">{deviceFlowError}</div>
                )}
              </>
            )}

            {/* GitLab - Token Input */}
            {accountProvider === 'gitlab' && (
              <>
                <div className="form-group">
                  <label>Personal Access Token</label>
                  <input
                    type="password"
                    className="dialog-input"
                    value={accountToken}
                    onChange={(e) => setAccountToken(e.target.value)}
                    placeholder="glpat-xxxxxxxxxxxx"
                  />
                  <span className="input-hint">
                    Generate at GitLab → Preferences → Access Tokens
                  </span>
                </div>
                <div className="dialog-buttons">
                  <button className="dialog-btn dialog-btn-cancel" onClick={() => setShowAccountModal(false)}>
                    Cancel
                  </button>
                  <button
                    className="dialog-btn dialog-btn-confirm"
                    onClick={fetchAccountRepos}
                    disabled={!accountToken || loadingRepos}
                  >
                    {loadingRepos ? 'Loading...' : 'Fetch Repos'}
                  </button>
                </div>
              </>
            )}

            {/* Repos List */}
            {accountRepos.length > 0 && (
              <div className="repos-list">
                <div className="repos-header">
                  Your Repositories
                  <span className="repos-count">{accountRepos.length}</span>
                </div>
                {accountRepos.map((repo, idx) => (
                  <div
                    key={idx}
                    className="repo-item"
                    onClick={() => selectRepoFromAccount(repo)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    </svg>
                    <span className="repo-name">{repo.name}</span>
                    {repo.private && <span className="repo-private">Private</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Firewall Rule Modal */}
      {showFirewallModal && (
        <div className="dialog-overlay" onClick={() => setShowFirewallModal(false)}>
          <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Add Firewall Rule</div>
            <div className="form-group">
              <label>Chain</label>
              <select
                className="dialog-input"
                value={newRule.chain}
                onChange={(e) => setNewRule(prev => ({ ...prev, chain: e.target.value }))}
              >
                <option value="INPUT">INPUT</option>
                <option value="OUTPUT">OUTPUT</option>
                <option value="FORWARD">FORWARD</option>
              </select>
            </div>
            <div className="form-group">
              <label>Protocol</label>
              <select
                className="dialog-input"
                value={newRule.protocol}
                onChange={(e) => setNewRule(prev => ({ ...prev, protocol: e.target.value }))}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="all">All</option>
              </select>
            </div>
            <div className="form-group">
              <label>Port (optional)</label>
              <input
                type="text"
                className="dialog-input"
                value={newRule.port}
                onChange={(e) => setNewRule(prev => ({ ...prev, port: e.target.value }))}
                placeholder="e.g., 80 or 8000:9000"
              />
            </div>
            <div className="form-group">
              <label>Source IP (optional)</label>
              <input
                type="text"
                className="dialog-input"
                value={newRule.source}
                onChange={(e) => setNewRule(prev => ({ ...prev, source: e.target.value }))}
                placeholder="e.g., 192.168.1.0/24"
              />
            </div>
            <div className="form-group">
              <label>Action</label>
              <select
                className="dialog-input"
                value={newRule.action}
                onChange={(e) => setNewRule(prev => ({ ...prev, action: e.target.value }))}
              >
                <option value="ACCEPT">ACCEPT</option>
                <option value="DROP">DROP</option>
                <option value="REJECT">REJECT</option>
              </select>
            </div>
            <div className="dialog-buttons">
              <button className="dialog-btn dialog-btn-cancel" onClick={() => setShowFirewallModal(false)}>
                Cancel
              </button>
              <button className="dialog-btn dialog-btn-confirm" onClick={addIptablesRule}>
                Add Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Process Details Modal */}
      {processModal && (
        <div className="dialog-overlay" onClick={() => setProcessModal(null)}>
          <div className="dialog-content dialog-wide process-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span>Top Processes by {processModal.type === 'cpu' ? 'CPU' : 'Memory'} Usage</span>
              <button className="modal-close" onClick={() => setProcessModal(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            {processLoading ? (
              <div className="widget-loading" style={{ padding: '40px' }}>Loading processes...</div>
            ) : (
              <div className="process-table">
                <div className="process-header">
                  <span className="col-pid">PID</span>
                  <span className="col-user">User</span>
                  <span className="col-cpu">CPU %</span>
                  <span className="col-mem">MEM %</span>
                  <span className="col-command">Command</span>
                  <span className="col-action">Action</span>
                </div>
                {processModal.processes.map((proc, idx) => (
                  <div key={idx} className="process-row">
                    <span className="col-pid">{proc.pid}</span>
                    <span className="col-user">{proc.user}</span>
                    <span className={`col-cpu ${parseFloat(proc.cpu) > 50 ? 'high' : ''}`}>{proc.cpu}%</span>
                    <span className={`col-mem ${parseFloat(proc.mem) > 50 ? 'high' : ''}`}>{proc.mem}%</span>
                    <span className="col-command" title={proc.command}>{proc.command}</span>
                    <span className="col-action">
                      <button
                        className="kill-btn"
                        onClick={() => killProcess(proc.pid)}
                        title="Kill process"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="dialog-footer">
              <button className="widget-btn" onClick={() => fetchTopProcesses(processModal.type)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="dashboard-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Widget Navigation */}
      <div className="widget-nav">
        <button
          className={`widget-nav-btn ${activeWidget === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveWidget('stats')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 20V10M12 20V4M6 20v-6"/>
          </svg>
          System
        </button>
        <button
          className={`widget-nav-btn ${activeWidget === 'packages' ? 'active' : ''}`}
          onClick={() => setActiveWidget('packages')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          Packages
        </button>
        <button
          className={`widget-nav-btn ${activeWidget === 'git' ? 'active' : ''}`}
          onClick={() => { setActiveWidget('git'); if (gitRepos.length === 0) scanGitRepos(); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="18" r="3"/>
            <circle cx="6" cy="6" r="3"/>
            <path d="M13 6h3a2 2 0 012 2v7M6 9v12"/>
          </svg>
          Git
        </button>
        <button
          className={`widget-nav-btn ${activeWidget === 'ports' ? 'active' : ''}`}
          onClick={() => { setActiveWidget('ports'); if (ports.length === 0) fetchPorts(); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
          Ports
        </button>
        <button
          className={`widget-nav-btn ${activeWidget === 'firewall' ? 'active' : ''}`}
          onClick={() => { setActiveWidget('firewall'); if (iptablesRules.length === 0) fetchIptables(); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Firewall
        </button>
      </div>

      {/* Widget Content */}
      <div className="widget-content">
        {/* System Stats Widget */}
        {activeWidget === 'stats' && (
          <div className="widget widget-stats">
            <div className="widget-header">
              <h3>System Statistics</h3>
              <button className="widget-refresh" onClick={fetchStats}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>
            {statsLoading ? (
              <div className="widget-loading">Loading stats...</div>
            ) : stats ? (
              <div className="stats-grid">
                <div className="stat-card clickable" onClick={() => fetchTopProcesses('cpu')} title="Click to view top CPU processes">
                  <div className="stat-icon cpu">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
                      <rect x="9" y="9" width="6" height="6"/>
                      <line x1="9" y1="1" x2="9" y2="4"/>
                      <line x1="15" y1="1" x2="15" y2="4"/>
                      <line x1="9" y1="20" x2="9" y2="23"/>
                      <line x1="15" y1="20" x2="15" y2="23"/>
                      <line x1="20" y1="9" x2="23" y2="9"/>
                      <line x1="20" y1="14" x2="23" y2="14"/>
                      <line x1="1" y1="9" x2="4" y2="9"/>
                      <line x1="1" y1="14" x2="4" y2="14"/>
                    </svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">CPU Usage</span>
                    <span className="stat-value">{stats.cpu.toFixed(1)}%</span>
                    <div className="stat-bar">
                      <div className="stat-bar-fill cpu" style={{ width: `${stats.cpu}%` }}></div>
                    </div>
                  </div>
                  <div className="stat-click-hint">Click for details</div>
                </div>

                <div className="stat-card clickable" onClick={() => fetchTopProcesses('memory')} title="Click to view top memory processes">
                  <div className="stat-icon memory">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="6" width="20" height="12" rx="2"/>
                      <line x1="6" y1="10" x2="6" y2="14"/>
                      <line x1="10" y1="10" x2="10" y2="14"/>
                      <line x1="14" y1="10" x2="14" y2="14"/>
                      <line x1="18" y1="10" x2="18" y2="14"/>
                    </svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Memory</span>
                    <span className="stat-value">{formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}</span>
                    <div className="stat-bar">
                      <div className="stat-bar-fill memory" style={{ width: `${stats.memory.percent}%` }}></div>
                    </div>
                  </div>
                  <div className="stat-click-hint">Click for details</div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon network">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                    </svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Network I/O</span>
                    <span className="stat-value">
                      <span className="rx">↓ {formatBytes(stats.network.rx)}</span>
                      <span className="tx">↑ {formatBytes(stats.network.tx)}</span>
                    </span>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon uptime">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Uptime</span>
                    <span className="stat-value">{stats.uptime}</span>
                  </div>
                </div>

                <div className="stat-card wide">
                  <div className="stat-icon load">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Load Average</span>
                    <span className="stat-value">
                      {stats.loadAvg[0].toFixed(2)} / {stats.loadAvg[1].toFixed(2)} / {stats.loadAvg[2].toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="widget-empty">Failed to load system stats</div>
            )}
          </div>
        )}

        {/* Package Installer Widget */}
        {activeWidget === 'packages' && (
          <div className="widget widget-packages">
            <div className="widget-header">
              <h3>Package Installer</h3>
              <div className="widget-actions">
                <button className="widget-btn" onClick={() => {
                  setEditingPackage({
                    id: uuidv4(),
                    name: '',
                    description: '',
                    installCommand: '',
                    checkCommand: '',
                    category: 'custom',
                  });
                  setShowPackageModal(true);
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add
                </button>
                <button className="widget-btn" onClick={checkAllPackages}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                  </svg>
                  Refresh
                </button>
              </div>
            </div>

            <div className="packages-grid">
              {['container', 'runtime', 'tool', 'custom'].map(category => {
                const categoryPackages = packages.filter(p => p.category === category);
                if (categoryPackages.length === 0) return null;
                return (
                  <div key={category} className="package-category">
                    <h4 className="category-title">{category.charAt(0).toUpperCase() + category.slice(1)}s</h4>
                    <div className="package-list">
                      {categoryPackages.map(pkg => {
                        const status = packageStatuses[pkg.id] || 'checking';
                        return (
                          <div key={pkg.id} className={`package-card ${status}`}>
                            <div className="package-icon">{getPackageIcon(pkg.icon)}</div>
                            <div className="package-info">
                              <span className="package-name">{pkg.name}</span>
                              <span className="package-desc">{pkg.description}</span>
                            </div>
                            <div className="package-status">
                              {status === 'checking' && <span className="status-checking">Checking...</span>}
                              {status === 'installed' && <span className="status-installed">Installed</span>}
                              {status === 'not-installed' && <span className="status-not-installed">Not Installed</span>}
                              {status === 'installing' && <span className="status-installing">Installing...</span>}
                            </div>
                            <div className="package-actions">
                              {status === 'not-installed' && (
                                <button className="pkg-btn install" onClick={() => installPackage(pkg)} title="Install">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                  </svg>
                                </button>
                              )}
                              <button className="pkg-btn edit" onClick={() => { setEditingPackage(pkg); setShowPackageModal(true); }} title="Edit">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                              {pkg.category === 'custom' && (
                                <button className="pkg-btn delete" onClick={() => deletePackageShortcut(pkg.id)} title="Delete">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {installOutput && (
              <div className="install-output">
                <div className="output-header">
                  <span>Output</span>
                  <button onClick={() => setInstallOutput('')}>Clear</button>
                </div>
                <pre>{installOutput}</pre>
              </div>
            )}
          </div>
        )}

        {/* Git Widget */}
        {activeWidget === 'git' && (
          <div className="widget widget-git">
            <div className="widget-header">
              <h3>Git Repositories</h3>
              <div className="widget-actions">
                <button className="widget-btn" onClick={() => setShowGitModal(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Clone
                </button>
                <button className="widget-btn" onClick={() => {
                  setInputValue('~');
                  setInputDialog({
                    isOpen: true,
                    title: 'Enter search path:',
                    defaultValue: '~',
                    onConfirm: (path) => scanGitRepos(path),
                  });
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  Scan
                </button>
              </div>
            </div>

            {gitLoading ? (
              <div className="widget-loading">Scanning repositories...</div>
            ) : gitRepos.length > 0 ? (
              <div className="git-list">
                {gitRepos.map((repo, idx) => (
                  <div key={idx} className={`git-card ${repo.hasChanges ? 'modified' : 'clean'}`}>
                    <div className="git-icon">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187"/>
                      </svg>
                    </div>
                    <div className="git-info">
                      <span className="git-path">{repo.path}</span>
                      <div className="git-meta">
                        <span className="git-branch">{repo.branch}</span>
                        <span className={`git-status ${repo.hasChanges ? 'modified' : 'clean'}`}>
                          {repo.hasChanges ? 'Modified' : 'Clean'}
                        </span>
                      </div>
                    </div>
                    <div className="git-actions">
                      <button className="git-btn" onClick={() => gitPull(repo.path)} title="Pull">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="7 13 12 18 17 13"/>
                          <line x1="12" y1="18" x2="12" y2="6"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="widget-empty">
                <p>No repositories found</p>
                <p className="hint">Click "Scan" to search for git repositories</p>
              </div>
            )}

            {installOutput && (
              <div className="install-output">
                <div className="output-header">
                  <span>Output</span>
                  <button onClick={() => setInstallOutput('')}>Clear</button>
                </div>
                <pre>{installOutput}</pre>
              </div>
            )}
          </div>
        )}

        {/* Ports Widget */}
        {activeWidget === 'ports' && (
          <div className="widget widget-ports">
            <div className="widget-header">
              <h3>Open Ports</h3>
              <button className="widget-refresh" onClick={fetchPorts}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>

            {portsLoading ? (
              <div className="widget-loading">Loading ports...</div>
            ) : ports.length > 0 ? (
              <div className="ports-table">
                <div className="ports-header">
                  <span>Proto</span>
                  <span>Port</span>
                  <span>Address</span>
                  <span>Process</span>
                  <span>PID</span>
                  <span>Action</span>
                </div>
                {ports.map((port, idx) => (
                  <div key={idx} className="port-row">
                    <span className="port-proto">{port.protocol.toUpperCase()}</span>
                    <span className="port-number">{port.port}</span>
                    <span className="port-addr">{port.address}</span>
                    <span className="port-process">{port.process || '-'}</span>
                    <span className="port-pid">{port.pid || '-'}</span>
                    <span className="port-action">
                      {port.pid && (
                        <button className="kill-btn" onClick={() => killPort(port)} title="Kill process">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="widget-empty">No open ports found</div>
            )}
          </div>
        )}

        {/* Firewall Widget */}
        {activeWidget === 'firewall' && (
          <div className="widget widget-firewall">
            <div className="widget-header">
              <h3>Firewall (iptables)</h3>
              <div className="widget-actions">
                <button className="widget-btn" onClick={() => setShowFirewallModal(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Rule
                </button>
                <button className="widget-refresh" onClick={fetchIptables}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                  </svg>
                </button>
              </div>
            </div>

            {firewallLoading ? (
              <div className="widget-loading">Loading firewall rules...</div>
            ) : iptablesRules.length > 0 ? (
              <div className="firewall-table">
                <div className="firewall-header">
                  <span>#</span>
                  <span>Chain</span>
                  <span>Target</span>
                  <span>Proto</span>
                  <span>Source</span>
                  <span>Dest</span>
                  <span>Options</span>
                  <span>Action</span>
                </div>
                {iptablesRules.map((rule, idx) => (
                  <div key={idx} className={`firewall-row ${rule.target.toLowerCase()}`}>
                    <span className="fw-num">{rule.num}</span>
                    <span className="fw-chain">{rule.chain}</span>
                    <span className={`fw-target ${rule.target.toLowerCase()}`}>{rule.target}</span>
                    <span className="fw-proto">{rule.protocol}</span>
                    <span className="fw-source">{rule.source}</span>
                    <span className="fw-dest">{rule.destination}</span>
                    <span className="fw-opts">{rule.options || '-'}</span>
                    <span className="fw-action">
                      <button className="delete-btn" onClick={() => deleteIptablesRule(rule)} title="Delete rule">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="widget-empty">No iptables rules found (or no permission)</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
