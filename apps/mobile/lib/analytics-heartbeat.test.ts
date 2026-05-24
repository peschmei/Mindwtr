import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  asyncStorageGetItem,
  asyncStorageSetItem,
  sendDailyHeartbeat,
} = vi.hoisted(() => ({
  asyncStorageGetItem: vi.fn(async () => null),
  asyncStorageSetItem: vi.fn(async () => undefined),
  sendDailyHeartbeat: vi.fn(async () => true),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: asyncStorageGetItem,
    setItem: asyncStorageSetItem,
  },
}));

vi.mock('@mindwtr/core', () => ({
  generateUUID: () => 'generated-id',
  sendDailyHeartbeat,
}));

vi.mock('expo-application', () => ({
  getInstallReferrerAsync: vi.fn(async () => ''),
}));

import { sendMobileDailyHeartbeat } from './analytics-heartbeat';

describe('sendMobileDailyHeartbeat', () => {
  const config = {
    analyticsHeartbeatUrl: 'https://analytics.example.com/heartbeat',
    appVersion: '0.9.4',
    isExpoGo: false,
    isFossBuild: false,
  };

  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    asyncStorageGetItem.mockClear();
    asyncStorageSetItem.mockClear();
    sendDailyHeartbeat.mockClear();
  });

  it('does not build or send a heartbeat when the setting is disabled', async () => {
    await expect(sendMobileDailyHeartbeat(config, {
      analytics: {
        heartbeatEnabled: false,
      },
    })).resolves.toBe(false);

    expect(asyncStorageGetItem).not.toHaveBeenCalled();
    expect(asyncStorageSetItem).not.toHaveBeenCalled();
    expect(sendDailyHeartbeat).not.toHaveBeenCalled();
  });
});
