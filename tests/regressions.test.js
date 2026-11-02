const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');

const root = path.resolve(__dirname, '..');
function renderer(file, dependencies) {
    let source = fs.readFileSync(path.join(root, file), 'utf8')
        .replace(/^import .*;\r?$/gm, '')
        .replace(/export default (\w+);/, 'module.exports = $1;');
    if (file.endsWith('.jsx')) {
        source = require('@babel/core').transformSync(source, {presets: ['@babel/preset-react']}).code;
    }
    const context = {module: {exports: {}}, Buffer, console, ...dependencies};
    vm.runInNewContext(source, context, {filename: file});
    return context.module.exports;
}

function filesystem(t, importPathMode = "absolute") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftpp-test-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const dialog = {showSaveDialog: () => undefined, showErrorBox() {}, showMessageBox: () => 0};
    const Base64ImagesLoader = renderer('src/client/utils/Base64ImagesLoader.js', {
        Image: class { constructor() { this.complete = true; } }
    });
    const FileSystem = renderer('src/client/platform/electron/FileSystem.js', {
        require: name => name === 'electron' ? {remote: {dialog}} :
            name === 'chokidar' ? {watch: () => ({on() {}, add() {}, close() {}})} : require(name),
        APP: {i: {packOptions: {importPathMode}}}, Controller: {updateProject() {}}, I18: {f: key => key},
        dialog, Observer: {emit() {}}, GLOBAL_EVENT: {}, Project: {save: () => false}, Base64ImagesLoader
    });
    return {dir, FileSystem, dialog};
}

test('relative image, folder and export paths load beside the ftpp file', t => {
    const {dir, FileSystem} = filesystem(t);
    const project = path.join(dir, 'project.ftpp');
    fs.writeFileSync(project, JSON.stringify({images: [{name: 'a.png', path: 'assets/a.png', folder: ''}], folders: ['assets'], packOptions: {savePath: 'output'}}));
    const {data} = FileSystem.loadProject(project);
    assert.equal(data.images[0].path, path.join(dir, 'assets/a.png'));
    assert.equal(data.folders[0], path.join(dir, 'assets'));
    assert.equal(data.packOptions.savePath, 'output');
    assert.equal(FileSystem.resolveProjectPath(data.packOptions.savePath), path.join(dir, 'output'));
});

for (const [name, options, importMode, exportMode] of [
    ['both missing', {}, 'absolute', 'absolute'],
    ['missing modes with a relative-looking export path', {savePath: 'output'}, 'absolute', 'absolute'],
    ['import mode missing', {savePathMode: 'relative'}, 'absolute', 'relative'],
    ['export mode missing', {importPathMode: 'relative', savePath: 'output'}, 'relative', 'absolute'],
    ['explicit relative modes', {importPathMode: 'relative', savePathMode: 'relative'}, 'relative', 'relative']
]) {
    test(`legacy project defaults missing path modes independently: ${name}`, t => {
        const {dir, FileSystem} = filesystem(t);
        const project = path.join(dir, 'legacy.ftpp');
        fs.writeFileSync(project, JSON.stringify({images: [], folders: [], packOptions: options}));
        const {data} = FileSystem.loadProject(project);
        assert.equal(data.packOptions.importPathMode, importMode);
        assert.equal(data.packOptions.savePathMode, exportMode);
        FileSystem.saveProject(data, project);
        const saved = JSON.parse(fs.readFileSync(project, 'utf8'));
        assert.equal(saved.packOptions.importPathMode, importMode);
        assert.equal(saved.packOptions.savePathMode, exportMode);
    });
}

test('save and save-as rebase relative resources and export without mutating live images', t => {
    const {dir, FileSystem} = filesystem(t);
    const data = {images: [{name: 'a.png', path: path.join(dir, 'assets/a.png'), folder: '', pathMode: 'relative'}], folders: [path.join(dir, 'assets')], folderPathModes: {[path.join(dir, 'assets')]: 'relative'}, packOptions: {savePath: path.join(dir, 'output'), savePathMode: 'relative', importPathMode: 'relative'}};
    const project = path.join(dir, 'project.ftpp');
    assert.equal(FileSystem.saveProject(data, project), project);
    let saved = JSON.parse(fs.readFileSync(project));
    assert.equal(saved.images[0].path, 'assets/a.png');
    assert.equal(saved.folders[0], 'assets');
    assert.equal(saved.packOptions.savePath, 'output');
    assert.equal(data.images[0].path, path.join(dir, 'assets/a.png'));
    fs.mkdirSync(path.join(dir, 'nested'));
    FileSystem.saveProject(data, path.join(dir, 'nested/project.ftpp'));
    saved = JSON.parse(fs.readFileSync(path.join(dir, 'nested/project.ftpp')));
    assert.equal(saved.images[0].path, '../assets/a.png');
    assert.equal(saved.packOptions.savePath, '../output');
});

