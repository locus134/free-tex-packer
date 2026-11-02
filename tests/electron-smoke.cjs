// Run with Electron after `npm run build-electron`. All test windows stay hidden.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const {app, ipcMain, BrowserWindow} = electron;
const workspace = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ftpp-native-smoke-'));
const windows = [];
const failures = [];
let saveAsPath;
const openPaths = [];
let messageBoxes = 0;

process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
process.on('unhandledRejection', error => { console.error(error.stack || error); app.exit(1); });
setTimeout(() => { console.error('Native smoke test exceeded 60 seconds'); app.exit(1); }, 60000).unref();

app.setPath('userData', path.join(temp, 'profile'));
app.setName('Free texture packer smoke test');

class HiddenWindow extends BrowserWindow {
    constructor(options) {
        super({...options, show: false, webPreferences: {...options.webPreferences, backgroundThrottling: false}});
        windows.push(this);
        this.webContents.on('render-process-gone', (event, details) => failures.push(details.reason));
        this.webContents.on('console-message', (event) => {
            if (event.level === 'error') failures.push(event.message);
        });
    }
}

// Replace only native UI boundaries; execute the real app, renderer, IPC, and filesystem.
const overrides = {
    app, ipcMain, BrowserWindow: HiddenWindow, Menu: electron.Menu, shell: electron.shell,
    dialog: {
        showSaveDialogSync() { return saveAsPath; },
        showOpenDialogSync() {
            assert.ok(openPaths.length, 'Unexpected open dialog');
            return openPaths.shift();
        },
        showMessageBoxSync() { messageBoxes++; return 0; },
        showErrorBox(title, message) { failures.push(`${title}: ${message}`); }
    }
};
const facade = new Proxy({}, {get: (target, name) => name in overrides ? overrides[name] : electron[name]});
const load = Module._load;
Module._load = function(request, parent, isMain) {
    return request === 'electron' ? facade : load.call(this, request, parent, isMain);
};
require(process.env.FTPP_SMOKE_MAIN || path.join(workspace, 'electron/main.js'));
Module._load = load;

async function until(predicate, description) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (failures.length) throw new Error(failures.join('\n'));
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    const states = await Promise.all(windows.filter(win => !win.isDestroyed()).map(async win => ({
        title: win.getTitle(),
        text: await win.webContents.executeJavaScript('document.body.innerText').catch(error => error.message),
        values: await win.webContents.executeJavaScript('Array.from(document.querySelectorAll("input[type=text]")).map(input => input.value)')
    })));
    throw new Error(`Timed out: ${description}\n${JSON.stringify(states)}\nFiles: ${fs.readdirSync(temp, {recursive: true}).filter(name => name.startsWith('output'))}`);
}

