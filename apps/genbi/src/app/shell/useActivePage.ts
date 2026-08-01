import { useLocation } from 'react-router-dom';
import { pages } from '../registry';
import type { PageDef } from './types';

/** The PageDef whose path prefixes the current location (longest match wins). */
export function useActivePage(): PageDef | undefined {
  const { pathname } = useLocation();
  return [...pages]
    .sort((a, b) => b.path.length - a.path.length)
    .find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`));
}