test('legacy absolute paths remain absolute and failed save is not reported as successful', t => {
    const {dir, FileSystem} = filesystem(t);
    const data = {images: [{path: path.join(dir, 'a.png')}], folders: [], packOptions: {savePath: path.join(dir, 'out')}};
    const project = path.join(dir, 'project.ftpp');
    FileSystem.saveProject(data, project);
    assert.equal(JSON.parse(fs.readFileSync(project)).images[0].path, path.join(dir, 'a.png'));
    assert.equal(FileSystem.saveProject(data, path.join(dir, 'missing/project.ftpp')), undefined);
});

test('moving a project tree imports its new resources and exports beside the moved project', t => {
    const {dir, FileSystem, dialog} = filesystem(t);
    const original = path.join(dir, 'original');
    fs.mkdirSync(path.join(original, 'assets'), {recursive: true});
    fs.writeFileSync(path.join(original, 'assets/a.png'), 'image-content');
    fs.writeFileSync(path.join(original, 'project.ftpp'), JSON.stringify({images: [], folders: ['assets'], packOptions: {savePath: 'output', savePathMode: 'relative'}}));
    const moved = path.join(dir, 'moved');
    fs.renameSync(original, moved);
    const {data} = FileSystem.loadProject(path.join(moved, 'project.ftpp'));
    let images;
    FileSystem.loadFolder(data.folders[0], value => {images = value;}, data.folderPathModes[data.folders[0]]);
    assert.equal(images['assets/a.png'].fsPath.path, path.join(moved, 'assets/a.png'));
    assert.equal(images['assets/a.png'].fsPath.pathMode, 'relative');
    assert.equal(images['assets/a.png']._base64, 'data:image/png;base64,aW1hZ2UtY29udGVudA==');
    const Downloader = renderer('src/client/platform/electron/Downloader.js', {
        require: name => name === 'electron' ? {remote: {dialog}} : require(name),
        FileSystem, dialog, I18: {f: key => key}
    });
    Downloader.run([{name: 'sub/atlas.json', content: '{"frames":[]}'}], 'atlas', data.packOptions.savePath);
    assert.equal(fs.readFileSync(path.join(moved, 'output/sub/atlas.json'), 'utf8'), '{"frames":[]}');
    dialog.showMessageBox = (options, callback) => callback(1);
    Downloader.run([{name: 'sub/atlas.json', content: 'replacement'}], 'atlas', data.packOptions.savePath);
    assert.equal(fs.readFileSync(path.join(moved, 'output/sub/atlas.json'), 'utf8'), '{"frames":[]}');
});

test('relative import on an unsaved project stops when first save is cancelled', t => {
    const {dir, FileSystem, dialog} = filesystem(t, 'relative');
    const image = path.join(dir, 'a.png');
    fs.writeFileSync(image, 'image-content');
    dialog.showOpenDialog = () => [image];
    dialog.showMessageBox = () => 1;
    let result = 'not called';
    FileSystem.addImages(value => {result = value;});
    assert.equal(result, undefined);
    assert.equal(FileSystem.projectPath, '');
});

test('export path mode switches preserve the target and support the project directory itself', t => {
    const {dir, FileSystem} = filesystem(t);
    FileSystem.saveProject({images: [], folders: [], packOptions: {}}, path.join(dir, 'project.ftpp'));
    assert.equal(FileSystem.formatExportPath(path.join(dir, 'out'), 'relative'), 'out');
    assert.equal(FileSystem.formatExportPath('out', 'absolute'), path.join(dir, 'out'));
    assert.equal(FileSystem.formatExportPath(dir, 'relative'), '.');
});

