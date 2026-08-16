import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { nativeSessionWebSocketUrl } from '@/bff/client';
import { nativeTerminalThemes } from '@/app/theme/tokens';
import { useUiStore } from '@/stores/useUiStore';
import { nativeSessionCapability } from './capability';
import { nativeTerminalTypography } from './terminalTypography';

interface Props { sessionId: string; onExit: (exitCode: number) => void; onConnected: () => void; onConnectionLost: () => void; reconnectNonce: number; }
const RETAINED_OUTPUT_TRUNCATION_MARKER = '[Earlier terminal output was truncated; showing the retained tail.]';

/** xterm owns the entire workbench canvas; no chat/card wrapper sits around it. */
export function NativeTerminal({ sessionId, onExit, onConnected, onConnectionLost, reconnectNonce }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const refit = useRef<(() => void) | undefined>(undefined);
  const xterm = useRef<Terminal | undefined>(undefined);
  const themeMode = useUiStore((state) => state.themeMode);
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    const capability = nativeSessionCapability(sessionId);
    if (!capability || !mount.current) { setMessage('This browser session does not have the capability to attach to this terminal.'); return undefined; }
    let socket: WebSocket | undefined;
    let connected = false;
    let disposed = false;
    let receivedExit = false;
    const terminal = new Terminal({
      cursorBlink: true, convertEol: true, ...nativeTerminalTypography,
      theme: nativeTerminalThemes[themeMode],
    });
    xterm.current = terminal;
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(mount.current); terminal.focus();
    let previousWidth = -1; let previousHeight = -1;
    let previousColumns = -1; let previousRows = -1;
    const resize = ({ forceFit = false, sync = false }: { forceFit?: boolean; sync?: boolean } = {}) => {
      const rect = mount.current?.getBoundingClientRect();
      const geometryChanged = rect && (rect.width !== previousWidth || rect.height !== previousHeight);
      if (!rect || (!forceFit && !geometryChanged)) return;
      previousWidth = rect.width; previousHeight = rect.height; fit.fit();
      const terminalSizeChanged = terminal.cols !== previousColumns || terminal.rows !== previousRows;
      previousColumns = terminal.cols; previousRows = terminal.rows;
      if (connected && socket?.readyState === WebSocket.OPEN && (sync || terminalSizeChanged)) socket.send(JSON.stringify({ type: 'resize', columns: terminal.cols, rows: terminal.rows }));
    };
    const observer = new ResizeObserver(() => resize()); observer.observe(mount.current);
    const refitTerminal = () => resize({ forceFit: true });
    refit.current = refitTerminal;
    void document.fonts?.ready.then(() => { if (!disposed) resize({ forceFit: true }); });
    const input = terminal.onData((data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })); });
    socket = new WebSocket(nativeSessionWebSocketUrl(sessionId, capability));
    socket.onopen = () => { connected = true; setMessage(undefined); onConnected(); resize({ forceFit: true, sync: true }); terminal.focus(); };
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as { type?: unknown; data?: unknown; exitCode?: unknown; truncated?: unknown };
        if (frame.type === 'replay' && frame.truncated === true) terminal.writeln(`\r\n${RETAINED_OUTPUT_TRUNCATION_MARKER}\r\n`);
        if (frame.type === 'data' && typeof frame.data === 'string') terminal.write(frame.data);
        if (frame.type === 'exit' && typeof frame.exitCode === 'number') { receivedExit = true; terminal.writeln(`\r\n[session exited: ${frame.exitCode}]`); onExit(frame.exitCode); }
      } catch { /* malformed terminal frames are deliberately ignored */ }
    };
    socket.onerror = () => { if (!disposed) { setMessage('The terminal connection was lost.'); onConnectionLost(); } };
    socket.onclose = () => { if (!disposed && !receivedExit) { setMessage('The terminal connection was closed.'); onConnectionLost(); } };
    return () => { disposed = true; if (xterm.current === terminal) xterm.current = undefined; if (refit.current === refitTerminal) refit.current = undefined; input.dispose(); observer.disconnect(); socket?.close(); terminal.dispose(); };
  }, [sessionId, reconnectNonce, onExit, onConnected, onConnectionLost]);
  useEffect(() => {
    if (xterm.current) xterm.current.options.theme = nativeTerminalThemes[themeMode];
    refit.current?.();
  }, [themeMode]);
  return <div className="sessions-terminal-wrap">
    {message ? <div className="sessions-terminal-message" role="status">{message}</div> : null}
    <div ref={mount} className="sessions-terminal" aria-label="Native agent terminal" tabIndex={-1} />
  </div>;
}
