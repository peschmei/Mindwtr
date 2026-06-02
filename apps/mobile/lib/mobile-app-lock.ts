import * as LocalAuthentication from 'expo-local-authentication';

export type MobileAppLockAuthFailureReason = 'unavailable' | 'cancelled' | 'failed';

export type MobileAppLockAuthOutcome =
  | { success: true }
  | { success: false; reason: MobileAppLockAuthFailureReason; error?: string };

type AuthenticateWithDeviceLockOptions = {
  promptMessage: string;
  cancelLabel: string;
  fallbackLabel: string;
};

const UNAVAILABLE_ERRORS = new Set([
  'not_available',
  'not_enrolled',
  'passcode_not_set',
]);

const CANCELLED_ERRORS = new Set([
  'app_cancel',
  'system_cancel',
  'user_cancel',
  'user_fallback',
]);

export async function canUseDeviceAuthentication(): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level !== LocalAuthentication.SecurityLevel.NONE;
}

export async function authenticateWithDeviceLock({
  promptMessage,
  cancelLabel,
  fallbackLabel,
}: AuthenticateWithDeviceLockOptions): Promise<MobileAppLockAuthOutcome> {
  const available = await canUseDeviceAuthentication();
  if (!available) {
    return { success: false, reason: 'unavailable' };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel,
    fallbackLabel,
    disableDeviceFallback: false,
    biometricsSecurityLevel: 'weak',
    requireConfirmation: true,
  });

  if (result.success) return { success: true };
  if (UNAVAILABLE_ERRORS.has(result.error)) {
    return { success: false, reason: 'unavailable', error: result.error };
  }
  if (CANCELLED_ERRORS.has(result.error)) {
    return { success: false, reason: 'cancelled', error: result.error };
  }
  return { success: false, reason: 'failed', error: result.error };
}

export function getMobileAppLockErrorKey(reason: MobileAppLockAuthFailureReason): string {
  if (reason === 'unavailable') return 'appLock.unavailable';
  if (reason === 'cancelled') return 'appLock.cancelled';
  return 'appLock.failed';
}
