import React from 'react';
import {GLOBAL_EVENT, Observer} from "../Observer";

class ImagesTree extends React.Component {
    
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <TreePart data={this.props.data} reveal={this.props.reveal} />
        );
    }
}

class TreePart extends React.Component {

    constructor(props) {
        super(props);
    }

    render() {
        if(!this.props.data || !this.props.data.items.length) {
            return (<span>&nbsp;</span>);
        }

        return (
            <div>
                {this.props.data.items.map((item) => {

                    let key = item.path;

                    if(item.isFolder) {

                        return (
                            <TreeView key={"tree-folder-" + key} data={item} reveal={this.props.reveal}>
                                <TreePart data={item} reveal={this.props.reveal}/>
                            </TreeView>
                        );
                    }

                    return (
                        <TreeItem key={"tree-item-" + key} data={item}/>
                    );
                })}
            </div>
        );
    }
}

class TreeItem extends React.Component {

    constructor(props) {
        super(props);
        
        this.onSelect = this.onSelect.bind(this);
    }

    onSelect(e) {
        Observer.emit(GLOBAL_EVENT.IMAGE_ITEM_SELECTED, {
            isFolder: false,
            path: this.props.data.path,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey
        });
        
        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    render() {
        return (
            <div data-image-path={this.props.data.path} className={"image-list-item" + (this.props.data.img.selected ? " back-400" : "") + (this.props.data.img.current ? " image-list-item-current" : "")} onClick={this.onSelect} >
                <div className="image-list-image-container">
                    <img src={this.props.data.img.src} className="image-list-image" />
                </div>
                <div className="image-list-name-container">
                    {this.props.data.name}
                </div>
            </div>
        );
    }
}

class TreeView extends React.Component {

    constructor(props) {
        super(props);

        this.handleClick = this.handleClick.bind(this);
        this.handleCollapse = this.handleCollapse.bind(this);

        this.state = {
            collapsed: this.props.defaultCollapsed
        };
    }

    componentWillReceiveProps(nextProps) {
        if (nextProps.reveal && nextProps.reveal !== this.props.reveal &&
            nextProps.reveal.path.startsWith(nextProps.data.path + "/")) {
            this.setState({collapsed: false});
        }
    }

    handleCollapse(e) {
        this.setState({collapsed: !this.state.collapsed});
        
        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    handleClick(e) {
        Observer.emit(GLOBAL_EVENT.IMAGE_ITEM_SELECTED, {
            isFolder: true,
            path: this.props.data.path,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey
        });

        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    render() {
        let collapsed = this.state.collapsed;
        let label = this.props.data.name;
        let children = this.props.children;

        let arrowClass = 'tree-view-arrow';
        let containerClass = 'tree-view-children';
        if (collapsed) {
            arrowClass += ' tree-view-arrow-collapsed';
            containerClass += ' tree-view-children-collapsed';
        }

        let arrow = (<div className={arrowClass} onClick={this.handleCollapse}/>);
        let folderIcon = (<div className="tree-view-folder"></div>);

        return (
            <div className="tree-view" onClick={this.handleClick}>
                <div className={'tree-view-item' + (this.props.data.selected ? " back-400" : "")}>
                    {arrow}
                    {folderIcon}
                    {label}
                </div>
                <div className={containerClass}>
                    {children}
                </div>
            </div>
        );
    }
}

export default ImagesTree;