app.once('ready', async () => {
    try {
        if (process.env.FTPP_SMOKE_MAIN) {
            assert.equal(fs.existsSync(path.join(path.dirname(process.env.FTPP_SMOKE_MAIN), 'dist')), false,
                'Packaged applications must not include previous generated distributions');
        }
        fs.mkdirSync(path.join(temp, 'assets'));
        fs.mkdirSync(path.join(temp, 'nested'));
        // Use the app's bundled PNG icon as a real decodable image.
        fs.copyFileSync(path.join(workspace, 'src/client/resources/static/images/icon.png'), path.join(temp, 'assets/icon.png'));
        for (const name of ['first', 'second']) {
            fs.writeFileSync(path.join(temp, `${name}.ftpp`), JSON.stringify({
                images: [{name: 'icon.png', path: 'assets/icon.png', folder: '', pathMode: 'relative'}],
                folders: [],
                packOptions: {importPathMode: 'relative', textureName: name, savePath: `output/${name}`, savePathMode: 'relative'}
            }));
        }

        const buttons = windows[0];
        await until(() => buttons.webContents.executeJavaScript('!!document.querySelector(".images-controllers .btn")'), 'import buttons mounted');
        openPaths.push([path.join(temp, 'assets/icon.png')]);
        await buttons.webContents.executeJavaScript('Array.from(document.querySelectorAll(".images-controllers .btn")).find(button => button.textContent.trim() === "Add images").click()');
        await until(() => buttons.webContents.executeJavaScript('document.querySelector(".images-tree").innerText.includes("icon.png")'), 'Add images button updates list');
        openPaths.push([path.join(temp, 'assets')]);
        await buttons.webContents.executeJavaScript('Array.from(document.querySelectorAll(".images-controllers .btn")).find(button => button.textContent.trim() === "Add folder").click()');
        await until(() => buttons.webContents.executeJavaScript('document.querySelector(".images-tree").innerText.includes("assets")'), 'Add folder button updates list');
        saveAsPath = path.join(temp, 'buttons.ftpp');
        buttons.webContents.send('project-save-as');
        await until(() => fs.existsSync(saveAsPath), 'save button-imported resources');
        const imported = JSON.parse(fs.readFileSync(saveAsPath, 'utf8'));
        assert.equal(imported.packOptions.importPathMode, 'absolute');
        assert.equal(imported.images[0].path, path.join(temp, 'assets/icon.png'));
        assert.equal(imported.folders[0], path.join(temp, 'assets'));

        await buttons.webContents.executeJavaScript(`(() => {
            const rows = Array.from(document.querySelectorAll('.props-list tr'));
            const importIndex = rows.findIndex(row => row.textContent.includes('Import path mode'));
            const exportIndex = rows.findIndex(row => row.textContent.includes('Export path mode'));
            if (importIndex < 0 || exportIndex !== importIndex + 1) throw new Error('Import path mode must appear directly above Export path mode');
            const select = rows[importIndex].querySelector('select');
            select.value = 'relative';
            select.dispatchEvent(new Event('change', {bubbles: true}));
        })()`);
        fs.copyFileSync(path.join(temp, 'assets/icon.png'), path.join(temp, 'relative.png'));
        openPaths.push([path.join(temp, 'relative.png')]);
        await buttons.webContents.executeJavaScript('Array.from(document.querySelectorAll(".images-controllers .btn")).find(button => button.textContent.trim() === "Add images").click()');
        await until(() => buttons.webContents.executeJavaScript('document.querySelector(".images-tree").innerText.includes("relative.png")'), 'relative import uses right-side setting');
        fs.mkdirSync(path.join(temp, 'relative-folder'));
        fs.copyFileSync(path.join(temp, 'assets/icon.png'), path.join(temp, 'relative-folder/icon.png'));
        openPaths.push([path.join(temp, 'relative-folder')]);
        await buttons.webContents.executeJavaScript('Array.from(document.querySelectorAll(".images-controllers .btn")).find(button => button.textContent.trim() === "Add folder").click()');
        await until(() => buttons.webContents.executeJavaScript('document.querySelector(".images-tree").innerText.includes("relative-folder")'), 'relative folder import uses right-side setting');
        buttons.webContents.send('project-save');
        await until(() => JSON.parse(fs.readFileSync(saveAsPath, 'utf8')).packOptions.importPathMode === 'relative', 'persist import path setting');
        const relative = JSON.parse(fs.readFileSync(saveAsPath, 'utf8'));
        assert.equal(relative.images.find(image => image.name === 'relative.png').path, 'relative.png');
        assert.ok(relative.folders.includes('assets'));
        assert.equal(relative.folderPathModes.assets, 'relative');
        assert.ok(relative.folders.includes('relative-folder'));
        assert.equal(relative.folderPathModes['relative-folder'], 'relative');
        assert.equal(messageBoxes, 0, 'Image and folder imports must not prompt for path mode');
        app.emit('open-file', {preventDefault() {}}, saveAsPath);
        const restored = windows.at(-1);
        await until(() => restored.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.props-list tr')).some(row => row.textContent.includes('Import path mode') && row.querySelector('select').value === 'relative')`), 'restore import path mode from ftpp');

        const legacyPath = path.join(temp, 'legacy.ftpp');
        fs.writeFileSync(legacyPath, JSON.stringify({images: [], folders: [], packOptions: {savePath: 'legacy-output'}}));
        app.emit('open-file', {preventDefault() {}}, legacyPath);
        const legacy = windows.at(-1);
        await until(() => legacy.getTitle().startsWith('legacy.ftpp'), 'legacy project load');
        const legacyModes = await legacy.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.props-list tr')).filter(row => /Import path mode|Export path mode/.test(row.textContent)).map(row => row.querySelector('select').value)`);
        assert.deepEqual(legacyModes, ['absolute', 'absolute']);
        legacy.webContents.send('project-save');
        await until(() => JSON.parse(fs.readFileSync(legacyPath, 'utf8')).packOptions.importPathMode === 'absolute', 'persist legacy defaults');
        assert.equal(JSON.parse(fs.readFileSync(legacyPath, 'utf8')).packOptions.savePathMode, 'absolute');

        app.emit('open-file', {preventDefault() {}}, path.join(temp, 'first.ftpp'));
        const first = windows.at(-1);
        await until(async () => first.getTitle().startsWith('first.ftpp') &&
            await first.webContents.executeJavaScript('document.querySelector(".images-tree").innerText.includes("icon.png")'), 'first project resource import');

        app.emit('open-file', {preventDefault() {}}, path.join(temp, 'second.ftpp'));
        const second = windows.at(-1);
        await until(async () => second.getTitle().startsWith('second.ftpp') &&
            await second.webContents.executeJavaScript('document.querySelector(".images-tree").innerText.includes("icon.png")'), 'second project resource import');
        assert.notEqual(first, second);
        assert.equal(first.getTitle(), 'first.ftpp - Free texture packer');

        for (const win of [first, second]) {
            await until(() => win.webContents.executeJavaScript('document.querySelectorAll("canvas").length > 0 && !document.body.innerText.includes("Please, wait...")'), 'texture generation before export');
        }

        first.webContents.send('action-export');
        await until(() => fs.existsSync(path.join(temp, 'output/first/first.json')), 'relative export from first window');
        second.webContents.send('action-export');
        await until(() => fs.existsSync(path.join(temp, 'output/second/second.json')), 'relative export from second window');
        for (const name of ['first', 'second']) {
            const result = JSON.parse(fs.readFileSync(path.join(temp, `output/${name}/${name}.json`), 'utf8'));
            assert.ok(result.frames['icon.png']);
            assert.ok(fs.statSync(path.join(temp, `output/${name}/${name}.png`)).size > 0);
        }

        saveAsPath = path.join(temp, 'nested/saved.ftpp');
        first.webContents.send('project-save-as');
        await until(() => fs.existsSync(saveAsPath), 'save-as through native dialog IPC');
        const saved = JSON.parse(fs.readFileSync(saveAsPath, 'utf8'));
        assert.equal(saved.images[0].path, '../assets/icon.png');
        assert.equal(saved.packOptions.savePath, '../output/first');
        assert.equal(second.getTitle(), 'second.ftpp - Free texture packer');


        // Use Chromium-backed File objects so Electron resolves their actual disk paths.
        fs.mkdirSync(path.join(temp, 'drop-assets/nested'), {recursive: true});
        for (let i = 0; i < 60; i++) {
            const bitmap = Buffer.alloc(8 * 8 * 4);
            for (let offset = 0; offset < bitmap.length; offset += 4) bitmap.set([i * 3, 90, 160, 255], offset);
            fs.writeFileSync(path.join(temp, 'drop-assets/nested', String(i).padStart(2, '0') + '.png'), electron.nativeImage.createFromBitmap(bitmap, {width: 8, height: 8}).toPNG());
        }
        const dropProject = path.join(temp, 'drop.ftpp');
        fs.writeFileSync(dropProject, JSON.stringify({images: [], folders: [], packOptions: {textureName: 'drop', importPathMode: 'relative', savePathMode: 'relative', savePath: 'output/drop', detectIdentical: false}}));
        app.emit('open-file', {preventDefault() {}}, dropProject);
        const dropped = windows.at(-1);
        await until(() => dropped.getTitle().startsWith('drop.ftpp'), 'drop project ready');
        await dropped.webContents.executeJavaScript('var input = document.createElement("input"); input.type = "file"; input.multiple = true; input.id = "native-drop-input"; input.hidden = true; document.body.appendChild(input);');
        dropped.webContents.debugger.attach('1.3');
        const documentNode = await dropped.webContents.debugger.sendCommand('DOM.getDocument');
        const inputNode = await dropped.webContents.debugger.sendCommand('DOM.querySelector', {nodeId: documentNode.root.nodeId, selector: '#native-drop-input'});
        await dropped.webContents.debugger.sendCommand('DOM.setFileInputFiles', {nodeId: inputNode.nodeId, files: [path.join(temp, 'drop-assets'), path.join(temp, 'relative.png')]});
        await dropped.webContents.executeJavaScript('var transfer = new DataTransfer(); for (var file of document.querySelector("#native-drop-input").files) transfer.items.add(file); document.querySelector(".images-tree").dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: transfer}));');
        dropped.webContents.debugger.detach();
        await until(() => dropped.webContents.executeJavaScript('document.querySelectorAll("[data-image-path]").length === 61 && document.querySelectorAll("canvas").length > 0 && !document.body.innerText.includes("Please, wait...")'), 'mixed folder and image drop');
        dropped.webContents.send('project-save');
        await until(() => JSON.parse(fs.readFileSync(dropProject, 'utf8')).folders.includes('drop-assets'), 'dropped folder relative path saved');
        dropped.webContents.send('action-export');
        await until(() => fs.existsSync(path.join(temp, 'output/drop/drop.json')), 'dropped images packed');
        const dropAtlas = JSON.parse(fs.readFileSync(path.join(temp, 'output/drop/drop.json'), 'utf8'));
        for (const [file, initialScroll, edge] of [['drop-assets/nested/59.png', 0, 'bottom'], ['drop-assets/nested/00.png', 99999, 'top']]) {
            const frame = dropAtlas.frames[file].frame;
            const position = await dropped.webContents.executeJavaScript(`(() => {
                const list = document.querySelector('.images-tree');
                list.scrollTop = ${initialScroll};
                const canvas = document.querySelector('canvas');
                const rect = canvas.getBoundingClientRect();
                canvas.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: rect.left + (${frame.x} + 2) * rect.width / canvas.width, clientY: rect.top + (${frame.y} + 2) * rect.height / canvas.height}));
                const row = Array.from(list.querySelectorAll('[data-image-path]')).find(row => row.dataset.imagePath === ${JSON.stringify(file)});
                return {top: row.getBoundingClientRect().top - list.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom - list.getBoundingClientRect().top, height: list.clientHeight, selected: row.classList.contains('back-400')};
            })()`);
            assert.equal(position.selected, true);
            assert.ok(Math.abs(edge === 'top' ? position.top : position.bottom - position.height) <= 1, JSON.stringify(position));
        }
        await dropped.webContents.executeJavaScript('document.querySelector(".tree-view-arrow").click()');
        const revealFrame = dropAtlas.frames['drop-assets/nested/00.png'].frame;
        await dropped.webContents.executeJavaScript(`var canvas = document.querySelector('canvas'); var rect = canvas.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: rect.left + (${revealFrame.x} + 2) * rect.width / canvas.width, clientY: rect.top + (${revealFrame.y} + 2) * rect.height / canvas.height}));`);
        assert.equal(await dropped.webContents.executeJavaScript('document.querySelector(".tree-view-children").classList.contains("tree-view-children-collapsed")'), false);


        await dropped.webContents.executeJavaScript('var previewButton = Array.from(document.querySelectorAll(".btn")).find(button => button.textContent.trim() === "Preview"); if (!previewButton || previewButton.nextElementSibling.textContent.trim() !== "Export") throw new Error("Preview must be left of Export"); previewButton.click();');
        await until(() => dropped.webContents.executeJavaScript('!!document.querySelector(".export-preview-content")'), 'configuration preview opens');
        assert.equal(await dropped.webContents.executeJavaScript('document.querySelector(".export-preview-content").textContent'), fs.readFileSync(path.join(temp, 'output/drop/drop.json'), 'utf8'));
        assert.equal(await dropped.webContents.executeJavaScript('document.querySelectorAll(".export-preview-resize").length'), 8);
        await dropped.webContents.executeJavaScript(`(() => {
            const handle = document.querySelector('.resize-se');
            const bounds = handle.getBoundingClientRect();
            handle.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0, clientX: bounds.left, clientY: bounds.top}));
            window.dispatchEvent(new MouseEvent('mousemove', {clientX: bounds.left - 1000, clientY: bounds.top - 1000}));
            window.dispatchEvent(new MouseEvent('mouseup'));
        })()`);
        await dropped.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        if (process.env.FTPP_SCREENSHOT) fs.writeFileSync(process.env.FTPP_SCREENSHOT, (await dropped.webContents.capturePage()).toPNG());
        const overflow = await dropped.webContents.executeJavaScript('var pre = document.querySelector(".export-preview-content"); ({horizontal: pre.scrollWidth > pre.clientWidth, vertical: pre.scrollHeight > pre.clientHeight, overflow: getComputedStyle(pre).overflow, width: document.querySelector(".export-preview-window").getBoundingClientRect().width})');
        assert.equal(overflow.width, 320);
        assert.equal(overflow.horizontal, true);
        assert.equal(overflow.vertical, true);
        assert.equal(overflow.overflow, 'auto');
        await dropped.webContents.executeJavaScript('document.querySelector(".export-preview-window").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));');
        assert.equal(await dropped.webContents.executeJavaScript('!!document.querySelector(".export-preview-window")'), false);


        const customProject = path.join(temp, 'custom.ftpp');
        fs.writeFileSync(customProject, JSON.stringify({images: [{name: 'icon.png', path: 'assets/icon.png', folder: ''}], folders: [], packOptions: {exporter: 'custom', textureName: 'custom', savePath: 'output/custom', savePathMode: 'relative'}}));
        app.emit('open-file', {preventDefault() {}}, customProject);
        const custom = windows.at(-1);
        await until(async () => custom.getTitle().startsWith('custom.ftpp') && await custom.webContents.executeJavaScript('document.querySelectorAll("[data-image-path]").length === 1 && document.querySelectorAll("canvas").length > 0 && !document.body.innerText.includes("Please, wait...")'), 'custom project loaded');
        assert.equal(await custom.webContents.executeJavaScript('getComputedStyle(document.querySelector(".edit-btn")).visibility'), 'visible');
        for (const caption of ['Preview', 'Export']) {
            await custom.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.btn')).find(button => button.textContent.trim() === ${JSON.stringify(caption)}).click()`);
            await until(() => custom.webContents.executeJavaScript('!!document.querySelector(".message-box-content")'), 'empty custom template message');
            assert.ok((await custom.webContents.executeJavaScript('document.querySelector(".message-box-content").textContent')).includes('The custom template is empty.'));
            await custom.webContents.executeJavaScript('document.querySelector(".message-box-buttons .btn").click()');
        }
        assert.equal(fs.existsSync(path.join(temp, 'output/custom')), false);
        await custom.webContents.executeJavaScript('document.querySelector(".edit-btn").click(); document.querySelector(".edit-custom-exporter-data").value = "atlas={{config.imageName}} width={{config.imageWidth}}"; document.querySelector(".edit-custom-exporter-content input[type=text]").value = "txt"; document.querySelector(".edit-custom-exporter-controls .btn").click();');
        await custom.webContents.executeJavaScript('Array.from(document.querySelectorAll(".btn")).find(button => button.textContent.trim() === "Preview").click()');
        await until(() => custom.webContents.executeJavaScript('!!document.querySelector(".export-preview-content")'), 'filled custom template preview');
        const customContent = await custom.webContents.executeJavaScript('document.querySelector(".export-preview-content").textContent');
        assert.ok(customContent.startsWith('atlas=custom width='));
        await custom.webContents.executeJavaScript('document.querySelector(".export-preview-close").click()');
        custom.webContents.send('action-export');
        await until(() => fs.existsSync(path.join(temp, 'output/custom/custom.txt')), 'filled custom template export');
        assert.equal(fs.readFileSync(path.join(temp, 'output/custom/custom.txt'), 'utf8'), customContent);

        first.close();
        assert.equal(second.isDestroyed(), false);
        console.log('PASS: imports and drops, preview reveal, two windows, export/save-as, exact configuration preview, resize, empty custom template guidance and editor visibility');
        app.exit(0);
    }
    catch (error) {
        console.error(error.stack);
        app.exit(1);
    }
});

process.on('exit', () => fs.rmSync(temp, {recursive: true, force: true}));
