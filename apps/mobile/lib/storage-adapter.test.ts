import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Task } from '@mindwtr/core';

const {
  asyncStorageMock,
  localStorageMock,
  logWarnMock,
  sqliteAdapterSaveTask,
  updateMobileWidgetFromDataMock,
  appStateListeners,
} = vi.hoisted(() => ({
  asyncStorageMock: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  localStorageMock: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  logWarnMock: vi.fn(),
  sqliteAdapterSaveTask: vi.fn(),
  updateMobileWidgetFromDataMock: vi.fn(),
  appStateListeners: [] as Array<(state: string) => void>,
}));

vi.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    appOwnership: 'standalone',
  },
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      OS: 'android',
    },
    NativeModules: {
      ...actual.NativeModules,
      OPSQLite: { install: vi.fn(() => true) },
    },
    AppState: {
      currentState: 'active',
      addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
        appStateListeners.push(listener);
        return { remove: vi.fn() };
      }),
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: asyncStorageMock,
}));

vi.mock('./widget-service', () => ({
  updateMobileWidgetFromData: updateMobileWidgetFromDataMock,
}));

vi.mock('./app-log', () => ({
  logError: vi.fn(),
  logWarn: logWarnMock,
  logInfo: vi.fn(),
}));

vi.mock('./startup-profiler', () => ({
  markStartupPhase: vi.fn(),
  measureStartupPhase: vi.fn(async (_name: string, work: () => Promise<unknown>) => work()),
}));