function properties(FileSystem) {
    const PackProperties = renderer('src/client/ui/PackProperties.jsx', {
        React: {Component: class {}}, ReactDOM: {findDOMNode: ref => ref}, FileSystem
    });
    const view = Object.create(PackProperties.prototype);
    view.packOptions = {savePath: 'out', savePathMode: 'relative'};
    view.refs = {savePath: {value: 'out'}, savePathMode: {value: 'absolute'}};
    view.onExporterPropChanged = () => {
        view.packOptions.savePath = view.refs.savePath.value;
        view.packOptions.savePathMode = view.refs.savePathMode.value;
    };
    return view;
}

test('cancelling first save while switching inherited relative preferences restores the selector', t => {
    const {FileSystem} = filesystem(t);
    const view = properties(FileSystem);
    assert.doesNotThrow(() => view.onSavePathModeChanged());
    assert.equal(view.refs.savePathMode.value, 'relative');
    assert.equal(view.packOptions.savePathMode, 'relative');
    assert.equal(view.packOptions.savePath, 'out');
});

test('typed export paths obey the selected mode before saving or exporting', t => {
    const {dir, FileSystem} = filesystem(t);
    FileSystem.saveProject({images: [], folders: [], packOptions: {}}, path.join(dir, 'project.ftpp'));
    const view = properties(FileSystem);
    view.refs.savePathMode.value = 'relative';
    view.refs.savePath.value = path.join(dir, 'output');
    view.onSavePathChanged();
    assert.equal(view.packOptions.savePath, 'output');
    view.refs.savePathMode.value = 'absolute';
    view.onSavePathModeChanged();
    assert.equal(view.packOptions.savePath, path.join(dir, 'output'));
});

test('dropped images retain their real file location without the removed File.path property', () => {
    const file = {name: 'red.png', type: 'image/png'};
    const LocalImagesLoader = renderer('src/client/utils/LocalImagesLoader.js', {
        PLATFORM: 'electron', FileSystem: {getImportPathMode: () => 'absolute', getFilePath: item => item === file ? '/assets/outside-project/red.png' : ''},
        Image: class {constructor() {this.complete = true;}},
        FileReader: class {readAsDataURL() {this.onload({target: {result: 'data:image/png;base64,pixel'}});}}
    });
    let images;
    new LocalImagesLoader().load([file], null, result => {images = result;});
    assert.equal(images['red.png'].fsPath.path, '/assets/outside-project/red.png');
});

function desktop() {
    const app = new EventEmitter();
    app.requestSingleInstanceLock = () => true;
    app.isReady = () => false;
    app.quit = () => {};
    const ipcMain = new EventEmitter();
    const dialogs = [];
    const dialog = {
        showOpenDialogSync(parent, options) { dialogs.push({type: 'open', parent, options}); return ['/assets/a.png']; },
        showSaveDialogSync(parent, options) { dialogs.push({type: 'save', parent, options}); return '/projects/saved.ftpp'; },
        showMessageBoxSync(parent, options) { dialogs.push({type: 'message', parent, options}); return 1; },
        showErrorBox(title, content) { dialogs.push({type: 'error', title, content}); }
    };
    const windows = [];
    class Window extends EventEmitter {
        constructor(options) {
            super(); windows.push(this); this.messages = [];
            this.options = options;
            this.webContents = new EventEmitter();
            this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
            this.webContents.send = (name, payload) => this.messages.push({name, payload});
            this.send = this.webContents.send;
        }
        loadFile(file) { this.file = file; }
        loadURL() {}
        setTitle(title) { this.title = title; }
        isDestroyed() { return false; }
        focus() { Window.focused = this; this.emit('focus'); }
        close() { const event = {preventDefault() {this.prevented = true;}}; this.emit('close', event); if(!event.prevented) this.emit('closed'); }
        static getFocusedWindow() { return Window.focused; }
        static fromWebContents(contents) { return windows.find(w => w.webContents === contents); }
        static getAllWindows() { return windows; }
    }
    const updater = new EventEmitter();
    updater.checkForUpdates = () => {};
    const Menu = {setApplicationMenu(menu) {this.menu = menu;}, buildFromTemplate: template => template};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8'), {
        require: name => ({electron: {app, BrowserWindow: Window, ipcMain, Menu, shell: {}, dialog},
            'electron-updater': {autoUpdater: updater}, 'electron-window-state': () => ({manage() {}}),
            optimist: {argv: {}}, tinify: {}})[name] || require(name),
        process: {platform: 'darwin', argv: ['/app/executable']}, __dirname: path.join(root, 'electron'), console
    });
    return {app, ipcMain, windows, Menu, dialogs};
}

