import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

// Live job feed backed by a single persistent WebSocket to /ws.
// The server emits { type:"job", event:"start"|"log"|"end", ... } messages
// (see core/api/server.js runJob). Also folds in legacy "deploy-log" frames so
// the restart flow shows up as a job too.

const JobsContext = createContext({ jobs: [], clearDone: () => {} });

const MAX_LOG_LINES = 500; // ponytail: cap per-job log so a chatty npm run can't grow unbounded

export function JobsProvider({ children }) {
  const [jobs, setJobs] = useState([]); // newest first
  const wsRef = useRef(null);
  const retryRef = useRef(null);

  const upsert = useCallback((id, updater) => {
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === id);
      if (idx === -1) return prev;
      const next = prev.slice();
      next[idx] = updater(next[idx]);
      return next;
    });
  }, []);

  const handleMessage = useCallback((raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // bot-restart event from the watchdog — runs in background so the
    // HTTP restart call returns immediately without timeout.
    if (msg.type === 'bot-restart') {
      if (msg.status === 'started') {
        setJobs((prev) => {
          if (prev.some((j) => j.id === '__restart__')) return prev;
          return [{ id: '__restart__', label: 'Restarting bot…', kind: 'restart', status: 'running', log: [], expanded: false }, ...prev];
        });
      } else if (msg.status === 'complete') {
        upsert('__restart__', (j) => ({ ...j, status: 'done', label: 'Bot restarted — reload to see changes', action: 'reload' }));
      } else if (msg.status === 'failed') {
        upsert('__restart__', (j) => ({ ...j, status: 'failed', error: msg.error || 'Restart failed' }));
      }
      return;
    }

    // Legacy deploy-log frames → single synthetic "deploy" job.
    const payload = msg.payload || msg;
    if (msg.type === 'install-log' && payload?.type === 'deploy-log') {
      setJobs((prev) => {
        const existing = prev.find((j) => j.id === '__deploy__' && j.status === 'running');
        if (existing) {
          return prev.map((j) => j.id === '__deploy__'
            ? { ...j, log: [...j.log, payload.message].slice(-MAX_LOG_LINES) }
            : j);
        }
        return [{ id: '__deploy__', label: 'Deploy & restart', kind: 'restart', status: 'running', log: [payload.message], expanded: false }, ...prev];
      });
      return;
    }

    if (msg.type !== 'job') return;

    if (msg.event === 'start') {
      setJobs((prev) => {
        if (prev.some((j) => j.id === msg.job.id)) return prev;
        return [{ ...msg.job, status: 'running', log: [], expanded: false }, ...prev];
      });
    } else if (msg.event === 'log') {
      upsert(msg.id, (j) => ({ ...j, log: [...j.log, msg.message].slice(-MAX_LOG_LINES) }));
    } else if (msg.event === 'end') {
      upsert(msg.id, (j) => ({
        ...j,
        status: msg.ok ? 'done' : 'failed',
        error: msg.error || null,
      }));
    }
  }, [upsert]);

  useEffect(() => {
    let closed = false;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try {
        ws = new window.WebSocket(`${proto}://${window.location.host}/ws`);
      } catch {
        retryRef.current = setTimeout(connect, 3000);
        return;
      }
      wsRef.current = ws;
      ws.onmessage = (ev) => handleMessage(ev.data);
      ws.onclose = () => {
        if (!closed) retryRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    connect();
    return () => {
      closed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } }
    };
  }, [handleMessage]);

  const clearDone = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === 'running'));
  }, []);

  const toggleExpand = useCallback((id) => {
    upsert(id, (j) => ({ ...j, expanded: !j.expanded }));
  }, [upsert]);

  return (
    <JobsContext.Provider value={{ jobs, clearDone, toggleExpand }}>
      {children}
    </JobsContext.Provider>
  );
}

export function useJobs() {
  return useContext(JobsContext);
}
