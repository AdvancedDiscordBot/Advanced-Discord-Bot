import { useEffect, useState, useCallback } from 'react';

export function useApi(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await window.fetch(url);
        if (!res.ok) throw new Error('Request failed');
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();

    return () => { cancelled = true; };
  }, [url, revision]);

  const refetch = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  return { data, loading, error, refetch };
}

export function useApiFetch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (url, options = {}) => {
    setLoading(true);
    setError(null);
    try {
      // Only advertise a JSON body when we actually send one — Fastify's JSON
      // parser 400s on an empty body when Content-Type is application/json,
      // which broke every bodyless POST (reload, restart, unload).
      const headers = { ...(options.headers || {}) };
      if (options.body != null) headers['Content-Type'] = 'application/json';

      const res = await window.fetch(url, { ...options, headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Request failed');
      }
      const data = await res.json();
      setLoading(false);
      return data;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);

  return { request, loading, error };
}