test('native dialogs run in the main process and attach to the requesting project window', () => {
    const {app, ipcMain, windows, dialogs} = desktop();
    app.emit('ready');
    app.emit('open-file', {preventDefault() {}}, '/projects/second.ftpp');
    const event = {sender: windows[1].webContents};
    // Electron replies when returnValue is assigned; a second assignment cannot replace it.
    let replied = false;
    let response;
    Object.defineProperty(event, 'returnValue', {
        get: () => response,
        set: value => { if (!replied) { response = value; replied = true; } },
        configurable: true
    });
    ipcMain.emit('dialog-open', event, {properties: ['openFile']});
    assert.deepEqual(event.returnValue, ['/assets/a.png']);
    assert.equal(dialogs[0].parent, windows[1]);
    replied = false;
    ipcMain.emit('dialog-save', event, {});
    assert.equal(event.returnValue, '/projects/saved.ftpp');
    replied = false;
    ipcMain.emit('dialog-message', event, {buttons: ['Yes', 'No']});
    assert.equal(event.returnValue, 1);
    const unknown = {sender: new EventEmitter()};
    ipcMain.emit('dialog-open', unknown, {});
    assert.equal(unknown.returnValue, null);
    assert.equal(dialogs.length, 3);
});

test('modern Electron can run the existing local renderer and denies unexpected child windows', () => {
    const {app, windows} = desktop();
    app.emit('ready');
    assert.equal(windows[0].options.webPreferences.nodeIntegration, true);
    assert.equal(windows[0].options.webPreferences.contextIsolation, false);
    assert.equal(windows[0].openHandler({url: 'javascript:alert(1)'}).action, 'deny');
});

test('double-click before and after ready opens separate projects only after renderer readiness', () => {
    const {app, ipcMain, windows} = desktop();
    app.emit('open-file', {preventDefault() {}}, '/projects/first.ftpp');
    app.emit('ready');
    assert.equal(windows.length, 1);
    app.emit('open-file', {preventDefault() {}}, '/projects/second.ftpp');
    assert.equal(windows.length, 2);
    for (const win of windows) win.webContents.emit('did-finish-load');
    assert.equal(windows[1].messages.length, 0);
    ipcMain.emit('renderer-ready', {sender: windows[1].webContents});
    ipcMain.emit('renderer-ready', {sender: windows[0].webContents});
    assert.equal(windows[0].messages[0].payload.data, '/projects/first.ftpp');
    assert.equal(windows[1].messages[0].payload.data, '/projects/second.ftpp');
    assert.equal(path.isAbsolute(windows[1].file), true);
});

test('project titles, modified state and menu commands belong to their own windows', () => {
    const {app, ipcMain, windows, Menu} = desktop();
    app.emit('ready');
    app.emit('open-file', {preventDefault() {}}, '/projects/second.ftpp');
    assert.equal(windows.length, 2);
    const [first, second] = windows;
    ipcMain.emit('update-app-info', {sender: first.webContents}, {displayName: 'Packer'});
    ipcMain.emit('project-update', {sender: first.webContents}, {path: '/projects/first.ftpp'});
    ipcMain.emit('project-update', {sender: second.webContents}, {path: '/projects/second.ftpp'});
    ipcMain.emit('project-modified', {sender: first.webContents}, {val: true});
    assert.equal(first.title, '* first.ftpp - Packer');
    assert.equal(second.title, 'second.ftpp - Packer');
    first.focus();
    const save = Menu.menu[0].submenu.find(item => item.actionName === 'project-save');
    save.click(save, first);
    assert.equal(first.messages.at(-1).name, 'project-save');
    const before = first.messages.length;
    second.close();
    assert.equal(first.messages.length, before);
    first.close();
    assert.equal(first.messages.at(-1).name, 'quit');
});

