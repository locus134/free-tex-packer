const fs = require('fs');
const nodePath = require('path');
const chokidar = require('chokidar');
import dialog from './Dialogs';

import Controller from 'platform/Controller';
import APP from '../../APP';
import Project from 'platform/Project';
import I18 from '../../utils/I18';
import Base64ImagesLoader from '../../utils/Base64ImagesLoader';
import { Observer, GLOBAL_EVENT } from '../../Observer';

const IMAGES_EXT = ['jpg', 'png', 'gif'];

let watcher = null;
let projectPath = "";
let pathModes = {};

class FileSystem {
    static get projectPath() { return projectPath; }

    static resetProject() {
        projectPath = "";
        pathModes = {};
    }

    static resolveProjectPath(value, base = projectPath) {
        if (!value || nodePath.isAbsolute(value)) return value;
        if (!base) throw new Error(I18.f("SAVE_PROJECT_FIRST"));
        return FileSystem.fixPath(nodePath.resolve(nodePath.dirname(base), value));
    }

    static relativePath(value, base) {
        if (!value) return "";
        return FileSystem.fixPath(nodePath.relative(nodePath.dirname(base), value)) || ".";
    }

    static ensureProjectSaved() {
        if (projectPath) return true;
        dialog.showMessageBox({message: I18.f("SAVE_PROJECT_FIRST"), buttons: [I18.f("OK")]});
        return !!Project.save();
    }

    static getImportPathMode() {
        const mode = APP.i.packOptions.importPathMode === "relative" ? "relative" : "absolute";
        if (mode === "relative" && !FileSystem.ensureProjectSaved()) return null;
        return mode;
    }

    static formatExportPath(value, mode) {
        if (!value) return "";
        if ((mode === "relative" || !nodePath.isAbsolute(value)) && !FileSystem.ensureProjectSaved()) return null;
        const absolute = FileSystem.resolveProjectPath(FileSystem.fixPath(value));
        return mode === "relative" ? FileSystem.relativePath(absolute, projectPath) : absolute;
    }

    static getFilePath(file) {
        return require('electron').webUtils.getPathForFile(file);
    }

    static fixPath(path) {
        return path.split("\\").join("/");
    }

    static getExtFromPath(path) {
        return path.split(".").pop().toLowerCase();
    }

    static selectFolder() {
        let dir = dialog.showOpenDialog({
            properties: ['openDirectory']
        });
        return dir && dir.length ? dir[0] : null;
    }

    static getFolderFilesList(dir, base = "", list = []) {
        let files = fs.readdirSync(dir);
        for (let file of files) {
            if (fs.statSync(dir + file).isDirectory() && (dir + file).toUpperCase().indexOf("__MACOSX") < 0) {
                list = FileSystem.getFolderFilesList(dir + file + '/', base + file + "/", list);
            }
            else {
                list.push({
                    name: (base ? base : "") + file,
                    path: dir + file
                });
            }
        }

        return list;
    }

    static addImages(cb) {
        let list = dialog.showOpenDialog({
            filters: [{ name: I18.f("IMAGES"), extensions: IMAGES_EXT }],
            properties: ['openFile', 'multiSelections']
        });

        if (list && list.length) {
            const pathMode = FileSystem.getImportPathMode();
            if (!pathMode) { if (cb) cb(); return; }
            let files = [];
            for (let path of list) {
                path = FileSystem.fixPath(path);
                let name = path.split("/").pop();

                files.push({
                    name: name,
                    path: path,
                    folder: "",
                    pathMode: pathMode
                });
            }

            FileSystem.loadImages(files, cb);
        }
        else {
            if (cb) cb();
        }
    }

    static addFolder(cb) {
        let dir = dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (dir && dir.length) {
            let path = FileSystem.fixPath(dir[0]);
            const pathMode = FileSystem.getImportPathMode();
            if (!pathMode) { if (cb) cb(); return; }
            FileSystem.loadFolder(path, cb, pathMode);
        }
        else {
            if (cb) cb();
        }
    }

    static importDroppedFiles(files, cb) {
        const pathMode = FileSystem.getImportPathMode();
        if (!pathMode) { if (cb) cb({}); return; }
        const images = [];
        for (const file of Array.from(files)) {
            try {
                const path = FileSystem.fixPath(FileSystem.getFilePath(file));
                if (!path) continue;
                const stat = fs.statSync(path);
                if (stat.isDirectory()) {
                    const name = nodePath.basename(path);
                    const items = FileSystem.getFolderFilesList(path + "/", name + "/");
                    FileSystem.startWatch(path);
                    for (const item of items) images.push(Object.assign({}, item, {folder: path, pathMode}));
                }
                else if (stat.isFile()) {
                    images.push({name: nodePath.basename(path), path, folder: "", pathMode});
                }
            }
            catch (e) { }
        }
        FileSystem.loadImages(images, cb);
    }

    static startWatch(path) {
        try {
            if (!watcher) {
                watcher = chokidar.watch(path, { ignoreInitial: true });
                watcher.on('all', FileSystem.onWatchEvent);
            }
            else {
                watcher.add(path);
            }
        }
        catch (e) { }
    }

