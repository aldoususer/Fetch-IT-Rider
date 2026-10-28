'use client';
import { useEffect, useState } from 'react';
export type LocalDemoInfo = { enabled: boolean; riderUrl?: string; adminUrl?: string };
export function useLocalDemo() {
  const [lab, setLab] = useState<LocalDemoInfo>({ enabled: false });
  useEffect(() => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
    const controller = new AbortController();
    void fetch('/api/local-demo', { cache: 'no-store', signal: controller.signal }).then(r => r.ok ? r.json() : { enabled: false }).then(value => { if (!controller.signal.aborted) setLab(value); }).catch(() => {});
    return () => controller.abort();
  }, []);
  return lab;
}
