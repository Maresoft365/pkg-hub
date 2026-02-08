const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.log('未安装 better-sqlite3，使用内置数据存储');
}

let mainWindow;
let db;
let appDataPath;
let configPath;

// 默认配置
let appConfig = {
  theme: 'dark',
  downloadSource: 'winget',
  sources: [
    { id: 'winget', name: '官方源', priority: 1, enabled: true },
    { id: 'msstore', name: '微软商店源', priority: 2, enabled: false },
  ],
  batchSize: 3,
  autoCheckUpdates: true,
  enableSounds: false,
  enableSearchSuggestions: true,
  showSourceSwitcher: true,
  categorySearchLimit: 40,
  silentInstall: true,
  installNotifications: true,
  autoSource: false,
  shortcuts: {
    search: 'Ctrl+F',
    install: 'Ctrl+I',
    settings: 'Ctrl+,',
    quit: 'Ctrl+Q'
  }
};

const categoryKeywords = {
  'popular': ['browser', 'editor', 'media', 'tool', 'utility', 'office', 'security', 'network'],
  'browser': ['browser', 'web browser', 'chrome', 'firefox', 'edge', 'opera', 'brave', 'vivaldi', 'safari', 'tor'],
  'dev': ['editor', 'IDE', 'development', 'git', 'python', 'code', 'java', 'javascript', 'cpp', 'c++', 'node', 'php', 'ruby', 'go', 'rust', 'android', 'ios', 'flutter', 'react', 'vue'],
  'chinese': ['wechat', 'qq', 'baidu', 'tencent', 'netease', 'wps', 'youku', 'iqiyi', 'bilibili', 'alibaba', 'taobao', 'alipay', 'sogou', '360', 'kingsoft', 'xunlei', 'thunder'],
  'media': ['player', 'media', 'music', 'video', 'audio', 'vlc', 'spotify', 'youtube', 'netflix', 'itunes', 'kodi', 'mp3', 'mp4', 'streaming', 'recorder', 'converter'],
  'game': ['game', 'steam', 'platform', 'gaming', 'epic', 'ubisoft', 'origin', 'battle.net', 'minecraft', 'roblox', 'fortnite', 'gog', 'emulator', 'nintendo', 'playstation', 'xbox'],
  'tools': ['tool', 'utility', 'zip', 'pdf', 'security', 'antivirus', 'firewall', 'cleaner', 'optimizer', 'backup', 'recovery', 'partition', 'disk', 'monitor', 'diagnostic', 'remote', 'vpn'],
  'office': ['office', 'word', 'excel', 'powerpoint', 'outlook', 'onenote', 'wps', 'libreoffice', 'openoffice', 'pdf', 'editor', 'presentation', 'spreadsheet', 'document'],
  'design': ['design', 'photo', 'graphic', 'adobe', 'photoshop', 'illustrator', 'premiere', 'after effects', 'figma', 'sketch', 'blender', 'maya', '3d', 'vector', 'animation'],
  'network': ['network', 'vpn', 'proxy', 'remote', 'teamviewer', 'anydesk', 'ftp', 'ssh', 'telnet', 'bittorrent', 'torrent', 'download', 'accelerator'],
  'education': ['education', 'learn', 'language', 'math', 'science', 'chemistry', 'physics', '地理', 'history', 'dictionary', 'translate', 'calculator', 'simulation']
};

const popularAppsCache = {
  apps: null,
  lastUpdated: 0,
  cacheDuration: 300000,
  
  get: function() {
    if (this.apps && Date.now() - this.lastUpdated < this.cacheDuration) {
      return this.apps;
    }
    return null;
  },
  
  set: function(apps) {
    this.apps = apps;
    this.lastUpdated = Date.now();
  },
  
  clear: function() {
    this.apps = null;
    this.lastUpdated = 0;
  }
};

const categoryCache = {
  cache: new Map(),
  cacheDuration: 600000,
  
  get: function(category) {
    const cached = this.cache.get(category);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.cacheDuration) {
      this.cache.delete(category);
      return null;
    }
    
    return cached.apps;
  },
  
  set: function(category, apps) {
    this.cache.set(category, {
      apps,
      timestamp: Date.now()
    });
  },
  
  clear: function() {
    this.cache.clear();
  }
};

const sourceMonitor = {
  speeds: new Map(),
  lastTested: new Map(),
  
  testSourceSpeed: async function(sourceId) {
    try {
      const startTime = Date.now();
      await this.execSimpleCommand('--version', { source: sourceId, retryOnFail: false });
      const speed = Date.now() - startTime;
      
      this.speeds.set(sourceId, speed);
      this.lastTested.set(sourceId, Date.now());
      
      return { success: true, speed, rating: this.getSpeedRating(speed) };
    } catch (error) {
      this.speeds.set(sourceId, Infinity);
      return { success: false, error: error.message };
    }
  },
  
  getSpeedRating: function(speed) {
    if (speed < 2000) return { level: 'excellent', text: '极快', color: '#107C10' };
    if (speed < 5000) return { level: 'good', text: '快速', color: '#0078D7' };
    if (speed < 10000) return { level: 'medium', text: '一般', color: '#FF8C00' };
    return { level: 'slow', text: '较慢', color: '#FF4343' };
  },
  
  getOptimalSource: function() {
    const enabledSources = appConfig.sources.filter(s => s.enabled);
    if (enabledSources.length === 0) return 'winget';
    
    if (appConfig.autoSource) {
      let bestSource = 'winget';
      let bestSpeed = Infinity;
      
      for (const source of enabledSources) {
        const speed = this.speeds.get(source.id) || Infinity;
        if (speed < bestSpeed) {
          bestSpeed = speed;
          bestSource = source.id;
        }
      }
      
      const lastTest = this.lastTested.get(bestSource) || 0;
      if (Date.now() - lastTest > 300000) {
        this.testSourceSpeed(bestSource);
      }
      
      return bestSource;
    }
    
    return appConfig.downloadSource;
  },
  
  getSourceStatus: function(sourceId) {
    const speed = this.speeds.get(sourceId);
    const lastTest = this.lastTested.get(sourceId);
    
    if (!speed || !lastTest) {
      return { tested: false, status: 'unknown' };
    }
    
    const rating = this.getSpeedRating(speed);
    const timeSinceTest = Date.now() - lastTest;
    
    return {
      tested: true,
      speed,
      rating,
      lastTest,
      timeSinceTest,
      status: timeSinceTest > 600000 ? 'stale' : 'fresh'
    };
  },
  
  execSimpleCommand: function(command, options = {}) {
    return new Promise((resolve, reject) => {
      const source = options.source || 'winget';
      let fullCommand = `winget ${command}`;
      
      if (source === 'msstore' && command.includes('search')) {
        fullCommand = `winget --source msstore ${command}`;
      }
      
      console.log('[WINGET-SIMPLE] 执行命令:', fullCommand);
      
      const execOptions = {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'buffer',
        shell: true,
        timeout: 10000
      };
      
      exec(fullCommand, execOptions, (error, stdout, stderr) => {
        if (error) {
          const errorMsg = decodeBuffer(stderr || Buffer.from(''));
          console.error('[WINGET-SIMPLE] 命令失败:', error.code, errorMsg);
          reject({ code: error.code, message: errorMsg });
          return;
        }
        
        const output = decodeBuffer(stdout);
        resolve(output);
      });
    });
  }
};