test('second-instance forwards Windows and Linux project arguments into new windows', () => {
    const {app, ipcMain, windows} = desktop();
    app.emit('ready');
    app.emit('second-instance', {}, ['/app/executable', 'nested/second.ftpp'], '/projects');
    assert.equal(windows.length, 2);
    ipcMain.emit('renderer-ready', {sender: windows[1].webContents});
    assert.equal(windows[1].messages[0].payload.data, '/projects/nested/second.ftpp');
    ipcMain.emit('renderer-ready', {sender: windows[1].webContents});
    assert.equal(windows[1].messages.length, 1);
});

 test('switching import mode converts all existing image and folder paths on save and reopen', t => {
    const {dir, FileSystem} = filesystem(t);
    const project = path.join(dir, 'project.ftpp');
    const image = path.join(dir, 'assets/a.png');
    const folder = path.join(dir, 'assets');
    const data = {images: [{path: image, folder: '', pathMode: 'absolute'}], folders: [folder], folderPathModes: {[folder]: 'absolute'}, packOptions: {importPathMode: 'relative'}};
    for (const mode of ['relative', 'absolute', 'relative']) {
        data.packOptions.importPathMode = mode;
        assert.equal(FileSystem.saveProject(data, project), project);
        const saved = JSON.parse(fs.readFileSync(project, 'utf8'));
        const expectedImage = mode === 'relative' ? 'assets/a.png' : image;
        const expectedFolder = mode === 'relative' ? 'assets' : folder;
        assert.equal(saved.images[0].path, expectedImage);
        assert.equal(saved.images[0].pathMode, mode);
        assert.equal(saved.images[0].folder, '');
        assert.equal(saved.folders[0], expectedFolder);
        assert.equal(saved.folderPathModes[expectedFolder], mode);
        const reopened = FileSystem.loadProject(project).data;
        assert.equal(reopened.images[0].path, image);
        assert.equal(reopened.folders[0], folder);
        assert.equal(reopened.images[0].pathMode, mode);
        assert.equal(reopened.folderPathModes[folder], mode);
        assert.equal(data.images[0].path, image);
    }
});

 test('preview reveal scrolls above rows to the top, below rows to the bottom and keeps visible rows still', () => {
    const ImagesList = renderer('src/client/ui/ImagesList.jsx', {React: {Component: class {}}, ReactDOM: {findDOMNode: ref => ref}});
    for (const [top, bottom, expected] of [[60, 80, 160], [320, 340, 240], [140, 160, 200]]) {
        const row = {getAttribute: () => 'nested/a.png', getBoundingClientRect: () => ({top, bottom})};
        const container = {scrollTop: 200, clientTop: 0, clientHeight: 200, getBoundingClientRect: () => ({top: 100}), querySelectorAll: () => [row]};
        const view = Object.create(ImagesList.prototype);
        view.refs = {imagesTree: container};
        view.revealImage('nested/a.png');
        assert.equal(container.scrollTop, expected);
    }
});
 test('dropping mixed files and folders imports nested images with filesystem paths and import mode', t => {
    const {dir, FileSystem} = filesystem(t, 'relative');
    FileSystem.saveProject({images: [], folders: [], packOptions: {}}, path.join(dir, 'project.ftpp'));
    fs.mkdirSync(path.join(dir, 'assets/nested'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'assets/nested/a.png'), 'nested-image');
    fs.writeFileSync(path.join(dir, 'single.png'), 'single-image');
    fs.writeFileSync(path.join(dir, 'ignore.txt'), 'ignore');
    FileSystem.getFilePath = file => file.location;
    let result;
    FileSystem.importDroppedFiles(['assets', 'single.png', 'ignore.txt'].map(name => ({location: path.join(dir, name)})), images => {result = images;});
    assert.deepEqual(Object.keys(result).sort(), ['assets/nested/a.png', 'single.png']);
    assert.equal(result['assets/nested/a.png'].fsPath.folder, path.join(dir, 'assets'));
    assert.equal(result['assets/nested/a.png'].fsPath.pathMode, 'relative');
    assert.equal(result['single.png'].fsPath.path, path.join(dir, 'single.png'));
    assert.equal(result['single.png'].fsPath.pathMode, 'relative');
});

 test('export preview generates the same configuration content without writing output files', async () => {
    const events = [];
    let downloads = 0;
    const APP = renderer('src/client/APP.js', {
        Observer: {emit: (...args) => events.push(args)}, GLOBAL_EVENT: {SHOW_EXPORT_PREVIEW: 'preview'},
        getFilterByType: () => class {apply(buffer) {return buffer;}},
        Tinifyer: {start: async value => value},
        startExporter: async (exporter, data, options) => JSON.stringify({image: options.imageFile, width: options.imageWidth, data}),
        Downloader: {run: () => downloads++}
    });
    const app = Object.create(APP.prototype);
    app.packOptions = {exporter: {fileExt: 'json'}, textureName: 'atlas', textureFormat: 'png', scale: 1};
    app.packResult = [{data: [{file: 'a.png'}], renderer: {scale: () => ({width: 64, height: 32, toDataURL: () => 'data:image/png;base64,aGVsbG8='})}}];
    await app.doExport(true);
    assert.equal(downloads, 0);
    const files = events.find(event => event[0] === 'preview')[1];
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'atlas.json');
    assert.deepEqual(JSON.parse(files[0].content), {image: 'atlas.png', width: 64, data: [{file: 'a.png'}]});
});
 test('export preview resizes from every edge and corner while staying within the window', () => {
    const ExportPreview = renderer('src/client/ui/ExportPreview.jsx', {React: {Component: class {}}, window: {innerWidth: 1200, innerHeight: 900}});
    for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
        const view = Object.create(ExportPreview.prototype);
        view.state = {left: 100, top: 100, width: 800, height: 500};
        view.setState = next => Object.assign(view.state, next);
        view.startResize(direction, {button: 0, clientX: 0, clientY: 0, preventDefault() {}});
        view.onMouseMove({clientX: 20, clientY: 30});
        assert.equal(view.state.left, direction.includes('w') ? 120 : 100);
        assert.equal(view.state.top, direction.includes('n') ? 130 : 100);
        assert.equal(view.state.width, direction.includes('w') ? 780 : direction.includes('e') ? 820 : 800);
        assert.equal(view.state.height, direction.includes('n') ? 470 : direction.includes('s') ? 530 : 500);
    }
});

 test('preview keeps keyboard focus inside the dialog and closes with Escape', () => {
    const activeDocument = {activeElement: null};
    const ExportPreview = renderer('src/client/ui/ExportPreview.jsx', {React: {Component: class {}}, document: activeDocument});
    const view = Object.create(ExportPreview.prototype);
    let focused;
    const first = {focus: () => {focused = 'first';}};
    const last = {focus: () => {focused = 'last';}};
    view.refs = {dialog: {querySelectorAll: () => [first, last]}};
    let closed = false;
    view.props = {onClose: () => {closed = true;}};
    const event = {key: 'Tab', shiftKey: true, stopPropagation() {}, preventDefault() {}};
    activeDocument.activeElement = first;
    view.onKeyDown(event);
    assert.equal(focused, 'last');
    activeDocument.activeElement = last;
    view.onKeyDown({...event, shiftKey: false});
    assert.equal(focused, 'first');
    view.onKeyDown({...event, key: 'Escape'});
    assert.equal(closed, true);
});

 test('empty custom templates show a clear instruction before preview or export starts', () => {
    const events = [];
    const APP = renderer('src/client/APP.js', {Observer: {emit: (...args) => events.push(args)}, GLOBAL_EVENT: {SHOW_MESSAGE: 'message'}, I18: {f: key => key}, setTimeout: () => {throw new Error('Export must not start');}});
    const app = Object.create(APP.prototype);
    app.packResult = [{}];
    for (const preview of [true, false]) {
        for (const content of [undefined, null, '', '  \n\t', {}]) {
            events.length = 0;
            app.packOptions = {exporter: {type: 'custom', content}};
            app.startExport(preview);
            assert.deepEqual(events, [['message', 'CUSTOM_TEMPLATE_EMPTY']]);
        }
    }
});
 test('loading project options refreshes the custom template edit button visibility', () => {
    const PackProperties = renderer('src/client/ui/PackProperties.jsx', {React: {Component: class {}}, ReactDOM: {findDOMNode: ref => ref}, getExporterByType: type => ({type})});
    const view = Object.create(PackProperties.prototype);
    const refs = {};
    view.refs = new Proxy(refs, {get: (target, key) => target[key] || (target[key] = {value: '', style: {visibility: 'hidden'}})});
    for (const exporter of ['custom', 'JsonHash', 'custom']) {
        view.packOptions = {exporter};
        view.refreshPackOptions();
        assert.equal(view.refs.editCustomFormat.style.visibility, exporter === 'custom' ? 'visible' : 'hidden');
    }
});
