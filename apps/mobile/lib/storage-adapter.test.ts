import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Task } from '@mindwtr/core';

const {
  asyncStorageMock,
  localStorageMock,
  logWarnMock,
  sqliteAdapterSaveTask,
  updateMobileWidgetFromDataMock,
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
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue(undefined);
    sqliteAdapterSaveTask.mockResolvedValue(undefined);
    updateMobileWidgetFromDataMock.mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: localStorageMock },
    });
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

    const dataWrites = asyncStorageMock.setItem.mock.calls.filter(([key]) => key === 'mindwtr-data');
    expect(dataWrites).toHaveLength(1);
    expect(dataWrites[0]?.[1]).toBe(JSON.stringify(makeSnapshot(third)));
    expect(updateMobileWidgetFromDataMock).toHaveBeenCalledTimes(1);
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