const suggestionCache = {
  cache: new Map(),
  maxCacheSize: 100,
  maxCacheAge: 3600000,
  
  get: function(query) {
    const cached = this.cache.get(query.toLowerCase());
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.maxCacheAge) {
      this.cache.delete(query.toLowerCase());
      return null;
    }
    
    return cached.suggestions;
  },
  
  set: function(query, suggestions) {
    this.cache.set(query.toLowerCase(), {
      suggestions,
      timestamp: Date.now()
    });
    
    this.cleanup();
  },
  
  cleanup: function() {
    if (this.cache.size > this.maxCacheSize) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toDelete = entries.slice(0, Math.floor(this.maxCacheSize * 0.2));
      for (const [key] of toDelete) {
        this.cache.delete(key);
      }
    }
  }
};

// ============ 新增：检查管理员权限的函数 ============
function checkAdminPrivileges() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(true);
      return;
    }
    
    // 尝试执行需要管理员权限的命令
    const command = 'net session >nul 2>&1';
    
    exec(command, { shell: true }, (error) => {
      if (error) {
        // 错误代码 5 表示访问被拒绝（无管理员权限）
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// ============ 新增：显示管理员权限提示 ============
function showAdminPrompt(appId, appName) {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve(false);
      return;
    }
    
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '需要管理员权限',
      message: `安装 ${appName} 需要管理员权限`,
      detail: `您需要以管理员身份运行 PkgHub 才能安装此软件。\n\n请以管理员身份重新启动 PkgHub。`,
      buttons: ['以管理员身份重启', '取消'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        // 尝试以管理员身份重启
        restartAsAdmin();
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

// ============ 新增：以管理员身份重启应用 ============
function restartAsAdmin() {
  try {
    const appPath = process.execPath;
    const args = process.argv.slice(1);
    
    // 使用 runas 命令以管理员身份运行
    const command = `powershell -Command "Start-Process '${appPath}' -ArgumentList '${args.join(' ')}' -Verb RunAs"`;
    
    exec(command, (error) => {
      if (error) {
        console.error('重启失败:', error);
        dialog.showErrorBox('重启失败', '无法以管理员身份重启应用，请手动以管理员身份运行。');
      } else {
        // 关闭当前应用
        setTimeout(() => app.quit(), 1000);
      }
    });
  } catch (error) {
    console.error('重启失败:', error);
    dialog.showErrorBox('重启失败', '无法以管理员身份重启应用，请手动以管理员身份运行。');
  }
}

function initApp() {
  appDataPath = path.join(app.getPath('userData'), 'winget-plus');
  configPath = path.join(appDataPath, 'config.json');
  
  if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
    fs.mkdirSync(path.join(appDataPath, 'cache'), { recursive: true });
  }
  
  loadConfig();
  initDatabase();
  createDefaultSources();
  initSourceMonitor();
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const savedConfig = JSON.parse(configData);
      
      appConfig = {
        ...appConfig,
        ...savedConfig,
        sources: savedConfig.sources || appConfig.sources,
        shortcuts: { ...appConfig.shortcuts, ...(savedConfig.shortcuts || {}) }
      };
      
      console.log('[CONFIG] 配置文件加载成功:', appConfig);
    }
  } catch (error) {
    console.error('[CONFIG] 加载配置文件失败:', error);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2), 'utf8');
    console.log('[CONFIG] 配置文件保存成功');
  } catch (error) {
    console.error('[CONFIG] 保存配置文件失败:', error);
  }
}

