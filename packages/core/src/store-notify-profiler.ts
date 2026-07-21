export type NotifyProfile = {
    listenerCount: number;
    timedCalls: number;
    timedTotalMs: number;
    maxMs: number;
    top5Ms: number[];
};

type ProfileCollection = {
    durations: number[];
};

type InstrumentableStore = {
    subscribe: (...args: never[]) => unknown;
};

let activeListenerCount = 0;
let currentProfile: ProfileCollection | null = null;
const instrumentedStores = new WeakSet<object>();

const now = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

export const instrumentStoreSubscribe = <TStore extends InstrumentableStore>(
    api: TStore,
): void => {
    if (instrumentedStores.has(api)) return;

    const originalSubscribe = api.subscribe as unknown as (
        ...args: unknown[]
    ) => unknown;
    const subscribe = function (this: unknown, ...args: unknown[]): unknown {
        const subscribeArgs =
            args.length === 1 && typeof args[0] === 'function'
                ? [
                      function (
                          this: unknown,
                          state: unknown,
                          previousState: unknown,
                      ): unknown {
                          const listener = args[0] as (
                              this: unknown,
                              state: unknown,
                              previousState: unknown,
                          ) => unknown;
                          const profile = currentProfile;
                          if (!profile)
                              return listener.call(this, state, previousState);

                          const startedAt = now();
                          try {
                              return listener.call(this, state, previousState);
                          } finally {
                              profile.durations.push(now() - startedAt);
                          }
                      },
                  ]
                : args;
        const unsubscribe = originalSubscribe.apply(this, subscribeArgs);
        if (typeof unsubscribe !== 'function') return unsubscribe;

        activeListenerCount += 1;
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            activeListenerCount -= 1;
            unsubscribe();
        };
    };

    api.subscribe = subscribe as TStore['subscribe'];
    instrumentedStores.add(api);
};

export const beginNotifyProfile = (): void => {
    currentProfile = { durations: [] };
};

export const endNotifyProfile = (): NotifyProfile | null => {
    const profile = currentProfile;
    if (!profile) return null;
    currentProfile = null;

    profile.durations.sort((left, right) => right - left);
    return {
        listenerCount: activeListenerCount,
        timedCalls: profile.durations.length,
        timedTotalMs: profile.durations.reduce(
            (total, duration) => total + duration,
            0,
        ),
        maxMs: profile.durations[0] ?? 0,
        top5Ms: profile.durations.slice(0, 5),
    };
};
