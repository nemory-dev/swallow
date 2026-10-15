import { createContext, useContext, useEffect, useRef } from 'react';

export const UpdatePreparationContext = createContext<Set<() => Promise<void>> | null>(null);

/** Every mounted editor can veto a restart or persist its current input first. */
export function useUpdatePreparation(prepare: () => Promise<void>): void {
  const preparations = useContext(UpdatePreparationContext);
  const latest = useRef(prepare); latest.current = prepare;
  useEffect(() => {
    const save = () => latest.current();
    preparations?.add(save);
    return () => { preparations?.delete(save); };
  }, [preparations]);
}