function initDatabase() {
  if (!Database) return;
  
  try {
    const dbPath = path.join(appDataPath, 'winget-plus.db');
    db = new Database(dbPath);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS installed_apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        version TEXT,
        install_date TEXT,
        source TEXT,
        size TEXT,
        UNIQUE(app_id)
      );
      
      CREATE TABLE IF NOT EXISTS app_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        rating REAL DEFAULT 0,
        download_count INTEGER DEFAULT 0,
        last_updated TEXT,
        metadata TEXT,
        UNIQUE(app_id)
      );
      
      CREATE TABLE IF NOT EXISTS search_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        app_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        match_type TEXT,
        search_count INTEGER DEFAULT 1,
        last_searched TEXT,
        UNIQUE(query, app_id)
      );
      
      CREATE TABLE IF NOT EXISTS category_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        app_data TEXT NOT NULL,
        cached_at TEXT,
        UNIQUE(category)
      );
      
      CREATE TABLE IF NOT EXISTS source_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        speed_ms INTEGER,
        success BOOLEAN DEFAULT 1,
        test_time TEXT,
        error_message TEXT
      );
      
      CREATE TABLE IF NOT EXISTS app_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stat_key TEXT NOT NULL,
        stat_value TEXT,
        last_updated TEXT,
        UNIQUE(stat_key)
      );
      
      CREATE INDEX IF NOT EXISTS idx_search_query ON search_suggestions(query);
      CREATE INDEX IF NOT EXISTS idx_category ON category_cache(category);
      CREATE INDEX IF NOT EXISTS idx_source_stats ON source_stats(source_id, test_time);
    `);
    
    console.log('[DATABASE] 数据库初始化成功');
  } catch (error) {
    console.error('[DATABASE] 数据库初始化失败:', error);
  }
}

function createDefaultSources() {
  const sourcesFile = path.join(appDataPath, 'sources.json');
  if (!fs.existsSync(sourcesFile)) {
    const defaultSources = {
      sources: [
        {
          id: 'winget',
          name: 'Windows Package Manager',
          url: 'https://winget.azureedge.net/cache',
          type: 'official',
          priority: 1,
          enabled: true,
          description: '微软官方软件源'
        }
      ],
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(sourcesFile, JSON.stringify(defaultSources, null, 2), 'utf8');
  }
}

function initSourceMonitor() {
  if (db) {
    try {
      const recentTests = db.prepare(`
        SELECT source_id, speed_ms, test_time 
        FROM source_stats 
        WHERE success = 1 
        ORDER BY test_time DESC 
        LIMIT 10
      `).all();
      
      for (const test of recentTests) {
        sourceMonitor.speeds.set(test.source_id, test.speed_ms);
        sourceMonitor.lastTested.set(test.source_id, new Date(test.test_time).getTime());
      }
    } catch (error) {
      console.error('[MONITOR] 加载测速历史失败:', error);
    }
  }
}

function decodeBuffer(buffer) {
  try {
    return buffer.toString('utf8');
  } catch (e) {
    try {
      const decoder = new TextDecoder('gbk');
      return decoder.decode(buffer);
    } catch (e2) {
      return buffer.toString('latin1');
    }
  }
}

function getOptimalSource() {
  return sourceMonitor.getOptimalSource();
}

function parseWingetSearchOutput(output) {
  if (!output || output.trim().length === 0) {
    return [];
  }
  
  const lines = output.split('\n');
  const results = [];
  let skipHeader = true;
  let headers = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.includes('---') || trimmed.includes('名称') || trimmed.includes('Name')) {
      skipHeader = false;
      continue;
    }
    
    if (skipHeader && (trimmed.includes('名称') || trimmed.includes('Name') || trimmed.includes('Id'))) {
      headers = trimmed.split(/\s{2,}/).map(h => h.trim());
      skipHeader = false;
      continue;
    }
    
    if (skipHeader) {
      skipHeader = false;
      continue;
    }
    
    const separators = [/\s{2,}/, /\t+/];
    let parts = [];
    
    for (const separator of separators) {
      parts = trimmed.split(separator).filter(p => p && p.trim());
      if (parts.length >= 2) break;
    }
    
    if (parts.length >= 2) {
      const result = {
        name: parts[0] || '',
        id: parts[1] || '',
        version: parts[2] || '',
        source: parts[3] || 'winget'
      };
      
      if (result.name && result.id && !result.id.includes('---') && !result.name.includes('---')) {
        const existingIndex = results.findIndex(r => r.id === result.id);
        if (existingIndex === -1) {
          results.push(result);
        }
      }
    }
  }
  
  return results;
}

async function execWingetSearch(query, options = {}) {
  try {
    const limit = options.limit || appConfig.categorySearchLimit || 30;
    const command = `winget search "${query}"`;
    
    console.log('[CATEGORY-SEARCH] 搜索分类:', query, '限制:', limit);
    
    const output = await execWingetCommandSafe(command, options);
    const apps = parseWingetSearchOutput(output);
    
    return apps.slice(0, limit);
  } catch (error) {
    console.error('[CATEGORY-SEARCH] 搜索失败:', error);
    return [];
  }
}

function execWingetCommandSafe(command, options = {}) {
  return new Promise((resolve, reject) => {
    let safeCommand = command;
    
    if (command.includes('search')) {
      const match = command.match(/search "([^"]+)"/);
      if (match) {
        const searchTerm = match[1];
        safeCommand = `winget search "${searchTerm}"`;
      }
    }
    
    console.log('[WINGET-SAFE] 执行命令:', safeCommand);
    
    const execOptions = {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'buffer',
      shell: true,
      timeout: 30000
    };
    
    const child = exec(safeCommand, execOptions, (error, stdout, stderr) => {
      if (error) {
        const errorMsg = decodeBuffer(stderr || Buffer.from(''));
        console.error('[WINGET-SAFE] 命令失败 - 错误码:', error.code, '消息:', errorMsg);
        
        if (error.code === 2316632066) {
          console.error('[ERROR-2316632066] Winget参数错误或网络问题');
          
          if (command.includes('search')) {
            const searchTerm = command.match(/search "([^"]+)"/)?.[1];
            if (searchTerm) {
              console.log('[RETRY] 尝试简单搜索命令...');
              execWingetCommandSafe(`winget search ${searchTerm}`, { ...options, retry: false })
                .then(resolve)
                .catch(reject);
              return;
            }
          }
        }
        
        reject({ code: error.code, message: errorMsg || 'Winget命令执行失败' });
        return;
      }
      
      const output = decodeBuffer(stdout);
      
      if (!output || output.trim().length === 0) {
        console.log('[WINGET-SAFE] 命令执行成功但无输出');
        resolve('');
        return;
      }
      
      console.log('[WINGET-SAFE] 命令成功，输出长度:', output.length);
      resolve(output);
    });
    
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        reject({ code: 'TIMEOUT', message: '命令执行超时' });
      }
    }, execOptions.timeout);
  });
}

function execWingetCommand(command, options = {}) {
  return execWingetCommandSafe(command, options);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.ico'),
    frame: true,
    backgroundColor: appConfig.theme === 'dark' ? '#1C1C1C' : '#FFFFFF',
    show: false,
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('winget-status', { ok: true });
    // 发送当前配置到前端
    mainWindow.webContents.send('settings-updated', appConfig);
  });
}

function showNotification(type, title, message) {
  if (!mainWindow) return;
  
  const iconType = {
    'info': 'info',
    'warning': 'warning',
    'error': 'error'
  }[type] || 'info';
  
  dialog.showMessageBox(mainWindow, {
    type: iconType,
    title: title,
    message: title,
    detail: message,
    buttons: ['确定'],
    noLink: true
  });
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 PkgHub',
    message: 'PkgHub',
    detail: `版本: ${app.getVersion()}\n基于 Electron 19\n兼容 Windows 7/8/10/11`,
    buttons: ['确定']
  });
}

function getFallbackCategoryApps(category) {
  const fallbackCategories = {
    'popular': [
      { id: 'Microsoft.Edge', name: 'Microsoft Edge', version: '最新', source: 'winget' },
      { id: 'Google.Chrome', name: 'Google Chrome', version: '最新', source: 'winget' },
      { id: 'Mozilla.Firefox', name: 'Mozilla Firefox', version: '最新', source: 'winget' },
      { id: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code', version: '最新', source: 'winget' },
      { id: '7zip.7zip', name: '7-Zip', version: '最新', source: 'winget' },
      { id: 'VideoLAN.VLC', name: 'VLC Media Player', version: '最新', source: 'winget' },
      { id: 'Spotify.Spotify', name: 'Spotify', version: '最新', source: 'winget' },
      { id: 'Git.Git', name: 'Git', version: '最新', source: 'winget' },
      { id: 'Adobe.Acrobat.Reader.64-bit', name: 'Adobe Reader', version: '最新', source: 'winget' },
      { id: 'WinRAR.WinRAR', name: 'WinRAR', version: '最新', source: 'winget' },
      { id: 'TeamViewer.TeamViewer', name: 'TeamViewer', version: '最新', source: 'winget' },
      { id: 'Valve.Steam', name: 'Steam', version: '最新', source: 'winget' },
      { id: 'Python.Python.3', name: 'Python 3', version: '最新', source: 'winget' },
      { id: 'Oracle.JavaRuntimeEnvironment', name: 'Java Runtime', version: '最新', source: 'winget' }
    ],
    'browser': [
      { id: 'Microsoft.Edge', name: 'Microsoft Edge', version: '最新', source: 'winget' },
      { id: 'Google.Chrome', name: 'Google Chrome', version: '最新', source: 'winget' },
      { id: 'Mozilla.Firefox', name: 'Mozilla Firefox', version: '最新', source: 'winget' },
      { id: 'Opera.Opera', name: 'Opera', version: '最新', source: 'winget' },
      { id: 'Brave.Brave', name: 'Brave', version: '最新', source: 'winget' },
      { id: 'VivaldiTechnologies.Vivaldi', name: 'Vivaldi', version: '最新', source: 'winget' },
      { id: 'TorProject.TorBrowser', name: 'Tor Browser', version: '最新', source: 'winget' }
    ],
    'dev': [
      { id: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code', version: '最新', source: 'winget' },
      { id: 'Git.Git', name: 'Git', version: '最新', source: 'winget' },
      { id: 'Python.Python.3', name: 'Python 3', version: '最新', source: 'winget' },
      { id: 'Microsoft.VisualStudio.2022.Community', name: 'Visual Studio 2022', version: '最新', source: 'winget' },
      { id: 'JetBrains.IntelliJIDEA.Community', name: 'IntelliJ IDEA', version: '最新', source: 'winget' },
      { id: 'Node.js', name: 'Node.js', version: '最新', source: 'winget' },
      { id: 'Oracle.JavaRuntimeEnvironment', name: 'Java Runtime', version: '最新', source: 'winget' }
    ],
    'chinese': [
      { id: 'Tencent.WeChat', name: '微信', version: '最新', source: 'winget' },
      { id: 'Tencent.QQ', name: 'QQ', version: '最新', source: 'winget' },
      { id: 'Baidu.BaiduNetdisk', name: '百度网盘', version: '最新', source: 'winget' },
      { id: 'Kingsoft.WPSOffice', name: 'WPS Office', version: '最新', source: 'winget' },
      { id: 'Sogou.SogouInput', name: '搜狗输入法', version: '最新', source: 'winget' },
      { id: 'Bilibili.Bilibili', name: '哔哩哔哩', version: '最新', source: 'winget' }
    ],
    'media': [
      { id: 'VideoLAN.VLC', name: 'VLC Media Player', version: '最新', source: 'winget' },
      { id: 'Spotify.Spotify', name: 'Spotify', version: '最新', source: 'winget' },
      { id: '7zip.7zip', name: '7-Zip', version: '最新', source: 'winget' },
      { id: 'IrfanSkiljan.IrfanView', name: 'IrfanView', version: '最新', source: 'winget' },
      { id: 'Audacity.Audacity', name: 'Audacity', version: '最新', source: 'winget' },
      { id: 'KodiFoundation.Kodi', name: 'Kodi', version: 'latest', source: 'winget' }
    ],
    'game': [
      { id: 'Valve.Steam', name: 'Steam', version: '最新', source: 'winget' },
      { id: 'EpicGames.EpicGamesLauncher', name: 'Epic Games', version: '最新', source: 'winget' },
      { id: 'Ubisoft.Connect', name: 'Ubisoft Connect', version: '最新', source: 'winget' },
      { id: 'ElectronicArts.EADesktop', name: 'EA Desktop', version: '最新', source: 'winget' },
      { id: 'Mojang.MinecraftLauncher', name: 'Minecraft', version: '最新', source: 'winget' },
      { id: 'GOG.Galaxy', name: 'GOG Galaxy', version: '最新', source: 'winget' }
    ]
  };
  
  return fallbackCategories[category] || fallbackCategories['popular'];
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

// ============ 修复的安装函数 ============

// 检查是否为MS Store应用ID
function isMsStoreAppId(appId) {
  // MS Store应用ID格式：纯字母数字，9-12个字符
  return /^[A-Z0-9]{9,12}$/i.test(appId);
}

// ============ 安装应用的主函数 - 修复版本 ============
ipcMain.handle('install-app', async (event, appId, appName) => {
  console.log('[INSTALL] 开始安装:', appId, appName);
  
  // 检查appId是否有效
  if (!appId || appId === 'Unknown' || appId === '') {
    const errorMsg = '无效的应用ID: ' + appId;
    console.error('[INSTALL]', errorMsg);
    
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('install-progress', {
        appId,
        status: 'failed',
        message: errorMsg
      });
    }
    
    return { 
      success: false, 
      error: errorMsg
    };
  }
  
  // 发送开始安装状态
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('install-progress', {
      appId,
      status: 'started',
      message: `开始安装 ${appName}...`
    });
  }
  
  try {
    // 检查管理员权限
    const isAdmin = await checkAdminPrivileges();
    if (!isAdmin) {
      console.log('[INSTALL] 无管理员权限，提示用户');
      
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('install-progress', {
          appId,
          status: 'failed',
          message: '需要管理员权限，请以管理员身份运行 PkgHub'
        });
      }
      
      // 显示管理员权限提示
      const restartConfirmed = await showAdminPrompt(appId, appName);
      
      return { 
        success: false, 
        error: '需要管理员权限',
        requiresAdmin: true,
        restartConfirmed
      };
    }
    
    // 判断是否为MS Store应用
    const isMsStore = isMsStoreAppId(appId);
    const source = isMsStore ? 'msstore' : 'winget';
    
    console.log(`[INSTALL] 应用类型: ${isMsStore ? 'MS Store应用' : '普通应用'}`);
    console.log(`[INSTALL] 使用源: ${source}`);
    
    // 构建winget命令
    const args = [
      'install',
      '--id',
      appId,
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--silent'  // 总是使用静默模式
    ];
    
    // 如果是MS Store应用，添加源参数
    if (isMsStore) {
      args.push('--source', 'msstore');
    }
    
    const command = `winget ${args.join(' ')}`;
    console.log('[INSTALL] 执行命令:', command);
    
    // 直接执行winget命令
    const result = await execWingetInstall(command, appId, appName, source);
    
    // 更新安装状态
    if (mainWindow && mainWindow.webContents) {
      if (result.success) {
        mainWindow.webContents.send('install-progress', {
          appId,
          status: 'completed',
          message: '安装成功！'
        });
        
        // 记录到数据库
        if (db) {
          try {
            db.prepare(`
              INSERT OR REPLACE INTO installed_apps (app_id, app_name, install_date, source)
              VALUES (?, ?, datetime('now'), ?)
            `).run(appId, appName, source);
          } catch (dbError) {
            console.error('[INSTALL] 保存安装记录失败:', dbError);
          }
        }
      } else {
        mainWindow.webContents.send('install-progress', {
          appId,
          status: 'failed',
          message: result.error || '安装失败'
        });
      }
    }
    
    return result;
    
  } catch (error) {
    console.error('[INSTALL] 安装过程出错:', error);
    
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('install-progress', {
        appId,
        status: 'failed',
        message: error.message || '安装过程出错'
      });
    }
    
    return {
      success: false,
      error: error.message || '安装过程出错'
    };
  }
});

// ============ 执行winget安装命令 - 修复版本 ============
function execWingetInstall(command, appId, appName, source) {
  return new Promise((resolve) => {
    console.log('[WINGET-INSTALL] 执行安装:', command);
    
    const child = exec(command, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'buffer',
      shell: true,
      timeout: 300000 // 5分钟超时
    }, (error, stdout, stderr) => {
      const stdoutStr = decodeBuffer(stdout || Buffer.from(''));
      const stderrStr = decodeBuffer(stderr || Buffer.from(''));
      
      console.log(`[WINGET-INSTALL] 退出码: ${error ? error.code : 0}`);
      console.log(`[WINGET-INSTALL] stdout:`, stdoutStr.substring(0, 500));
      console.log(`[WINGET-INSTALL] stderr:`, stderrStr);
      
      if (error) {
        // 安装失败
        let userFriendlyError = `安装失败，退出码: ${error.code}`;
        
        if (error.code === 2147943458 || stderrStr.includes('requires elevation') || stderrStr.includes('需要提升权限')) {
          userFriendlyError = '需要管理员权限，请以管理员身份运行 PkgHub';
        } else if (stderrStr.includes('No installed package found matching input criteria')) {
          userFriendlyError = '找不到匹配的软件包';
        } else if (stderrStr.includes('Multiple packages found matching input criteria')) {
          userFriendlyError = '找到多个匹配的软件包';
        } else if (stderrStr.includes('requires admin')) {
          userFriendlyError = '该软件需要管理员权限才能安装';
        }
        
        resolve({
          success: false,
          source: source,
          exitCode: error.code,
          error: userFriendlyError,
          stdout: stdoutStr,
          stderr: stderrStr
        });
      } else {
        // 安装成功
        console.log(`[WINGET-INSTALL] ${appName} 安装成功!`);
        
        // 对于MS Store应用，直接认为是成功（因为验证可能失败）
        if (isMsStoreAppId(appId)) {
          console.log('[WINGET-INSTALL] MS Store应用，返回成功');
          resolve({
            success: true,
            source: source,
            exitCode: 0,
            isMsStore: true,
            note: 'MS Store应用可能不会出现在winget列表中'
          });
        } else {
          // 验证普通应用安装
          setTimeout(() => {
            verifyNormalInstallation(appId).then(isInstalled => {
              if (isInstalled) {
                resolve({
                  success: true,
                  source: source,
                  exitCode: 0,
                  verified: true
                });
              } else {
                resolve({
                  success: false,
                  source: source,
                  exitCode: 0,
                  error: '安装显示成功，但软件未正确安装。请手动检查。',
                  note: '可能需要重启计算机或手动安装'
                });
              }
            });
          }, 3000);
        }
      }
    });
  });
}

// 验证普通应用安装
function verifyNormalInstallation(appId) {
  return new Promise((resolve) => {
    // 尝试多种验证方式
    const commands = [
      `winget list --id "${appId}"`,
      `winget list | findstr /i "${appId.split('.')[0]}"`,
      `winget list | findstr /i "${appId.split('.')[1] || ''}"`
    ];
    
    let checkIndex = 0;
    
    function tryNextCommand() {
      if (checkIndex >= commands.length) {
        console.log('[VERIFY] 所有验证方式都失败');
        resolve(false);
        return;
      }
      
      const command = commands[checkIndex];
      console.log('[VERIFY] 尝试验证:', command);
      
      exec(command, {
        windowsHide: true,
        shell: true,
        timeout: 10000
      }, (error, stdout) => {
        if (!error && stdout && stdout.toString().trim().length > 0) {
          console.log('[VERIFY] 验证成功');
          resolve(true);
        } else {
          checkIndex++;
          setTimeout(tryNextCommand, 1000);
        }
      });
    }
    
    tryNextCommand();
  });
}

// ============ 其他原有函数保持不变 ============

ipcMain.handle('browse-category', async (event, category) => {
  console.log('[CATEGORY] 浏览分类:', category);
  
  if (category === '' || category === 'popular') {
    console.log('[CATEGORY] 检测到热门推荐请求');
    category = 'popular';
  }
  
  const cached = categoryCache.get(category);
  if (cached) {
    console.log('[CATEGORY] 使用内存缓存，应用数量:', cached.length);
    return cached;
  }
  
  let dbCachedApps = [];
  if (db) {
    try {
      const row = db.prepare('SELECT app_data FROM category_cache WHERE category = ?').get(category);
      if (row && row.app_data) {
        dbCachedApps = JSON.parse(row.app_data);
        console.log('[CATEGORY] 使用数据库缓存，应用数量:', dbCachedApps.length);
        
        categoryCache.set(category, dbCachedApps);
        return dbCachedApps;
      }
    } catch (error) {
      console.error('[CATEGORY] 读取数据库缓存失败:', error);
    }
  }
  
  const keywords = categoryKeywords[category] || categoryKeywords['popular'];
  
  console.log('[CATEGORY] 搜索关键词:', keywords);
  
  if (!keywords || keywords.length === 0) {
    console.log('[CATEGORY] 无关键词，返回空数组');
    return [];
  }
  
  try {
    const searchLimit = category === 'popular' ? 8 : 10;
    const searchPromises = keywords.slice(0, searchLimit).map(keyword => 
      execWingetSearch(keyword, { limit: 10 })
    );
    
    const resultsArrays = await Promise.all(searchPromises);
    
    let allApps = [];
    const seenIds = new Set();
    
    for (const apps of resultsArrays) {
      for (const app of apps) {
        if (!seenIds.has(app.id)) {
          seenIds.add(app.id);
          allApps.push(app);
        }
      }
    }
    
    console.log('[CATEGORY] 合并后总应用数:', allApps.length);
    
    if (allApps.length < 15 && category !== 'popular') {
      console.log('[CATEGORY] 结果太少，尝试通用搜索...');
      try {
        const genericResults = await execWingetSearch(category, { limit: 20 });
        for (const app of genericResults) {
          if (!seenIds.has(app.id)) {
            seenIds.add(app.id);
            allApps.push(app);
          }
        }
        console.log('[CATEGORY] 通用搜索后应用数:', allApps.length);
      } catch (genericError) {
        console.error('[CATEGORY] 通用搜索失败:', genericError);
      }
    }
    
    let finalApps = allApps.slice(0, appConfig.categorySearchLimit || 40);
    
    if (finalApps.length === 0) {
      console.log('[CATEGORY] 无搜索结果，使用后备方案');
      const fallbackApps = getFallbackCategoryApps(category);
      
      categoryCache.set(category, fallbackApps);
      if (db && fallbackApps.length > 0) {
        try {
          const appData = JSON.stringify(fallbackApps);
          db.prepare(`
            INSERT OR REPLACE INTO category_cache (category, app_data, cached_at)
            VALUES (?, ?, datetime('now'))
          `).run(category, appData);
        } catch (error) {
          console.error('[CATEGORY] 保存后备到数据库失败:', error);
        }
      }
      
      return fallbackApps;
    }
    
    if (category === 'popular') {
      finalApps.sort((a, b) => a.name.localeCompare(b.name));
      
      const essentialApps = [
        'Microsoft.Edge',
        'Google.Chrome', 
        'Mozilla.Firefox',
        'Microsoft.VisualStudioCode',
        '7zip.7zip',
        'VideoLAN.VLC'
      ];
      
      const essential = finalApps.filter(app => essentialApps.includes(app.id));
      const others = finalApps.filter(app => !essentialApps.includes(app.id));
      
      finalApps = [...essential, ...others];
    }
    
    categoryCache.set(category, finalApps);
    
    if (db && finalApps.length > 0) {
      try {
        const appData = JSON.stringify(finalApps);
        db.prepare(`
          INSERT OR REPLACE INTO category_cache (category, app_data, cached_at)
          VALUES (?, ?, datetime('now'))
        `).run(category, appData);
        console.log('[CATEGORY] 结果已保存到数据库');
      } catch (error) {
        console.error('[CATEGORY] 保存到数据库失败:', error);
      }
    }
    
    console.log('[CATEGORY] 返回应用数量:', finalApps.length);
    return finalApps;
    
  } catch (error) {
    console.error('[CATEGORY] 获取分类软件失败:', error);
    
    if (category !== 'popular') {
      showNotification('error', '分类加载失败', `无法获取${category}分类的软件列表，请检查网络连接或Winget状态`);
    }
    
    const fallbackApps = getFallbackCategoryApps(category);
    console.log('[CATEGORY] 使用后备方案，应用数量:', fallbackApps.length);
    
    return fallbackApps;
  }
});

ipcMain.handle('search-apps', async (event, query) => {
  console.log('[SEARCH] 搜索查询:', query);
  
  if (!query || query.trim().length === 0) {
    return [];
  }
  
  try {
    const output = await execWingetCommand(`winget search "${query}"`);
    
    if (!output || output.trim().length === 0) {
      console.log('[SEARCH] 搜索成功但无结果');
      return [];
    }
    
    console.log('[SEARCH] 原始输出长度:', output.length);
    
    const apps = parseWingetSearchOutput(output);
    console.log('[SEARCH] 解析到结果数量:', apps.length);
    
    return apps;
  } catch (error) {
    console.error('[SEARCH] 搜索失败:', error.code, error.message);
    
    return [];
  }
});

ipcMain.handle('get-search-suggestions', async (event, query) => {
  if (!query || query.length < 1 || !appConfig.enableSearchSuggestions) {
    return [];
  }
  
  try {
    const cached = suggestionCache.get(query);
    if (cached) {
      return cached;
    }
    
    const commonApps = [
      { id: 'Google.Chrome', name: 'Google Chrome' },
      { id: 'Microsoft.Edge', name: 'Microsoft Edge' },
      { id: 'Mozilla.Firefox', name: 'Mozilla Firefox' },
      { id: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code' },
      { id: 'VideoLAN.VLC', name: 'VLC Media Player' },
      { id: 'Spotify.Spotify', name: 'Spotify' },
      { id: '7zip.7zip', name: '7-Zip' },
      { id: 'Git.Git', name: 'Git' }
    ];
    
    const suggestions = commonApps
      .filter(app => 
        app.name.toLowerCase().includes(query.toLowerCase()) || 
        app.id.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 5);
    
    suggestionCache.set(query, suggestions);
    return suggestions;
  } catch (error) {
    console.error('[SUGGEST] 建议失败:', error);
    return [];
  }
});

ipcMain.handle('get-app-config', () => {
  return appConfig;
});

ipcMain.handle('update-app-config', (event, newConfig) => {
  console.log('[CONFIG] 更新配置:', newConfig);
  
  appConfig = { 
    ...appConfig, 
    ...newConfig,
    sources: appConfig.sources.map(source => {
      if (source.id === 'msstore') {
        return { ...source, enabled: newConfig.msstoreEnabled !== undefined ? newConfig.msstoreEnabled : source.enabled };
      }
      return source;
    })
  };
  
  saveConfig();
  
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('settings-updated', appConfig);
  }
  
  console.log('[CONFIG] 配置更新完成:', appConfig);
  return { success: true };
});

ipcMain.handle('get-sources', async () => {
  try {
    const sourcesFile = path.join(appDataPath, 'sources.json');
    if (fs.existsSync(sourcesFile)) {
      const data = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
      return data.sources;
    }
  } catch (error) {
    console.error('[SOURCES] 加载失败:', error);
  }
  
  return appConfig.sources;
});

ipcMain.handle('test-winget', async () => {
  try {
    const output = await execWingetCommand('winget --version');
    return { 
      success: true, 
      version: output.trim(),
      message: 'Winget 工作正常'
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      message: 'Winget 可能未正确安装或配置'
    };
  }
});

ipcMain.handle('get-installed-apps', async () => {
  if (!db) return [];
  
  try {
    return db.prepare(`
      SELECT app_id, app_name, version, install_date, source 
      FROM installed_apps 
      ORDER BY install_date DESC
    `).all();
  } catch (error) {
    console.error('[INSTALLED] 查询失败:', error);
    return [];
  }
});

ipcMain.handle('clear-app-cache', () => {
  popularAppsCache.clear();
  suggestionCache.cache.clear();
  categoryCache.clear();
  
  if (db) {
    try {
      db.prepare('DELETE FROM search_suggestions').run();
      db.prepare('DELETE FROM category_cache').run();
      console.log('[CACHE] 应用缓存已清除');
    } catch (error) {
      console.error('[CACHE] 清除数据库缓存失败:', error);
    }
  }
  
  return { success: true };
});

ipcMain.handle('preload-popular-apps', async () => {
  console.log('[PRELOAD] 预加载热门推荐应用');
  
  const cached = popularAppsCache.get();
  if (cached) {
    console.log('[PRELOAD] 使用热门缓存');
    return cached;
  }
  
  try {
    const apps = await ipcMain.handle('browse-category', null, 'popular');
    
    if (apps && apps.length > 0) {
      console.log('[PRELOAD] 预加载成功，应用数量:', apps.length);
      popularAppsCache.set(apps);
      return apps;
    }
  } catch (error) {
    console.error('[PRELOAD] 预加载失败:', error);
  }
  
  console.log('[PRELOAD] 使用默认热门应用');
  const defaultPopularApps = getFallbackCategoryApps('popular');
  popularAppsCache.set(defaultPopularApps);
  return defaultPopularApps;
});

ipcMain.handle('get-app-stats', async () => {
  try {
    const searchCacheCount = suggestionCache.cache.size;
    const categoryCacheCount = categoryCache.cache.size;
    
    let installedCount = 0;
    if (db) {
      installedCount = db.prepare('SELECT COUNT(*) as count FROM installed_apps').get().count;
    }
    
    const uptime = formatUptime(process.uptime());
    
    const cacheSize = (searchCacheCount * 0.5 + categoryCacheCount * 2).toFixed(1) + 'KB';
    
    return {
      searchCacheCount,
      categoryCacheCount,
      cacheSize,
      installedCount,
      searchCount: 0,
      uptime
    };
  } catch (error) {
    console.error('[STATS] 获取统计失败:', error);
    return {
      searchCacheCount: 0,
      categoryCacheCount: 0,
      cacheSize: '0KB',
      installedCount: 0,
      searchCount: 0,
      uptime: '0分钟'
    };
  }
});

ipcMain.handle('get-app-version', () => {
  return {
    version: app.getVersion(),
    electron: process.versions.electron
  };
});

ipcMain.handle('get-system-info', () => {
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release()
  };
});

ipcMain.handle('get-winget-info', async () => {
  try {
    const output = await execWingetCommand('winget --version');
    return { version: output.trim() };
  } catch (error) {
    console.error('[WINGET-INFO] 获取版本失败:', error);
    return { version: '未知' };
  }
});

ipcMain.handle('test-source-speed', async (event, sourceId) => {
  try {
    const result = await sourceMonitor.testSourceSpeed(sourceId);
    
    if (db && result.success) {
      try {
        db.prepare(`
          INSERT INTO source_stats (source_id, speed_ms, success, test_time)
          VALUES (?, ?, 1, datetime('now'))
        `).run(sourceId, result.speed);
      } catch (dbError) {
        console.error('[SOURCE-TEST] 保存测速结果失败:', dbError);
      }
    }
    
    return result;
  } catch (error) {
    console.error('[SOURCE-TEST] 测速失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-cache', async (event, cacheType) => {
  try {
    if (cacheType === 'search' || cacheType === 'all') {
      suggestionCache.cache.clear();
    }
    
    if (cacheType === 'category' || cacheType === 'all') {
      categoryCache.clear();
      popularAppsCache.clear();
    }
    
    if (db) {
      try {
        if (cacheType === 'search' || cacheType === 'all') {
          db.prepare('DELETE FROM search_suggestions').run();
        }
        if (cacheType === 'category' || cacheType === 'all') {
          db.prepare('DELETE FROM category_cache').run();
        }
      } catch (error) {
        console.error('[CACHE] 清除数据库缓存失败:', error);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('[CACHE-CLEAR] 清除缓存失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reset-settings', () => {
  const defaultConfig = {
    theme: 'dark',
    downloadSource: 'winget',
    sources: [
      { id: 'winget', name: '官方源', priority: 1, enabled: true },
      { id: 'msstore', name: '微软商店源', priority: 2, enabled: false },
    ],
    batchSize: 3,
    autoCheckUpdates: true,
    enableSounds: false,
    enableSearchSuggestions: true,
    showSourceSwitcher: true,
    categorySearchLimit: 40,
    silentInstall: true,
    installNotifications: true,
    autoSource: false,
    shortcuts: {
      search: 'Ctrl+F',
      install: 'Ctrl+I',
      settings: 'Ctrl+,',
      quit: 'Ctrl+Q'
    }
  };
  
  appConfig = defaultConfig;
  saveConfig();
  
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('settings-updated', appConfig);
  }
  
  return { success: true };
});

ipcMain.handle('export-settings', () => {
  try {
    const exportData = {
      config: appConfig,
      exportDate: new Date().toISOString(),
      version: app.getVersion()
    };
    
    const filePath = path.join(appDataPath, 'settings-export.json');
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf8');
    
    return { success: true, filePath };
  } catch (error) {
    console.error('[EXPORT] 导出设置失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-settings', async () => {
  try {
    const filePath = path.join(appDataPath, 'settings-export.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      appConfig = { ...appConfig, ...data.config };
      saveConfig();
      
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('settings-updated', appConfig);
      }
      
      return { success: true };
    }
    return { success: false, error: '没有找到导出文件' };
  } catch (error) {
    console.error('[IMPORT] 导入设置失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-for-updates', () => {
  return { updateAvailable: false, latestVersion: app.getVersion() };
});

ipcMain.handle('reset-statistics', () => {
  if (db) {
    try {
      db.prepare('DELETE FROM source_stats').run();
      db.prepare('DELETE FROM app_stats').run();
      return { success: true };
    } catch (error) {
      console.error('[STATS-RESET] 重置统计失败:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: true };
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('show-license', () => {
  const licenseText = `PkgHub - MIT License

Copyright (c) 2023 PkgHub Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'MIT 许可证',
    message: 'PkgHub - MIT 许可证',
    detail: licenseText,
    buttons: ['确定'],
    noLink: true
  });
  
  return { success: true };
});

ipcMain.handle('quit-app', () => {
  app.quit();
  return { success: true };
});

app.whenReady().then(() => {
  initApp();
  createWindow();
  
  setTimeout(() => {
    execWingetCommand('winget --version')
      .then(version => {
        console.log('[STARTUP] Winget 版本:', version.trim());
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('winget-status', { 
            ok: true, 
            version: version.trim() 
          });
        }
      })
      .catch(error => {
        console.error('[STARTUP] Winget 测试失败:', error);
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('winget-status', { 
            ok: false, 
            error: error.message 
          });
        }
      });
  }, 500);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (db) {
      db.close();
    }
    app.quit();
  }
});

app.on('before-quit', () => {
  saveConfig();
});