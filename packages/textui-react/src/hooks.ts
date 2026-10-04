import { createContext, useContext, useSyncExternalStore, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StateValue, TextUIStore } from '@mineral/textui';
export const StoreContext = createContext<TextUIStore | null>(null);
type Widen<T> = T extends string ? string : T extends number ? number : T extends null ? number|null : boolean;
export function useTextState<T extends StateValue>(key: string, initialValue: T): [Widen<T>, Dispatch<SetStateAction<Widen<T>>>];
export function useTextState(key: string, initialValue: StateValue): [StateValue, Dispatch<SetStateAction<StateValue>>] {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useTextState 必须在 TextUI render 中使用。');
  const value = useSyncExternalStore(store.subscribe, () => store.get(key, initialValue));
  const set = useCallback<Dispatch<SetStateAction<StateValue>>>(update => {
    store.set(key, typeof update === 'function' ? update(store.get(key, initialValue)) : update);
  }, [store, key, initialValue]);
  return [value, set];
}
