/* global Blob,URL,requestAnimationFrame */
import React from 'react';
import Color from 'color';
import uuid from 'uuid';
import hterm from '../hterm';
import Component from '../component';
import getColorList from '../utils/colors';
import notify from '../utils/notify';

export default class Term extends Component {

  constructor(props) {
    super(props);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleScrollEnter = this.handleScrollEnter.bind(this);
    this.handleScrollLeave = this.handleScrollLeave.bind(this);
    this.handleFocus = this.handleFocus.bind(this);
    props.ref_(this);
  }

  componentDidMount() {
    const {props} = this;
    this.term = props.term || new hterm.Terminal(uuid.v4());

    // the first term that's created has unknown size
    // subsequent new tabs have size
    if (props.cols && props.rows) {
      this.term.realizeSize_(props.cols, props.rows);
    }

    const prefs = this.term.getPrefs();

    prefs.set('font-family', props.fontFamily);
    prefs.set('font-size', props.fontSize);
    prefs.set('font-smoothing', props.fontSmoothing);
    prefs.set('cursor-color', this.validateColor(props.cursorColor, 'rgba(255,255,255,0.5)'));
    prefs.set('enable-clipboard-notice', false);
    prefs.set('foreground-color', props.foregroundColor);
    prefs.set('background-color', 'transparent');
    prefs.set('color-palette-overrides', getColorList(props.colors));
    prefs.set('user-css', this.getStylesheet(props.customCSS));
    prefs.set('scrollbar-visible', false);
    prefs.set('receive-encoding', 'raw');
    prefs.set('send-encoding', 'raw');
    prefs.set('alt-sends-what', 'browser-key');

    if (props.bell === 'SOUND') {
      prefs.set('audible-bell-sound', this.props.bellSoundURL);
    } else {
      prefs.set('audible-bell-sound', '');
    }

    if (props.copyOnSelect) {
      prefs.set('copy-on-select', true);
    } else {
      prefs.set('copy-on-select', false);
    }

    this.term.onTerminalReady = () => {
      const io = this.term.io.push();
      io.onVTKeystroke = io.sendString = props.onData;
      io.onTerminalResize = (cols, rows) => {
        if (cols !== this.props.cols || rows !== this.props.rows) {
          props.onResize(cols, rows);
        }
      };

      this.term.modifierKeys = props.modifierKeys;
      // this.term.CursorNode_ is available at this point.
      this.term.setCursorShape(props.cursorShape);

      // emit onTitle event when hterm instance
      // wants to set the title of its tab
      this.term.setWindowTitle = props.onTitle;
    };
    this.term.decorate(this.termRef);
    this.term.installKeyboard();
    if (this.props.onTerminal) {
      this.props.onTerminal(this.term);
    }

    const iframeWindow = this.getTermDocument().defaultView;
    iframeWindow.addEventListener('wheel', this.handleWheel);

    this.getScreenNode().addEventListener('focus', this.handleFocus);
  }

  handleWheel(e) {
    if (this.props.onWheel) {
      this.props.onWheel(e);
    }
    const prefs = this.term.getPrefs();
    prefs.set('scrollbar-visible', true);
    clearTimeout(this.scrollbarsHideTimer);
    if (!this.scrollMouseEnter) {
      this.scrollbarsHideTimer = setTimeout(() => {
        prefs.set('scrollbar-visible', false);
      }, 1000);
    }
  }

  handleScrollEnter() {
    clearTimeout(this.scrollbarsHideTimer);
    const prefs = this.term.getPrefs();
    prefs.set('scrollbar-visible', true);
    this.scrollMouseEnter = true;
  }

  handleScrollLeave() {
    const prefs = this.term.getPrefs();
    prefs.set('scrollbar-visible', false);
    this.scrollMouseEnter = false;
  }

  handleFocus() {
    // This will in turn result in `this.focus()` being
    // called, which is unecessary.
    // Should investigate if it matters.
    this.props.onActive();
  }

  write(data) {
    this.term.io.writeUTF8(data);
  }

  focus() {
    this.term.focus();
  }

  clear() {
    this.term.clearPreserveCursorRow();

    // If cursor is still not at the top, a command is probably
    // running and we'd like to delete the whole screen.
    // Move cursor to top
    if (this.term.getCursorRow() !== 0) {
      this.term.io.writeUTF8('\x1B[0;0H\x1B[2J');
    }
  }

  moveWordLeft() {
    this.term.onVTKeystroke('\x1bb');
  }

  moveWordRight() {
    this.term.onVTKeystroke('\x1bf');
  }

  deleteWordLeft() {
    this.term.onVTKeystroke('\x1b\x7f');
  }

