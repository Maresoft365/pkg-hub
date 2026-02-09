const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    searchApps: (query) => ipcRenderer.invoke('search-apps', query),
    
    browseCategory: (category) => ipcRenderer.invoke('browse-category', category),
    
    installApp: (appId, appName) => ipcRenderer.invoke('install-app', appId, appName),
    
    getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
    
    getSearchSuggestions: (query) => ipcRenderer.invoke('get-search-suggestions', query),
    
    preloadPopularApps: () => ipcRenderer.invoke('preload-popular-apps'),
    
    getAppConfig: () => ipcRenderer.invoke('get-app-config'),
    
    updateAppConfig: (config) => ipcRenderer.invoke('update-app-config', config),
    
    getSources: () => ipcRenderer.invoke('get-sources'),
    
    testWinget: () => ipcRenderer.invoke('test-winget'),
    
    getAppStats: () => ipcRenderer.invoke('get-app-stats'),
    
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    
    getWingetInfo: () => ipcRenderer.invoke('get-winget-info'),
    
    testSourceSpeed: (sourceId) => ipcRenderer.invoke('test-source-speed', sourceId),
    
    clearCache: (cacheType) => ipcRenderer.invoke('clear-cache', cacheType),
    
    resetSettings: () => ipcRenderer.invoke('reset-settings'),
    
    exportSettings: () => ipcRenderer.invoke('export-settings'),
    
    importSettings: () => ipcRenderer.invoke('import-settings'),
    
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    
    resetStatistics: () => ipcRenderer.invoke('reset-statistics'),
    
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    
    showLicense: () => ipcRenderer.invoke('show-license'),
    
    quitApp: () => ipcRenderer.invoke('quit-app'),
    
    onInstallProgress: (callback) => {
        ipcRenderer.on('install-progress', (event, data) => callback(data));
    },
    
    onWingetStatus: (callback) => {
        ipcRenderer.on('winget-status', (event, data) => callback(data));
    },
    
    onSettingsUpdate: (callback) => {
        ipcRenderer.on('settings-updated', (event, config) => callback(config));
    },
    
    removeInstallProgressListener: () => {
        ipcRenderer.removeAllListeners('install-progress');
    },
    
    removeWingetStatusListener: () => {
        ipcRenderer.removeAllListeners('winget-status');
    },
    
    removeSettingsUpdateListener: () => {
        ipcRenderer.removeAllListeners('settings-updated');
    }
});
