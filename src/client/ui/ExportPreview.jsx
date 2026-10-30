import React from 'react';
import I18 from '../utils/I18';

class ExportPreview extends React.Component {
    constructor(props) {
        super(props);
        const width = Math.min(860, window.innerWidth - 32);
        const height = Math.min(600, window.innerHeight - 32);
        this.state = {left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2, width, height, fileIndex: 0};
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    componentDidMount() {
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        this.previousFocus = document.activeElement;
        this.refs.dialog.focus();
    }

    componentWillUnmount() {
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        if (this.previousFocus && this.previousFocus.isConnected) this.previousFocus.focus();
    }

    onKeyDown(event) {
        event.stopPropagation();
        if (event.key === 'Escape') this.props.onClose();
        if (event.key !== 'Tab') return;
        const dialog = this.refs.dialog;
        const controls = Array.from(dialog.querySelectorAll('button, select, [tabindex="0"]'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialog)) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && (active === last || active === dialog)) {
            event.preventDefault();
            first.focus();
        }
    }

    startResize(direction, event) {
        if (event.button !== 0) return;
        event.preventDefault();
        this.interaction = {direction, x: event.clientX, y: event.clientY, ...this.state};
    }

    onMouseUp() {
        this.interaction = null;
    }

    onMouseMove(event) {
        const start = this.interaction;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        const right = start.left + start.width;
        const bottom = start.top + start.height;
        const minWidth = Math.min(320, window.innerWidth - 16);
        const minHeight = Math.min(180, window.innerHeight - 16);
        let {left, top, width, height} = start;
        if (start.direction === 'move') {
            left = Math.max(8, Math.min(window.innerWidth - width - 8, start.left + dx));
            top = Math.max(8, Math.min(window.innerHeight - height - 8, start.top + dy));
        }
        else {
            if (start.direction.includes('w')) {
                left = Math.max(8, Math.min(right - minWidth, start.left + dx));
                width = right - left;
            }
            if (start.direction.includes('e')) width = Math.max(minWidth, Math.min(window.innerWidth - left - 8, start.width + dx));
            if (start.direction.includes('n')) {
                top = Math.max(8, Math.min(bottom - minHeight, start.top + dy));
                height = bottom - top;
            }
            if (start.direction.includes('s')) height = Math.max(minHeight, Math.min(window.innerHeight - top - 8, start.height + dy));
        }
        this.setState({left, top, width, height});
    }

    render() {
        const {left, top, width, height, fileIndex} = this.state;
        const file = this.props.files[fileIndex];
        return (
            <div className="export-preview-overlay" onKeyDown={event => this.onKeyDown(event)}>
                <div ref="dialog" className="export-preview-window border-color-gray" role="dialog" aria-modal="true" aria-label={I18.f('EXPORT_PREVIEW')} tabIndex={-1} style={{left, top, width, height}}>
                    <div className="export-preview-header back-800 color-white" onMouseDown={event => this.startResize('move', event)}>
                        <span>{I18.f('EXPORT_PREVIEW')}</span>
                        <button type="button" className="export-preview-close" aria-label={I18.f('CLOSE')} onMouseDown={event => event.stopPropagation()} onClick={this.props.onClose}>×</button>
                    </div>
                    <div className="export-preview-toolbar">
                        {this.props.files.length > 1 ? <select aria-label={I18.f('SELECT_DATA_FILE')} value={fileIndex} onChange={event => this.setState({fileIndex: Number(event.target.value)})}>
                            {this.props.files.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
                        </select> : <span>{file.name}</span>}
                    </div>
                    <pre className="export-preview-content" tabIndex={0}>{file.content}</pre>
                    {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(direction => <div key={direction} className={'export-preview-resize resize-' + direction} onMouseDown={event => this.startResize(direction, event)}/>)}
                </div>
            </div>
        );
    }
}

export default ExportPreview;