  deleteWordRight() {
    this.term.onVTKeystroke('\x1bd');
  }

  deleteLine() {
    this.term.onVTKeystroke('\x1bw');
  }

  moveToStart() {
    this.term.onVTKeystroke('\x01');
  }

  moveToEnd() {
    this.term.onVTKeystroke('\x05');
  }

  selectAll() {
    this.term.selectAll();
  }

  getScreenNode() {
    return this.term.scrollPort_.getScreenNode();
  }

  getTermDocument() {
    return this.term.document_;
  }

  getStylesheet(css) {
    const blob = new Blob([`
      .cursor-node[focus="false"] {
        border-width: 1px !important;
      }
      ${css}
    `], {type: 'text/css'});
    return URL.createObjectURL(blob);
  }

  validateColor(color, alternative = 'rgb(255,255,255)') {
    try {
      return Color(color).rgbString();
    } catch (err) {
      notify(`color "${color}" is invalid`);
    }
    return alternative;
  }

  handleMouseDown(ev) {
    // we prevent losing focus when clicking the boundary
    // wrappers of the main terminal element
    if (ev.target === this.termWrapperRef ||
        ev.target === this.termRef) {
      ev.preventDefault();
    }
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.url !== nextProps.url) {
      // when the url prop changes, we make sure
      // the terminal starts or stops ignoring
      // key input so that it doesn't conflict
      // with the <webview>
      if (nextProps.url) {
        const io = this.term.io.push();
        io.onVTKeystroke = io.sendString = str => {
          if (str.length === 1 && str.charCodeAt(0) === 3 /* Ctrl + C */) {
            this.props.onURLAbort();
          }
        };
      } else {
        this.term.io.pop();
      }
    }

    if (!this.props.cleared && nextProps.cleared) {
      this.clear();
    }

    const prefs = this.term.getPrefs();

    if (this.props.fontSize !== nextProps.fontSize) {
      prefs.set('font-size', nextProps.fontSize);
    }

    if (this.props.foregroundColor !== nextProps.foregroundColor) {
      prefs.set('foreground-color', nextProps.foregroundColor);
    }

    if (this.props.fontFamily !== nextProps.fontFamily) {
      prefs.set('font-family', nextProps.fontFamily);
    }

    if (this.props.fontSmoothing !== nextProps.fontSmoothing) {
      prefs.set('font-smoothing', nextProps.fontSmoothing);
    }

    if (this.props.cursorColor !== nextProps.cursorColor) {
      prefs.set('cursor-color', this.validateColor(nextProps.cursorColor, 'rgba(255,255,255,0.5)'));
    }

    if (this.props.cursorShape !== nextProps.cursorShape) {
      this.term.setCursorShape(nextProps.cursorShape);
    }

    if (this.props.colors !== nextProps.colors) {
      prefs.set('color-palette-overrides', getColorList(nextProps.colors));
    }

    if (this.props.customCSS !== nextProps.customCSS) {
      prefs.set('user-css', this.getStylesheet(nextProps.customCSS));
    }

    if (this.props.bell === 'SOUND') {
      prefs.set('audible-bell-sound', this.props.bellSoundURL);
    } else {
      prefs.set('audible-bell-sound', '');
    }

    if (this.props.copyOnSelect) {
      prefs.set('copy-on-select', true);
    } else {
      prefs.set('copy-on-select', false);
    }
  }

  componentWillUnmount() {
    clearTimeout(this.scrollbarsHideTimer);
    this.props.ref_(null);
  }

  template(css) {
    return (<div
      ref={component => {
        this.termWrapperRef = component;
      }}
      className={css('fit')}
      onMouseDown={this.handleMouseDown}
      style={{padding: this.props.padding}}
      >
      { this.props.customChildrenBefore }
      <div
        ref={component => {
          this.termRef = component;
        }}
        className={css('fit', 'term')}
        />
      { this.props.url ?
        <webview
          src={this.props.url}
          onFocus={this.handleFocus}
          style={{
            background: '#fff',
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'inline-flex',
            width: '100%',
            height: '100%'
          }}
          /> :
            <div
              className={css('scrollbarShim')}
              onMouseEnter={this.handleScrollEnter}
              onMouseLeave={this.handleScrollLeave}
              />
      }
      { this.props.customChildren }
    </div>);
  }

  styles() {
    return {
      fit: {
        display: 'block',
        width: '100%',
        height: '100%'
      },

      term: {
        position: 'relative'
      },

      scrollbarShim: {
        position: 'fixed',
        right: 0,
        width: '50px',
        top: 0,
        bottom: 0,
        pointerEvents: 'none'
      }
    };
  }

}
