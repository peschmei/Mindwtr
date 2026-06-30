import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Task } from '@mindwtr/core';

const {
  asyncStorageMock,
  localStorageMock,
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
  logWarn: vi.fn(),
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
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      'mindwtr-data',
      JSON.stringify(currentSnapshot),
    );
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      'mindwtr-data:startup-backup-version',
      '2',
    );
    expect(updateMobileWidgetFromDataMock).toHaveBeenCalledWith(currentSnapshot);
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
