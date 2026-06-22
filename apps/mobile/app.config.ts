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
const analyticsReleaseVersion = (process.env.ANALYTICS_RELEASE_VERSION ?? '').trim();
const feedbackEndpointUrl = (process.env.FEEDBACK_ENDPOINT_URL ?? '').trim();
const dropboxAppKey = (process.env.DROPBOX_APP_KEY ?? '').trim();
const donationPromptEnabled = process.env.DONATION_PROMPT_ENABLED === '1'
  || process.env.DONATION_PROMPT_ENABLED === 'true';
const promptTestControlsEnabled = process.env.PROMPT_TEST_CONTROLS_ENABLED === '1'
  || process.env.PROMPT_TEST_CONTROLS_ENABLED === 'true';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const extra = {
    ...(base.extra ?? {}),
    isFossBuild,
    analyticsHeartbeatUrl,
    analyticsHeartbeatChannel,
    analyticsReleaseVersion,
    feedbackEndpointUrl,
    dropboxAppKey,
    donationPromptEnabled,
    promptTestControlsEnabled,
  };

  return {
    ...base,
    extra,
  };
};
