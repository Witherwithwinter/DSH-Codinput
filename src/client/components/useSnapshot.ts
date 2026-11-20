/** React 桥：HostObservable（getSnapshot + subscribe）→ useSyncExternalStore。 */

import { useCallback, useSyncExternalStore } from 'react';
import type { HostObservable } from '../host-types';

export function useSnapshot<T>(source: HostObservable<T> | undefined): T | undefined {
  const subscribe = useCallback(
    (fn: () => void) => (source ? source.subscribe(fn) : () => {}),
    [source],
  );
  const getSnapshot = useCallback(() => source?.getSnapshot(), [source]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
