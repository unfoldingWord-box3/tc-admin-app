// The time, ticking every half minute, so an age label ("3 minutes ago") stays true while the page is open (P3, #26).

import { useEffect, useState } from 'react';

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}
