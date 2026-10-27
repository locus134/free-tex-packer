const path = require('path');
const tinify = require('tinify');
const argv = require('optimist').argv;
const windowStateKeeper = require('electron-window-state');
const {app, BrowserWindow, ipcMain, Menu, shell} = require('electron');
const {autoUpdater} = require("electron-updater");

const windows = new Map();
const pendingProjects = [];
let ready = false;

function getActiveWindow() {
    return BrowserWindow.getFocusedWindow() || windows.keys().next().value;
}
let APP_INFO = {};
let LANGUAGES = [];

function createWindow(projectPath = "") {
	let w = 1300;
	let h = 700;

	if(process.platform === "win32") {
		w = 1320;
		h = 740;
	}
	
	let mainWindowState = windowStateKeeper({
        defaultWidth: w,
        defaultHeight: h
    });
    
    const mainWindow = new BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        minWidth: w,
        minHeight: h,
        title: "",
        icon: path.resolve(__dirname, 'www/static/images/icon.png')
    });

    windows.set(mainWindow, {path: "", modified: false, pendingProject: projectPath,
        locale: "", strings: {}, recentProjects: []});
    mainWindowState.manage(mainWindow);
    mainWindow.on('focus', () => buildMenu(mainWindow));

    mainWindow.on('page-title-updated', function(e) {
        e.preventDefault();
    });

    if (argv.env === 'development') {
        mainWindow.loadURL('http://localhost:4000/');
    }
    else {
        mainWindow.loadFile(path.join(__dirname, 'www/index.html'));
    }

    mainWindow.on('close', function(e) {
        if(windows.get(mainWindow).modified) {
            dispatchMessage({actionName: 'quit'}, mainWindow);
            e.preventDefault();
        }
    });
    
    mainWindow.on('closed', function() {
        windows.delete(mainWindow);
    });
	
	mainWindow.webContents.on('will-navigate', (e, url) => handleRedirect(e, url, mainWindow));
	mainWindow.webContents.on('new-window', (e, url) => handleRedirect(e, url, mainWindow));

    mainWindow.webContents.on('context-menu', (e, props) => showInputContextMenu(e, props, mainWindow));
    updateWindowTitle(mainWindow);
    return mainWindow;
}

function showInputContextMenu(e, props, mainWindow) {
    const LOCALE_STRINGS = windows.get(mainWindow).strings;
    if(!props.isEditable) return;
    
    const menu = Menu.buildFromTemplate([
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_UNDO,
            role: 'undo',
            enabled: props.editFlags.canUndo,
            accelerator: 'CmdOrCtrl+Z'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_REDO,
            role: 'redo',
            enabled: props.editFlags.canRedo,
            accelerator: 'CmdOrCtrl+Shift+Z'
        },
        {
            type: 'separator',
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_CUT,
            role: 'cut',
            enabled: props.editFlags.canCut,
            accelerator: 'CmdOrCtrl+X'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_COPY,
            role: 'copy',
            enabled: props.editFlags.canCopy,
            accelerator: 'CmdOrCtrl+C'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_PASTE,
            role: 'paste',
            enabled: props.editFlags.canPaste,
            accelerator: 'CmdOrCtrl+V'
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_DELETE,
            role: 'delete',
            enabled: props.editFlags.canDelete,
            accelerator: 'Del'
        },
        {
            type: 'separator',
        },
        {
            label: LOCALE_STRINGS.CONTEXT_MENU_SELECT_ALL,
            role: 'selectall',
            enabled: props.editFlags.canSelectAll,
            accelerator: 'CmdOrCtrl+A'
        }
    ]);

    menu.popup(mainWindow);
}

function startAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => {
    });

    autoUpdater.on('update-available', (info) => {
        for (const win of windows.keys()) win.webContents.send('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
    });

    autoUpdater.on('error', (err) => {
    });

    autoUpdater.on('download-progress', (progressObj) => {
        for (const win of windows.keys()) win.webContents.send('download-progress', progressObj.percent);
    });

    autoUpdater.on('update-downloaded', (info) => {
        autoUpdater.quitAndInstall(true, true);
    });

    ipcMain.on('install-update', (e, data) => {
        autoUpdater.downloadUpdate();
    });
}

