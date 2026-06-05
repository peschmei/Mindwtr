import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '@mindwtr/core';

const fileSystemMock = vi.hoisted(() => {
  let storedText = '';
  return {
    __setStoredText: (value: string) => {
      storedText = value;
    },
    __getStoredText: () => storedText,
    __getUtf8ByteLength: (value: string) => new TextEncoder().encode(value).byteLength,
    StorageAccessFramework: {
      readAsStringAsync: vi.fn(async () => storedText),
      writeAsStringAsync: vi.fn(async (_uri: string, content: string) => {
        storedText = content + storedText.slice(content.length);
      }),
      createFileAsync: vi.fn(),
      readDirectoryAsync: vi.fn(),
      deleteAsync: vi.fn(),
    },
    getInfoAsync: vi.fn().mockResolvedValue({ exists: false }),
    readAsStringAsync: vi.fn(),
    writeAsStringAsync: vi.fn(),
    copyAsync: vi.fn(),
    deleteAsync: vi.fn(),
    moveAsync: vi.fn(),
    cacheDirectory: 'file://cache/',
    documentDirectory: 'file://document/',
  };
});

vi.mock('./file-system', () => fileSystemMock);

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn(),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
  Directory: class Directory {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    static pickDirectoryAsync = vi.fn();
  },
  File: class File {
    uri: string;
    exists = false;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

vi.mock('./app-log', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('./sync-path-bookmarks', () => ({
  createSyncPathBookmark: vi.fn(),
}));

const syncFileUri =
  'content://com.android.externalstorage.documents/tree/primary%3AMindwtr/document/primary%3AMindwtr%2Fdata.json';

const appData = (settings: AppData['settings']): AppData => ({
  tasks: [],
  projects: [],
  sections: [],
  areas: [],
  settings,
});

describe('storage-file sync writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileSystemMock.__setStoredText('');
  });

  it('pads shorter SAF writes so stale bytes cannot corrupt data.json', async () => {
    const previous = JSON.stringify(
      appData({
        syncPreferences: { appearance: true, language: true, gtd: true },
        appearance: { showTaskAge: true },
        weekStart: 'monday',
        dateFormat: 'ymd',
        timeFormat: '24h',
      }),
      null,
      2
    );
    const nextData = appData({
      syncPreferences: { language: true },
      weekStart: 'monday',
    });
    const next = JSON.stringify(nextData, null, 2);
    fileSystemMock.__setStoredText(previous);

    const { writeSyncFile } = await import('./storage-file');

    await writeSyncFile(syncFileUri, nextData);

    const written = fileSystemMock.StorageAccessFramework.writeAsStringAsync.mock.calls[0]?.[1] as string;
    expect(fileSystemMock.__getUtf8ByteLength(written)).toBeGreaterThanOrEqual(
      fileSystemMock.__getUtf8ByteLength(previous)
    );
    expect(written.startsWith(next)).toBe(true);
    expect(written.slice(next.length)).toMatch(/^\s+$/);
    expect(JSON.parse(fileSystemMock.__getStoredText())).toEqual(nextData);
  });
});
