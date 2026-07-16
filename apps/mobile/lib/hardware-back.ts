import { BackHandler, type NativeEventSubscription } from 'react-native';

export function addHardwareBackPressListener(
  handler: () => boolean,
): NativeEventSubscription {
  return BackHandler.addEventListener('hardwareBackPress', handler);
}