function handleRedirect(e, url, mainWindow) {
	if(url !== mainWindow.webContents.getURL()) {
        e.preventDefault();
        shell.openExternal(url);
    }
}

function buildMenu(mainWindow = getActiveWindow()) {
    if (!mainWindow || !windows.has(mainWindow)) return;
    const state = windows.get(mainWindow);
    const LOCALE_STRINGS = state.strings;
    const CURRENT_LOCALE = state.locale;
    const RECENT_PROJECTS = state.recentProjects;
    const sendMessage = item => dispatchMessage(item, mainWindow);
    let template = [];
    
    let recentProjects = [];
    
    if(RECENT_PROJECTS.length) {
        for(let path of RECENT_PROJECTS) {
            let name = path.split("/").pop();
            recentProjects.push({label: name, actionName: 'project-load', click: sendMessage, custom: path});
        }
    }
    else {
        recentProjects.push({label: "...", enabled: false});
    }

    let quitAcc = "CmdOrCtrl+F4";
    if(process.platform === "darwin") quitAcc = "CmdOrCtrl+Q";
    
    template.push({
        label: LOCALE_STRINGS.MENU_FILE,
        submenu: [
            {label: LOCALE_STRINGS.MENU_FILE_PROJECT_NEW, actionName: 'project-new', click: sendMessage, accelerator: 'CmdOrCtrl+N'},
            {label: LOCALE_STRINGS.MENU_FILE_PROJECT_LOAD, actionName: 'project-load', click: sendMessage, accelerator: 'CmdOrCtrl+O'},
            {label: LOCALE_STRINGS.MENU_FILE_PROJECT_LOAD_RECENT, submenu: recentProjects},
            {type: 'separator'},
            {label: LOCALE_STRINGS.MENU_FILE_PROJECT_SAVE, actionName: 'project-save', click: sendMessage, accelerator: 'CmdOrCtrl+S'},
            {label: LOCALE_STRINGS.MENU_FILE_PROJECT_SAVE_AS, actionName: 'project-save-as', click: sendMessage, accelerator: 'CmdOrCtrl+Shift+N'},
            {type: 'separator'},
            {label: LOCALE_STRINGS.MENU_FILE_PREFERENCES_SAVE, actionName: 'preferences-save', click: sendMessage},
            {type: 'separator'},
            {label: LOCALE_STRINGS.MENU_FILE_INSTALL_CLI, click: installCLI},
            {type: 'separator'},
            {label: LOCALE_STRINGS.MENU_FILE_EXIT, actionName: 'quit', click: sendMessage, accelerator: quitAcc}
        ]
    });

    template.push({
        label: LOCALE_STRINGS.MENU_ACTIONS,
        submenu: [
            {label: LOCALE_STRINGS.MENU_ACTIONS_ADD_IMAGES, actionName: 'action-add-images', click: sendMessage, accelerator: 'Shift+A'},
            {label: LOCALE_STRINGS.MENU_ACTIONS_ADD_FOLDER, actionName: 'action-add-folder', click: sendMessage, accelerator: 'Shift+F'},
            {type: 'separator'},
            {label: LOCALE_STRINGS.MENU_ACTIONS_SELECT_ALL, actionName: 'action-select-all', click: sendMessage, accelerator: 'CmdOrCtrl+A'},
            {label: LOCALE_STRINGS.MENU_ACTIONS_DELETE, actionName: 'action-delete', click: sendMessage, accelerator: 'Delete'},
            {label: LOCALE_STRINGS.MENU_ACTIONS_CLEAR, actionName: 'action-clear', click: sendMessage, accelerator: 'CmdOrCtrl+Shift+C'},
            {type: 'separator'},
            {label: LOCALE_STRINGS.MENU_ACTIONS_EXPORT, actionName: 'action-export', click: sendMessage, accelerator: 'CmdOrCtrl+E'}
        ]
    });

    template.push({
        label: LOCALE_STRINGS.MENU_TOOLS,
        submenu: [
            {label: LOCALE_STRINGS.MENU_TOOLS_SPLITTER, actionName: 'action-show-splitter', click: sendMessage,}
        ]
    });
    
    let langs = [];
    if(LANGUAGES !== []) {
        for (let lang of LANGUAGES) {
            langs.push({
                label: lang.name,
                custom: lang.lang,
                checked: CURRENT_LOCALE === lang.lang,
                type: 'checkbox',
                actionName: 'change-locale',
                click: sendMessage
            });
        }
    }

    template.push({
        label: LOCALE_STRINGS.MENU_LANGUAGE,
        submenu: langs
    });

    template.push({
        label: LOCALE_STRINGS.MENU_HELP,
        submenu: [
            {label: LOCALE_STRINGS.MENU_HELP_ABOUT, actionName: 'show-about', click: sendMessage, accelerator: 'F1'}
        ]
    });
    
    if(argv.env === 'development') {
        template.push({label: 'Dev', submenu: [
            {label: 'Console', click: () => mainWindow.webContents.openDevTools()},
            {label: 'Reload', click: () => mainWindow.webContents.reload()}
        ]});
    }
    
    let menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function installCLI() {
    shell.openExternal('https://github.com/odrick/free-tex-packer-cli');
}

function quit(win) {
    if (!win || !windows.has(win)) return;
    windows.get(win).modified = false;
    win.close();
}

function dispatchMessage(item, win = getActiveWindow()) {
    if (!win || win.isDestroyed()) return;
    win.webContents.send(item.actionName, item.custom ? {data: item.custom} : null);
}

function updateWindowTitle(win) {
    if (!win || !windows.has(win)) return;
    const state = windows.get(win);
    const name = state.path ? path.basename(state.path) : "untitled.ftpp";
    win.setTitle(APP_INFO.displayName ? (state.modified ? "* " : "") + name + ' - ' + APP_INFO.displayName : "");
}

function openProject(projectPath) {
    if (!ready) pendingProjects.push(projectPath);
    else createWindow(projectPath);
}

function projectArguments(args) {
    return args.filter(arg => /\.ftpp$/i.test(arg));
}

app.on('open-file', (event, projectPath) => {
    event.preventDefault();
    openProject(projectPath);
});

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

app.on('second-instance', (event, args, workingDirectory) => {
    const projects = projectArguments(args);
    for (const project of projects) openProject(path.resolve(workingDirectory, project));
    if (!projects.length) {
        const win = getActiveWindow();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    }
});

app.on('ready', () => {
    if (!hasInstanceLock) return;
    ready = true;
    const projects = Array.from(new Set(pendingProjects.concat(projectArguments(process.argv))));
    if (projects.length) projects.forEach(project => createWindow(project));
    else createWindow();
    pendingProjects.length = 0;
    startAutoUpdater();
    autoUpdater.checkForUpdates();
});

ipcMain.on('renderer-ready', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !windows.has(win)) return;
    const state = windows.get(win);
    if (state.pendingProject) {
        dispatchMessage({actionName: 'project-load', custom: state.pendingProject}, win);
        state.pendingProject = "";
    }
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (!windows.size) {
        createWindow();
    }
});