describe('mobile storage adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    appStateListeners.length = 0;
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue(undefined);
    sqliteAdapterSaveTask.mockResolvedValue(undefined);
    updateMobileWidgetFromDataMock.mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: localStorageMock },
    });
  });

  afterEach(async () => {
    // beforeEach's resetModules orphans this test's module instance, but any
    // coalesced-backup timer it armed keeps running and would write the backup
    // (and its version marker) through the SHARED AsyncStorage mock into a
    // LATER test's stored map — the load-dependent cross-test failure seen in
    // CI. Reset the instance while it is still importable to disarm the timer.
    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    __mobileStorageTestUtils.reset();
  });

  it('uses the JSON fallback without loading op-sqlite when the native module is absent', async () => {
    const { NativeModules } = await import('react-native');
    const nativeModules = NativeModules as typeof NativeModules & { OPSQLite?: unknown };
    const installedModule = nativeModules.OPSQLite;
    nativeModules.OPSQLite = null;
    try {
      const { mobileStorage } = await import('./storage-adapter');

      await expect(mobileStorage.getData()).resolves.toEqual({
        tasks: [],
        projects: [],
        sections: [],
        areas: [],
        people: [],
        settings: {},
      });
      expect(logWarnMock).toHaveBeenCalledWith(
        '[Storage] SQLite load failed, falling back to JSON backup',
        expect.objectContaining({
          scope: 'storage',
          extra: expect.objectContaining({
            error: 'Native SQLite module unavailable; rebuild or reinstall the app so op-sqlite is included',
          }),
        }),
      );
    } finally {
      nativeModules.OPSQLite = installedModule;
    }
  }, 10_000);

  it('coalesces a burst of calendar SQLite calls when the native module is unavailable', async () => {
    const nativeModuleError = new Error('Base module not found. Did you do a pod install/clear the gradle cache?');
    const initializeSqlite = vi.fn().mockRejectedValue(nativeModuleError);
    const { getCalendarSyncEntry, __mobileStorageTestUtils } = await import('./storage-adapter');
    __mobileStorageTestUtils.setSqliteInitializerForTests(initializeSqlite);
    const calls = Array.from({ length: 8 }, (_, index) => (
      getCalendarSyncEntry(`task-${index}`, 'android')
    ));

    const results = await Promise.allSettled(calls);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(results.map((result) => (
      result.status === 'rejected' ? String(result.reason) : 'fulfilled'
    ))).toEqual(Array(8).fill('Error: Base module not found. Did you do a pod install/clear the gradle cache?'));
    expect(initializeSqlite).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('allows one new SQLite initialization after the failure cooldown', async () => {
    vi.useFakeTimers();
    try {
      const nativeModuleError = new Error('Base module not found. Did you do a pod install/clear the gradle cache?');
      const getCalendarEntry = vi.fn().mockResolvedValue(undefined);
      const initializeSqlite = vi.fn()
        .mockRejectedValueOnce(nativeModuleError)
        .mockResolvedValue({
          adapter: { getCalendarSyncEntry: getCalendarEntry },
          client: {},
        });
      const { getCalendarSyncEntry, __mobileStorageTestUtils } = await import('./storage-adapter');
      __mobileStorageTestUtils.setSqliteInitializerForTests(initializeSqlite as never);

      await expect(getCalendarSyncEntry('task-1', 'android')).rejects.toThrow('Base module not found');
      await expect(getCalendarSyncEntry('task-2', 'android')).rejects.toThrow('Base module not found');
      expect(initializeSqlite).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);

      await expect(getCalendarSyncEntry('task-3', 'android')).resolves.toBeUndefined();
      expect(initializeSqlite).toHaveBeenCalledTimes(2);
      expect(getCalendarEntry).toHaveBeenCalledWith('task-3', 'android');
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('refreshes the JSON startup backup after a successful incremental task save', async () => {
    const currentTask: Task = {
      id: 'task-current',
      title: 'Current task',
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    };
    const currentSnapshot: AppData = {
      tasks: [currentTask],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };

    const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
    if (!mobileStorage.saveTask) {
      throw new Error('Expected mobile storage to support saveTask');
    }
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: { saveTask: sqliteAdapterSaveTask },
      client: {},
    });

    await mobileStorage.saveTask(currentTask, currentSnapshot);

    expect(sqliteAdapterSaveTask).toHaveBeenCalledWith(currentTask);
    // The backup is deferred off the save path (#766): the save resolves after
    // the SQLite write, and the JSON copy lands coalesced afterwards.
    expect(asyncStorageMock.setItem).not.toHaveBeenCalledWith('mindwtr-data', expect.anything());

    await __mobileStorageTestUtils.flushPendingStartupJsonBackup();
    // Widget refresh runs on its own decoupled schedule (#766) and needs its
    // own flush.
    await __mobileStorageTestUtils.flushPendingWidgetRefresh();

    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      'mindwtr-data',
      JSON.stringify(currentSnapshot),
    );
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      'mindwtr-data:startup-backup-version',
      '2',
    );
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      'mindwtr-data:startup-backup-updated-at',
      expect.stringMatching(/^\d+$/),
    );
    expect(updateMobileWidgetFromDataMock).toHaveBeenCalledWith(currentSnapshot);
  }, 10_000);

  it('coalesces a burst of task saves into a single backup write with the newest payload (#766)', async () => {
    const makeTask = (id: string): Task => ({
      id,
      title: `Task ${id}`,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const makeSnapshot = (task: Task): AppData => ({
      tasks: [task],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    });

    const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
    if (!mobileStorage.saveTask) {
      throw new Error('Expected mobile storage to support saveTask');
    }
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: { saveTask: sqliteAdapterSaveTask },
      client: {},
    });

    const first = makeTask('task-1');
    const second = makeTask('task-2');
    const third = makeTask('task-3');
    await mobileStorage.saveTask(first, makeSnapshot(first));
    await mobileStorage.saveTask(second, makeSnapshot(second));
    await mobileStorage.saveTask(third, makeSnapshot(third));

    await __mobileStorageTestUtils.flushPendingStartupJsonBackup();
    // Widget refresh runs on its own decoupled schedule (#766) and needs its
    // own flush.
    await __mobileStorageTestUtils.flushPendingWidgetRefresh();

    const dataWrites = asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data');
    expect(dataWrites).toHaveLength(1);
    expect(dataWrites[0]?.[1]).toBe(JSON.stringify(makeSnapshot(third)));
    expect(updateMobileWidgetFromDataMock).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('throttles the JSON backup to at most one write per 5 minutes while saves keep arriving (#766)', async () => {
    const makeTask = (id: string): Task => ({
      id,
      title: `Task ${id}`,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const makeSnapshot = (task: Task): AppData => ({
      tasks: [task],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
      const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
      if (!mobileStorage.saveTask) {
        throw new Error('Expected mobile storage to support saveTask');
      }
      __mobileStorageTestUtils.setSqliteStateForTests({
        adapter: { saveTask: sqliteAdapterSaveTask },
        client: {},
      });

      const first = makeTask('task-first');
      await mobileStorage.saveTask(first, makeSnapshot(first));
      await vi.advanceTimersByTimeAsync(1_000);
      const writesAfterFirst = asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data');
      expect(writesAfterFirst).toHaveLength(1);

      // Keep saving well inside the 5-minute throttle window (~50s of churn).
      let lastChurnTask = first;
      for (let index = 0; index < 5; index += 1) {
        lastChurnTask = makeTask(`task-churn-${index}`);
        await mobileStorage.saveTask(lastChurnTask, makeSnapshot(lastChurnTask));
        await vi.advanceTimersByTimeAsync(10_000);
      }
      const writesDuringChurn = asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data');
      expect(writesDuringChurn).toHaveLength(1);

      // Advance past the remainder of the 5-minute window; the newest pending
      // payload lands in a single second write.
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      const finalWrites = asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data');
      expect(finalWrites).toHaveLength(2);
      expect(finalWrites[1]?.[1]).toBe(JSON.stringify(makeSnapshot(lastChurnTask)));
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('flushPendingStartupJsonBackup writes the newest payload immediately during the throttle window (#766)', async () => {
    const makeTask = (id: string): Task => ({
      id,
      title: `Task ${id}`,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const makeSnapshot = (task: Task): AppData => ({
      tasks: [task],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
      const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
      if (!mobileStorage.saveTask) {
        throw new Error('Expected mobile storage to support saveTask');
      }
      __mobileStorageTestUtils.setSqliteStateForTests({
        adapter: { saveTask: sqliteAdapterSaveTask },
        client: {},
      });

      const first = makeTask('task-first');
      await mobileStorage.saveTask(first, makeSnapshot(first));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data')).toHaveLength(1);

      const second = makeTask('task-second');
      await mobileStorage.saveTask(second, makeSnapshot(second));
      // Still well inside the throttle window; no timer has fired yet.
      expect(asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data')).toHaveLength(1);

      await __mobileStorageTestUtils.flushPendingStartupJsonBackup();

      const writes = asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data');
      expect(writes).toHaveLength(2);
      expect(writes[1]?.[1]).toBe(JSON.stringify(makeSnapshot(second)));
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('flushPendingStartupJsonBackup drains a payload that arrives while an earlier write is still in flight (#766)', async () => {
    const makeTask = (id: string): Task => ({
      id,
      title: `Task ${id}`,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const makeSnapshot = (task: Task): AppData => ({
      tasks: [task],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    });

    const stored = new Map<string, string>();
    let resolveFirstDataWrite: (() => void) | undefined;
    let firstDataWriteStarted = false;
    asyncStorageMock.getItem.mockImplementation(async (key: string) => stored.get(key) ?? null);
    // Stall only the FIRST write to the data key so we can inject a
    // concurrent save while it's still in flight, then let it land.
    asyncStorageMock.setItem.mockImplementation((key: string, value: string) => {
      if (key === 'mindwtr-data' && !firstDataWriteStarted) {
        firstDataWriteStarted = true;
        return new Promise<void>((resolve) => {
          resolveFirstDataWrite = () => {
            stored.set(key, value);
            resolve();
          };
        });
      }
      stored.set(key, value);
      return Promise.resolve();
    });

    const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
    if (!mobileStorage.saveTask) {
      throw new Error('Expected mobile storage to support saveTask');
    }
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: { saveTask: sqliteAdapterSaveTask },
      client: {},
    });

    const first = makeTask('task-first');
    await mobileStorage.saveTask(first, makeSnapshot(first));

    const flushPromise = __mobileStorageTestUtils.flushPendingStartupJsonBackup();

    // Let the first write actually start (and stall on the mocked setItem)
    // before injecting a concurrent save behind it.
    for (let index = 0; index < 10 && !firstDataWriteStarted; index += 1) {
      await Promise.resolve();
    }
    expect(firstDataWriteStarted).toBe(true);

    const second = makeTask('task-second');
    await mobileStorage.saveTask(second, makeSnapshot(second));

    let flushSettled = false;
    void flushPromise.then(() => { flushSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // The flush must not resolve until the newer payload lands too — not
    // just the one that was pending when flush was called.
    expect(flushSettled).toBe(false);

    resolveFirstDataWrite?.();
    await flushPromise;
    expect(flushSettled).toBe(true);

    expect(stored.get('mindwtr-data')).toBe(JSON.stringify(makeSnapshot(second)));

    // Exercise the exact failure mode this guards against: a fallback read
    // racing the flush must see the newest payload and its freshness stamp,
    // not be refused as stale.
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: {
        saveTask: sqliteAdapterSaveTask,
        getData: vi.fn().mockRejectedValue(new Error('database is locked')),
      } as never,
      client: {},
    });
    const data = await mobileStorage.getData();
    expect(data.tasks.map((task) => task.id)).toEqual(['task-second']);
  }, 10_000);

  it('keeps widget refresh on its short coalesce cadence while the JSON backup is throttled (#766)', async () => {
    const makeTask = (id: string): Task => ({
      id,
      title: `Task ${id}`,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const makeSnapshot = (task: Task): AppData => ({
      tasks: [task],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
      const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
      if (!mobileStorage.saveTask) {
        throw new Error('Expected mobile storage to support saveTask');
      }
      __mobileStorageTestUtils.setSqliteStateForTests({
        adapter: { saveTask: sqliteAdapterSaveTask },
        client: {},
      });

      // Five saves spaced 2s apart (10s total), well inside the 5-minute
      // backup throttle window but each past the widget's 1s coalesce delay.
      for (let index = 0; index < 5; index += 1) {
        const task = makeTask(`task-${index}`);
        await mobileStorage.saveTask(task, makeSnapshot(task));
        await vi.advanceTimersByTimeAsync(2_000);
      }

      const backupWrites = asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data').length;
      expect(backupWrites).toBe(1);
      expect(updateMobileWidgetFromDataMock).toHaveBeenCalledTimes(5);
      expect(updateMobileWidgetFromDataMock.mock.calls.length).toBeGreaterThan(backupWrites);
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('flushes the pending JSON backup when the app moves to background (#766)', async () => {
    const currentTask: Task = {
      id: 'task-background',
      title: 'Background flush task',
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    };
    const currentSnapshot: AppData = {
      tasks: [currentTask],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };

    const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
    if (!mobileStorage.saveTask) {
      throw new Error('Expected mobile storage to support saveTask');
    }
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: { saveTask: sqliteAdapterSaveTask },
      client: {},
    });
    expect(appStateListeners.length).toBeGreaterThan(0);

    await mobileStorage.saveTask(currentTask, currentSnapshot);
    expect(asyncStorageMock.setItem).not.toHaveBeenCalledWith('mindwtr-data', expect.anything());

    appStateListeners.forEach((listener) => listener('background'));
    // The listener flushes fire-and-forget; give its promise chain a couple
    // of real event-loop turns to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      'mindwtr-data',
      JSON.stringify(currentSnapshot),
    );
  }, 10_000);

  it('flushes a pending deferred backup before serving a JSON fallback read (#766)', async () => {
    const stored = new Map<string, string>();
    asyncStorageMock.getItem.mockImplementation(async (key: string) => stored.get(key) ?? null);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });

    const currentTask: Task = {
      id: 'task-pending',
      title: 'Pending backup task',
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    };
    const currentSnapshot: AppData = {
      tasks: [currentTask],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };

    const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
    if (!mobileStorage.saveTask) {
      throw new Error('Expected mobile storage to support saveTask');
    }
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: {
        saveTask: sqliteAdapterSaveTask,
        // A read through this adapter fails, forcing the JSON fallback path.
        getData: vi.fn().mockRejectedValue(new Error('database is locked')),
      } as never,
      client: {},
    });

    // The save resolves with the backup still pending (deferred off the queue).
    await mobileStorage.saveTask(currentTask, currentSnapshot);
    expect(stored.has('mindwtr-data')).toBe(false);

    // The fallback read must land the pending backup first instead of refusing
    // it as stale (freshness invariant: backupUpdatedAt >= latest queued write).
    const data = await mobileStorage.getData();
    expect(data.tasks.map((task) => task.id)).toEqual(['task-pending']);
  }, 10_000);

  it('writes the JSON backup before a failed SQLite task save resolves', async () => {
    const currentTask: Task = {
      id: 'task-fallback',
      title: 'Fallback task',
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    };
    const currentSnapshot: AppData = {
      tasks: [currentTask],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };

    sqliteAdapterSaveTask.mockRejectedValue(new Error('disk I/O error'));
    const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
    if (!mobileStorage.saveTask) {
      throw new Error('Expected mobile storage to support saveTask');
    }
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: { saveTask: sqliteAdapterSaveTask },
      client: {},
    });

    await mobileStorage.saveTask(currentTask, currentSnapshot);

    // SQLite failed, so the JSON backup is the durable copy and must have
    // landed by the time the save resolves.
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      'mindwtr-data',
      JSON.stringify(currentSnapshot),
    );
  }, 10_000);

  it('waits for queued SQLite writes before reading from SQLite', async () => {
    const currentSnapshot: AppData = {
      tasks: [],
      projects: [
        {
          id: 'project-current',
          title: 'Current project',
          status: 'active',
          order: 0,
          color: '#888888',
          tagIds: [],
          createdAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
        },
      ],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    let finishSqliteWrite!: () => void;
    let writeFinished = false;
    const sqliteAdapterSaveData = vi.fn(() => new Promise<void>((resolve) => {
      finishSqliteWrite = () => {
        writeFinished = true;
        resolve();
      };
    }));
    const sqliteAdapterGetData = vi.fn(async () => {
      if (!writeFinished) {
        throw new Error('read started before queued write finished');
      }
      return currentSnapshot;
    });

    const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
    __mobileStorageTestUtils.setSqliteStateForTests({
      adapter: {
        getData: sqliteAdapterGetData,
        saveData: sqliteAdapterSaveData,
        saveTask: sqliteAdapterSaveTask,
      } as any,
      client: {},
    });

    const savePromise = mobileStorage.saveData(currentSnapshot);
    for (let index = 0; index < 5 && sqliteAdapterSaveData.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(sqliteAdapterSaveData).toHaveBeenCalledTimes(1);

    const readPromise = mobileStorage.getData();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sqliteAdapterGetData).not.toHaveBeenCalled();

    finishSqliteWrite();
    await savePromise;
    await expect(readPromise).resolves.toEqual(currentSnapshot);
    expect(sqliteAdapterGetData).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('falls back to a fresh JSON backup instead of hanging when a queued SQLite write stalls', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
      const freshBackupUpdatedAt = String(Date.now() + 1);
      const backupSnapshot: AppData = {
        tasks: [],
        projects: [
          {
            id: 'project-backup',
            title: 'Backup project',
            status: 'active',
            order: 0,
            color: '#888888',
            tagIds: [],
            createdAt: '2026-06-30T00:00:00.000Z',
            updatedAt: '2026-06-30T00:00:00.000Z',
          },
        ],
        sections: [],
        areas: [],
        people: [],
        settings: {},
      };
      asyncStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'mindwtr-data:startup-backup-updated-at') return Promise.resolve(freshBackupUpdatedAt);
        if (key === 'mindwtr-data') return Promise.resolve(JSON.stringify(backupSnapshot));
        return Promise.resolve(null);
      });

      // A SQLite write that never settles, e.g. a lost-promise native bridge call.
      const stalledSave = vi.fn(() => new Promise<void>(() => {}));
      const sqliteAdapterGetData = vi.fn(async () => {
        throw new Error('SQLite read should not run while a write is stalled');
      });

      const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
      __mobileStorageTestUtils.setSqliteStateForTests({
        adapter: {
          getData: sqliteAdapterGetData,
          saveData: stalledSave,
          saveTask: sqliteAdapterSaveTask,
        } as any,
        client: {},
      });

      void mobileStorage.saveData(backupSnapshot);
      await vi.advanceTimersByTimeAsync(0);
      expect(stalledSave).toHaveBeenCalledTimes(1);

      const readPromise = mobileStorage.getData();
      let settled = false;
      void readPromise.then(() => { settled = true; }, () => { settled = true; });

      // Advance well past the bounded wait; the read must give up waiting and fall back.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(settled).toBe(true);

      const data = await readPromise;
      expect(data.projects).toEqual(backupSnapshot.projects);
      expect(sqliteAdapterGetData).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('rejects a stale JSON backup when a queued SQLite write stalls', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
      const staleBackupUpdatedAt = String(Date.now() - 1);
      const staleBackup: AppData = {
        tasks: [],
        projects: [
          {
            id: 'project-stale-backup',
            title: 'Stale backup project',
            status: 'active',
            order: 0,
            color: '#888888',
            tagIds: [],
            createdAt: '2026-06-29T00:00:00.000Z',
            updatedAt: '2026-06-29T00:00:00.000Z',
          },
        ],
        sections: [],
        areas: [],
        people: [],
        settings: {},
      };
      asyncStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'mindwtr-data:startup-backup-updated-at') return Promise.resolve(staleBackupUpdatedAt);
        if (key === 'mindwtr-data') return Promise.resolve(JSON.stringify(staleBackup));
        return Promise.resolve(null);
      });

      const stalledSave = vi.fn(() => new Promise<void>(() => {}));
      const sqliteAdapterGetData = vi.fn(async () => staleBackup);

      const { mobileStorage, __mobileStorageTestUtils } = await import('./storage-adapter');
      __mobileStorageTestUtils.setSqliteStateForTests({
        adapter: {
          getData: sqliteAdapterGetData,
          saveData: stalledSave,
          saveTask: sqliteAdapterSaveTask,
        } as any,
        client: {},
      });

      void mobileStorage.saveData(staleBackup);
      await vi.advanceTimersByTimeAsync(0);
      expect(stalledSave).toHaveBeenCalledTimes(1);

      const readPromise = mobileStorage.getData();
      const readExpectation = expect(readPromise).rejects.toThrow('JSON backup is older than the latest queued SQLite write');
      await vi.advanceTimersByTimeAsync(6_000);

      await readExpectation;
      expect(sqliteAdapterGetData).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('runs every SQLite statement one by one on the shared op-sqlite connection', async () => {
    const executedStatements: Array<{ sql: string; args: unknown[] }> = [];
    const execute = vi.fn(async (sql: string, args: unknown[]) => {
      executedStatements.push({ sql, args });
      return { rows: [] };
    });
    const db = { execute };

    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    const { SQLITE_BASE_SCHEMA } = await import('@mindwtr/core');
    const client = __mobileStorageTestUtils.createOpSqliteClientForTests(db);
    expect(client.exec).toBeDefined();

    await client.exec?.(SQLITE_BASE_SCHEMA);
    await client.run('BEGIN IMMEDIATE');
    await client.run('INSERT INTO tasks (id) VALUES (?)', ['task-1']);
    await client.run('COMMIT');

    const statements = executedStatements.map((entry) => entry.sql);
    // Connection pragmas apply for real (a wrapper transaction would no-op them)…
    expect(statements.slice(0, 3)).toEqual([
      'PRAGMA journal_mode = WAL',
      'PRAGMA foreign_keys = ON',
      'PRAGMA busy_timeout = 5000',
    ]);
    // …the schema flows through the same direct path…
    expect(statements.some((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS tasks'))).toBe(true);
    // …and adapter-managed transactions stay intact instead of committing per statement (#766).
    expect(statements.slice(-3)).toEqual([
      'BEGIN IMMEDIATE',
      'INSERT INTO tasks (id) VALUES (?)',
      'COMMIT',
    ]);
    expect(executedStatements[executedStatements.length - 2]?.args).toEqual(['task-1']);
  }, 10_000);

  it('reconciles rc.1 JSON-only writes into SQLite without reviving older live data', async () => {
    const makeTask = (
      id: string,
      title: string,
      rev: number,
      revBy: string,
      deletedAt?: string,
    ): Task => ({
      id,
      title,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: `2026-07-16T00:00:0${rev}.000Z`,
      rev,
      revBy,
      ...(deletedAt ? { deletedAt } : {}),
    });
    const sqliteData: AppData = {
      tasks: [
        makeTask('edited-on-rc1', 'Old SQLite title', 1, 'sqlite-device'),
        makeTask('sqlite-only', 'SQLite only', 1, 'sqlite-device'),
        makeTask('deleted-before-rc1', 'Deleted', 3, 'sqlite-device', '2026-07-16T00:00:03.000Z'),
      ],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    const backupData: AppData = {
      tasks: [
        makeTask('edited-on-rc1', 'Edited while rc.1 used JSON', 2, 'rc1-device'),
        makeTask('backup-only', 'Created while rc.1 used JSON', 1, 'rc1-device'),
        makeTask('deleted-before-rc1', 'Stale live copy', 2, 'rc1-device'),
      ],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    const stored = new Map<string, string>([
      ['mindwtr-data', JSON.stringify(backupData)],
      ['mindwtr-data:startup-backup-version', '2'],
    ]);
    asyncStorageMock.getItem.mockImplementation(async (key: string) => stored.get(key) ?? null);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
    const getData = vi.fn().mockResolvedValue(sqliteData);
    const saveData = vi.fn().mockResolvedValue(undefined);

    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    await __mobileStorageTestUtils.reconcileJsonBackupIntoSqliteForTests({
      getData,
      saveData,
    } as never);

    expect(saveData).toHaveBeenCalledTimes(1);
    const merged = saveData.mock.calls[0]?.[0] as AppData;
    expect(merged.tasks.find((task) => task.id === 'edited-on-rc1')?.title)
      .toBe('Edited while rc.1 used JSON');
    expect(merged.tasks.some((task) => task.id === 'sqlite-only')).toBe(true);
    expect(merged.tasks.some((task) => task.id === 'backup-only')).toBe(true);
    expect(merged.tasks.find((task) => task.id === 'deleted-before-rc1')?.deletedAt)
      .toBe('2026-07-16T00:00:03.000Z');
    expect(stored.get('mindwtr-data:sqlite-json-reconcile-v1')).toBe('1');

    await __mobileStorageTestUtils.reconcileJsonBackupIntoSqliteForTests({
      getData,
      saveData,
    } as never);
    expect(getData).toHaveBeenCalledTimes(1);
    expect(saveData).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('treats a one-shot count failure as unknown and preserves newer SQLite rows', async () => {
    const makeTask = (id: string, title: string, rev: number, revBy: string): Task => ({
      id,
      title,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: `2026-07-21T00:00:0${rev}.000Z`,
      rev,
      revBy,
    });
    const backup: AppData = {
      tasks: [makeTask('shared', 'Stale backup title', 1, 'backup-device')],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    let sqliteData: AppData = {
      tasks: [
        makeTask('shared', 'Newer SQLite title', 2, 'sqlite-device'),
        makeTask('sqlite-only', 'SQLite only', 1, 'sqlite-device'),
      ],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    const stored = new Map<string, string>([
      ['mindwtr-data', JSON.stringify(backup)],
      ['mindwtr-data:startup-backup-version', '2'],
    ]);
    asyncStorageMock.getItem.mockImplementation(async (key: string) => stored.get(key) ?? null);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
    let failNextCount = true;
    const client = {
      get: vi.fn(async (sql: string) => {
        if (failNextCount && sql.includes('COUNT(*)')) {
          failNextCount = false;
          throw new Error('one-shot count failure');
        }
        return { count: sql.includes('FROM tasks') ? sqliteData.tasks.length : 0 };
      }),
    };
    const adapter = {
      getData: vi.fn(async () => sqliteData),
      saveData: vi.fn(async (data: AppData) => {
        sqliteData = data;
      }),
    };

    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    await __mobileStorageTestUtils.prepareSqliteDataForTests(
      adapter as never,
      client as never,
    );
    expect(adapter.getData).toHaveBeenCalledTimes(1);
    expect(adapter.saveData).toHaveBeenCalledTimes(1);
    expect(sqliteData.tasks.map((task) => task.id).sort()).toEqual(['shared', 'sqlite-only']);
    expect(sqliteData.tasks.find((task) => task.id === 'shared')?.title).toBe('Newer SQLite title');
  }, 10_000);

  it('merges a legacy backup with a fresh SQLite read before first migration', async () => {
    const makeTask = (id: string, title: string): Task => ({
      id,
      title,
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      rev: 1,
      revBy: 'device-a',
    });
    const backup: AppData = {
      tasks: [makeTask('backup-only', 'Backup only')],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    const current: AppData = {
      tasks: [makeTask('concurrent-sqlite', 'Inserted after probe')],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    const stored = new Map<string, string>([['mindwtr-data', JSON.stringify(backup)]]);
    asyncStorageMock.getItem.mockImplementation(async (key: string) => stored.get(key) ?? null);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
    const client = { get: vi.fn().mockResolvedValue({ count: 0 }) };
    const saveData = vi.fn().mockResolvedValue(undefined);

    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    await __mobileStorageTestUtils.prepareSqliteDataForTests({
      getData: vi.fn().mockResolvedValue(current),
      saveData,
    } as never, client as never);

    const migrated = saveData.mock.calls[0]?.[0] as AppData;
    expect(migrated.tasks.map((task) => task.id).sort()).toEqual(['backup-only', 'concurrent-sqlite']);
    expect(JSON.parse(stored.get('mindwtr-data') ?? '{}').tasks.map((task: Task) => task.id).sort())
      .toEqual(['backup-only', 'concurrent-sqlite']);
  }, 10_000);

  it.each(['sections', 'people', 'saved_filters'])(
    'recognizes a %s-only SQLite store as non-empty',
    async (populatedTable) => {
      const client = {
        get: vi.fn(async (sql: string) => ({ count: sql.includes(`FROM ${populatedTable}`) ? 1 : 0 })),
      };
      const { __mobileStorageTestUtils } = await import('./storage-adapter');

      await expect(__mobileStorageTestUtils.sqliteHasAnyDataForTests(client as never)).resolves.toBe(true);
    },
  );

  it('does not mark JSON reconciliation complete until the merged SQLite save succeeds', async () => {
    const stored = new Map<string, string>([
      ['mindwtr-data', JSON.stringify({
        tasks: [],
        projects: [],
        sections: [],
        areas: [],
        people: [],
        settings: {},
      } satisfies AppData)],
      ['mindwtr-data:startup-backup-version', '2'],
    ]);
    asyncStorageMock.getItem.mockImplementation(async (key: string) => stored.get(key) ?? null);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
    const saveData = vi.fn().mockRejectedValue(new Error('disk I/O error'));

    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    await expect(__mobileStorageTestUtils.reconcileJsonBackupIntoSqliteForTests({
      getData: vi.fn().mockResolvedValue({
        tasks: [],
        projects: [],
        sections: [],
        areas: [],
        people: [],
        settings: {},
      }),
      saveData,
    } as never)).rejects.toThrow('disk I/O error');

    expect(stored.has('mindwtr-data:sqlite-json-reconcile-v1')).toBe(false);
  }, 10_000);

  it('does not merge an unmarked legacy JSON snapshot into an existing SQLite store', async () => {
    const stored = new Map<string, string>([
      ['mindwtr-data', JSON.stringify({
        tasks: [{
          id: 'stale-task',
          title: 'Stale legacy task',
          status: 'next',
          tags: [],
          contexts: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        projects: [],
        sections: [],
        areas: [],
        people: [],
        settings: {},
      } satisfies AppData)],
    ]);
    asyncStorageMock.getItem.mockImplementation(async (key: string) => stored.get(key) ?? null);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
    const getData = vi.fn();
    const saveData = vi.fn();

    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    await __mobileStorageTestUtils.reconcileJsonBackupIntoSqliteForTests({
      getData,
      saveData,
    } as never);

    expect(getData).not.toHaveBeenCalled();
    expect(saveData).not.toHaveBeenCalled();
    expect(stored.get('mindwtr-data:sqlite-json-reconcile-v1')).toBe('1');
  }, 10_000);

  it('maps op-sqlite rows and binds undefined params as null', async () => {
    const executedStatements: Array<{ sql: string; args: unknown[] }> = [];
    const execute = vi.fn(async (sql: string, args: unknown[]) => {
      executedStatements.push({ sql, args });
      if (sql.startsWith('SELECT')) {
        return { rows: [{ id: 'task-1' }, { id: 'task-2' }] };
      }
      return { rows: [] };
    });
    const db = { execute };

    const { __mobileStorageTestUtils } = await import('./storage-adapter');
    const client = __mobileStorageTestUtils.createOpSqliteClientForTests(db);

    await expect(client.all('SELECT id FROM tasks')).resolves.toEqual([
      { id: 'task-1' },
      { id: 'task-2' },
    ]);
    await expect(client.get('SELECT id FROM tasks')).resolves.toEqual({ id: 'task-1' });
    await expect(client.get('UPDATE tasks SET title = ?', ['x'])).resolves.toBeUndefined();

    await client.run('INSERT INTO tasks (id, title) VALUES (?, ?)', ['task-3', undefined]);
    expect(executedStatements[executedStatements.length - 1]?.args).toEqual(['task-3', null]);
  }, 10_000);

  it('ignores an unmarked JSON backup startup snapshot', async () => {
    const staleBackup = {
      tasks: [
        {
          id: 'deleted-task',
          title: 'Deleted task',
          status: 'next',
          tags: [],
          contexts: [],
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        },
      ],
      projects: [],
      sections: [],
      areas: [],
      people: [],
      settings: {},
    };
    asyncStorageMock.getItem.mockImplementation((key: string) => (
      key === 'mindwtr-data' ? Promise.resolve(JSON.stringify(staleBackup)) : Promise.resolve(null)
    ));

    const { getMobileStartupSnapshotFromBackup } = await import('./storage-adapter');
    const snapshot = await getMobileStartupSnapshotFromBackup();

    expect(snapshot).toBeNull();
  }, 10_000);

  it('preserves people when reading the JSON backup startup snapshot', async () => {
    const backup = {
      tasks: [],
      projects: [],
      sections: [],
      areas: [],
      people: [
        {
          id: 'person-1',
          name: 'Alex',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      settings: {},
    };
    asyncStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'mindwtr-data:startup-backup-version') {
        return Promise.resolve('2');
      }
      if (key === 'mindwtr-data') {
        return Promise.resolve(JSON.stringify(backup));
      }
      return Promise.resolve(null);
    });

    const { getMobileStartupSnapshotFromBackup } = await import('./storage-adapter');
    const snapshot = await getMobileStartupSnapshotFromBackup();

    expect(snapshot?.people).toEqual(backup.people);
  }, 10_000);
});
