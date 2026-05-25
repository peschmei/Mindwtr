import type { ConfigContext, ExpoConfig } from 'expo/config';

const isFossBuild = process.env.FOSS_BUILD === '1' || process.env.FOSS_BUILD === 'true';
const analyticsHeartbeatDisabled = process.env.ANALYTICS_HEARTBEAT_DISABLED === '1'
  || process.env.ANALYTICS_HEARTBEAT_DISABLED === 'true';
const configuredAnalyticsHeartbeatUrl = (process.env.ANALYTICS_HEARTBEAT_URL ?? '').trim();
const analyticsHeartbeatUrl = analyticsHeartbeatDisabled
  ? ''
  : configuredAnalyticsHeartbeatUrl;
const analyticsHeartbeatChannel = (
  process.env.ANALYTICS_HEARTBEAT_CHANNEL
    ?? (isFossBuild && analyticsHeartbeatUrl ? 'fdroid' : '')
).trim();
const dropboxAppKey = (process.env.DROPBOX_APP_KEY ?? '').trim();

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const extra = {
    ...(base.extra ?? {}),
    isFossBuild,
    analyticsHeartbeatUrl,
    analyticsHeartbeatChannel,
    dropboxAppKey,
  };

  return {
    ...base,
    extra,
  };
};
