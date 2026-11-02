/**
 * A minimal external store for the React UI. The game loop writes; components
 * read through useSyncExternalStore. HUD updates are throttled by the game to
 * ten a second — a React render per animation frame for the health bar alone
 * would cost more than the world does.
 */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  private snapshot: T;
  constructor(initial: T) {
    this.snapshot = initial;
  }
  get = (): T => this.snapshot;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  set(patch: Partial<T>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }
}
