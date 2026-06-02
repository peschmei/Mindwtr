import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEnrolledLevelAsyncMock = vi.hoisted(() => vi.fn());
const authenticateAsyncMock = vi.hoisted(() => vi.fn());

vi.mock('expo-local-authentication', () => ({
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC_WEAK: 2,
    BIOMETRIC_STRONG: 3,
  },
  getEnrolledLevelAsync: getEnrolledLevelAsyncMock,
  authenticateAsync: authenticateAsyncMock,
}));

import { authenticateWithDeviceLock, getMobileAppLockErrorKey } from './mobile-app-lock';

describe('mobile app lock authentication', () => {
  beforeEach(() => {
    getEnrolledLevelAsyncMock.mockReset();
    authenticateAsyncMock.mockReset();
  });

  it('does not prompt when no device authentication is enrolled', async () => {
    getEnrolledLevelAsyncMock.mockResolvedValue(0);

    const result = await authenticateWithDeviceLock({
      promptMessage: 'Unlock Mindwtr',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
    });

    expect(result).toEqual({ success: false, reason: 'unavailable' });
    expect(authenticateAsyncMock).not.toHaveBeenCalled();
  });

  it('authenticates with OS device fallback enabled', async () => {
    getEnrolledLevelAsyncMock.mockResolvedValue(2);
    authenticateAsyncMock.mockResolvedValue({ success: true });

    const result = await authenticateWithDeviceLock({
      promptMessage: 'Unlock Mindwtr',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
    });

    expect(result).toEqual({ success: true });
    expect(authenticateAsyncMock).toHaveBeenCalledWith({
      promptMessage: 'Unlock Mindwtr',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
      biometricsSecurityLevel: 'weak',
      requireConfirmation: true,
    });
  });

  it('maps user cancellation separately from failed authentication', async () => {
    getEnrolledLevelAsyncMock.mockResolvedValue(3);
    authenticateAsyncMock.mockResolvedValue({ success: false, error: 'user_cancel' });

    const result = await authenticateWithDeviceLock({
      promptMessage: 'Unlock Mindwtr',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
    });

    expect(result).toEqual({ success: false, reason: 'cancelled', error: 'user_cancel' });
    expect(getMobileAppLockErrorKey(result.success ? 'failed' : result.reason)).toBe('appLock.cancelled');
  });
});