    static stopWatch(path) {
        if (watcher) {
            watcher.unwatch(path);
        }
    }

    static terminateWatch() {
        pathModes = {};
        if (watcher) {
            watcher.close();
            watcher = null;
        }
    }

    static onWatchEvent(event, path) {
        Observer.emit(GLOBAL_EVENT.FS_CHANGES, { event: event, path: FileSystem.fixPath(path) });
    }

    static loadImages(list, cb) {
        let files = [];

        for (let item of list) {
            let path = item.path;
            item.pathMode = item.pathMode || pathModes[item.folder || path] || "absolute";
            pathModes[item.folder || path] = item.pathMode;
            let ext = FileSystem.getExtFromPath(path);

            if (IMAGES_EXT.indexOf(ext) >= 0) {
                if (!item.folder) FileSystem.startWatch(path);

                try {
                    let content = fs.readFileSync(path, 'base64');
                    content = "data:image/" + ext + ";base64," + content;
                    files.push({ name: item.name, url: content, fsPath: item });
                }
                catch (e) { }
            }
        }

        let loader = new Base64ImagesLoader();
        loader.load(files, null, (res) => {
            if (cb) cb(res);
        });
    }

    static loadFolder(path, cb, pathMode = pathModes[path] || "absolute") {
        pathModes[path] = pathMode;
        if (fs.existsSync(path)) {
            FileSystem.startWatch(path);

            let parts = path.split("/");
            let name = "";
            while (parts.length && !name) name = parts.pop();

            let list = FileSystem.getFolderFilesList(path + "/", name + "/");

            for (let item of list) {
                item.folder = path;
                item.pathMode = pathMode;
            }

            FileSystem.loadImages(list, cb);
        }
        else {
            cb({});
        }
    }

    static saveProject(data, path = "") {
        let options = {
            filters: [{ name: "Free texture packer", extensions: ['ftpp'] }]
        };

        if (!path) {
            path = dialog.showSaveDialog(options);
        }

        if (path) {
            path = FileSystem.fixPath(path);

            try {
                const encode = (value, mode) => {
                    const absolute = FileSystem.resolveProjectPath(value, projectPath || path);
                    return mode === "relative" ? FileSystem.relativePath(absolute, path) : absolute;
                };
                const importPathMode = data.packOptions.importPathMode === "relative" ? "relative" : "absolute";
                const folderPathModes = {};
                const folders = (data.folders || []).map(folder => {
                    const mode = importPathMode;
                    const saved = encode(folder, mode);
                    folderPathModes[saved] = mode;
                    return saved;
                });
                const savePath = encode(data.packOptions.savePath || "", data.packOptions.savePathMode);
                const saved = Object.assign({}, data, {
                    images: (data.images || []).map(item => Object.assign({}, item, {
                        path: encode(item.path, importPathMode),
                        pathMode: importPathMode,
                        folder: encode(item.folder || "", importPathMode)
                    })),
                    folders: folders,
                    folderPathModes: folderPathModes,
                    savePath: savePath,
                    packOptions: Object.assign({}, data.packOptions, {savePath: savePath})
                });
                fs.writeFileSync(path, JSON.stringify(saved, null, 2));
                data.packOptions.savePath = savePath;
                projectPath = path;
                Controller.updateProject(path);
            }
            catch (e) {
                dialog.showErrorBox(I18.f("PROJECT_SAVE_ERROR"), e.message);
                return undefined;
            }
        }

        return path;
    }

    static loadProject(pathToLoad = "") {
        let path;

        if (pathToLoad) {
            path = FileSystem.fixPath(pathToLoad);
        }
        else {
            path = dialog.showOpenDialog({
                filters: [{ name: "Free texture packer", extensions: ['ftpp'] }],
                properties: ['openFile']
            });

            if (path && path[0]) {
                path = FileSystem.fixPath(path[0]);
            }
            else { path = null; }
        }

        let data = null;

        if (path) {
            try {
                data = fs.readFileSync(path);
                data = JSON.parse(data);
                const modes = data.folderPathModes || {};
                data.images = (data.images || []).map(item => Object.assign({}, item, {
                    pathMode: item.pathMode || (nodePath.isAbsolute(item.path) ? "absolute" : "relative"),
                    path: FileSystem.resolveProjectPath(item.path, path),
                    folder: FileSystem.resolveProjectPath(item.folder || "", path)
                }));
                data.folderPathModes = {};
                data.folders = (data.folders || []).map(folder => {
                    const absolute = FileSystem.resolveProjectPath(folder, path);
                    data.folderPathModes[absolute] = modes[folder] || (nodePath.isAbsolute(folder) ? "absolute" : "relative");
                    return absolute;
                });
                data.packOptions = data.packOptions || {};
                data.packOptions.savePath = data.packOptions.savePath || data.savePath || "";
                data.packOptions.importPathMode = data.packOptions.importPathMode || "absolute";
                data.packOptions.savePathMode = data.packOptions.savePathMode || "absolute";
                projectPath = path;
                Controller.updateProject(path);
            }
            catch (e) { data = null }
        }

        return { path, data };
    }
}

export default FileSystem;