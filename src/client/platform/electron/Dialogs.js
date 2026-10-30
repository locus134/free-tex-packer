const {ipcRenderer} = require('electron');

// Keep the local project workflow synchronous; native dialogs belong to the main process.
const Dialogs = {
    showOpenDialog(options) {
        return ipcRenderer.sendSync('dialog-open', options);
    },
    showSaveDialog(options) {
        return ipcRenderer.sendSync('dialog-save', options);
    },
    showMessageBox(options, callback) {
        const response = ipcRenderer.sendSync('dialog-message', options);
        if (callback) callback(response);
        return response;
    },
    showErrorBox(title, content) {
        ipcRenderer.sendSync('dialog-error', {title, content});
    }
};

export default Dialogs;