ipcMain.on('tinify', (e, data) => {
    tinify.key = data.key;
    tinify.fromBuffer(Buffer.from(data.imageData, 'base64')).toBuffer((err, res) => {
        if (err) {
            e.sender.send('tinify-complete', {
                success: false,
                uid: data.uid,
                error: err.message
            });
            return;
        }
        
        e.sender.send('tinify-complete', {
            success: true,
            uid: data.uid,
            data: res.toString('base64')
        });
    });
});

ipcMain.on('update-app-info', (e, data) => {
    APP_INFO = data;
    buildMenu();
    for (const win of windows.keys()) updateWindowTitle(win);
});

ipcMain.on('update-languages', (e, data) => {
    LANGUAGES = data;
    buildMenu();
});

ipcMain.on('update-locale', (e, data) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!windows.has(win)) return;
    windows.get(win).locale = data.currentLocale;
    windows.get(win).strings = data.strings;
    buildMenu();
});

ipcMain.on('project-recent-update', (e, data) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!windows.has(win)) return;
    windows.get(win).recentProjects = data.projects;
    buildMenu();
});

ipcMain.on('project-update', (e, data) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!windows.has(win)) return;
    windows.get(win).path = data.path;
    windows.get(win).modified = false;
    updateWindowTitle(win);
});

ipcMain.on('project-modified', (e, data) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!windows.has(win)) return;
    windows.get(win).modified = data.val;
    updateWindowTitle(win);
});

ipcMain.on('quit', (e, data) => {
    quit(BrowserWindow.fromWebContents(e.sender));
});