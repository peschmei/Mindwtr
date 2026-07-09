import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { AppData, MergeStats, createSyncOrchestrator, ensureFreshLocalSyncSnapshot, runPreSyncAttachmentPhase, useTaskStore, webdavGetJson, webdavHeadFile, webdavPutJson, cloudGetJson, cloudHeadJson, cloudPutJson, flushPendingSave, performSyncCycle, CLOCK_SKEW_THRESHOLD_MS, appendSyncHistory, withRetry, isRetryableWebdavReadError, isWebdavInvalidJsonError, normalizeWebdavUrl, normalizeCloudUrl, sanitizeAppDataForRemote, buildHttpRemoteFileFingerprint, computeSyncPayloadFingerprint, areSyncPayloadsEqual, assertNoPendingAttachmentUploads, buildFastSyncScope, buildMergeSummaryLog, buildPendingAttachmentUploadLogExtra, findPendingAttachmentUploads, hasPendingSyncSideEffects, injectExternalCalendars as injectExternalCalendarsForSync, persistExternalCalendars as persistExternalCalendarsForSync, mergeAppData, cloneAppData, LocalSyncAbort, getInMemoryAppDataSnapshot, shouldRunAttachmentCleanup, createAbortableFetch, normalizeCloudProvider as normalizeCoreCloudProvider, isDropboxUnauthorizedError, parseFastSyncState, serializeFastSyncState, decodeUriSafe, SYNC_FILE_NAME, CLOUD_PROVIDER_DROPBOX, CLOUD_PROVIDER_SELF_HOSTED, type Attachment, type CloudJsonWriteResult, type CloudProvider, type FastSyncState, type PendingAttachmentUpload, type RemoteJsonWriteResult } from '@mindwtr/core';
import { mobileStorage } from './storage-adapter';
import { logInfo, logSyncError, logWarn, sanitizeLogMessage } from './app-log';
import { readSyncFile, resolveSyncFileUri, writeSyncFile } from './storage-file';
import { isSyncPathBookmarksAvailable, resolveSyncPathBookmark } from './sync-path-bookmarks';
import { getBaseSyncUrl, getCloudBaseUrl, syncCloudAttachments, syncCloudKitAttachments, syncDropboxAttachments, syncFileAttachments, syncWebdavAttachments, cleanupAttachmentTempFiles, hasPendingAttachmentSyncWork } from './attachment-sync';
import { runMobileAttachmentCleanup } from './sync-attachment-cleanup';
import { getExternalCalendars, saveExternalCalendars } from './external-calendar';
import { forceRefreshDropboxAccessToken, getValidDropboxAccessToken, isDropboxConnected } from './dropbox-auth';
import {
  DropboxConflictError,
  DropboxFileNotFoundError,
  deleteDropboxFile,
  downloadDropboxAppData,
  getDropboxAppDataMetadata,
  uploadDropboxAppData,
} from './dropbox-sync';
import * as Network from 'expo-network';
import { coerceSupportedBackend, formatSyncErrorMessage, isLikelyFilePath, isLikelyOfflineSyncError, isRemoteSyncBackend, normalizeFileSyncPath, resolveBackend, type SyncBackend } from './sync-service-utils';
import { ensureCloudKitReady, readRemoteCloudKit, writeRemoteCloudKit, isCloudKitAvailable } from './cloudkit-sync';
import { createWebdavSyncRateLimitController } from './sync-rate-limit';
import {
  SYNC_PATH_KEY,
  SYNC_BACKEND_KEY,
  WEBDAV_URL_KEY,
  WEBDAV_USERNAME_KEY,
  WEBDAV_PASSWORD_KEY,
  WEBDAV_ALLOW_INSECURE_HTTP_KEY,
  WEBDAV_ALLOW_WEAK_FINGERPRINT_KEY,
  CLOUD_URL_KEY,
  CLOUD_TOKEN_KEY,
  CLOUD_PROVIDER_KEY,
  CLOUD_ALLOW_INSECURE_HTTP_KEY,
  SYNC_PATH_BOOKMARK_KEY,
  DROPBOX_LAST_REV_KEY,
} from './sync-constants';
import { getMobileCloudRequestOptions, getMobileWebDavRequestOptions } from './webdav-request-options';

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const WEBDAV_RETRY_OPTIONS = { maxAttempts: 5, baseDelayMs: 2000, maxDelayMs: 30_000 };
const WEBDAV_READ_RETRY_OPTIONS = { ...WEBDAV_RETRY_OPTIONS, shouldRetry: isRetryableWebdavReadError };
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SYNC_CONFIG_CACHE_TTL_MS = 30_000;
const FAST_SYNC_STATE_KEY = '@mindwtr_fast_sync_state_v1';
const LOCAL_SYNC_STATUS_KEY = '@mindwtr_local_sync_status_v1';
const syncConfigCache = new Map<string, { value: string | null; readAt: number }>();

type RemoteWriteResultLike = Partial<RemoteJsonWriteResult & CloudJsonWriteResult>;
type LocalSyncStatus = Pick<AppData['settings'], 'lastSyncAt' | 'lastSyncStatus' | 'lastSyncError' | 'lastSyncStats' | 'lastSyncHistory'>;

const normalizeRemoteWriteResult = (
  source: 'cloud' | 'webdav',
  result: RemoteWriteResultLike | null | undefined
): { fingerprint: string | null; serverMergedRemoteData: boolean } => {
  if (!result || typeof result !== 'object') {
    return { fingerprint: null, serverMergedRemoteData: false };
  }
  const fingerprint = typeof result.fingerprint === 'string' && result.fingerprint.trim()
    ? result.fingerprint
    : buildHttpRemoteFileFingerprint(source, {
      etag: typeof result.etag === 'string' ? result.etag : null,
      lastModified: typeof result.lastModified === 'string' ? result.lastModified : null,
      contentLength: typeof result.contentLength === 'string' ? result.contentLength : null,
    });
  return {
    fingerprint,
    serverMergedRemoteData: result.serverMergedRemoteData === true,
  };
};
const IOS_TEMP_INBOX_PATH_PATTERN = /\/tmp\/[^/]*-Inbox\//i;
const INVALID_CONFIG_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
type MobileSyncActivityState = 'idle' | 'syncing';
type MobileSyncActivityListener = (state: MobileSyncActivityState) => void;
type MobileSyncSkipReason = 'offline' | 'requeued' | 'unchanged' | 'pendingRemoteWriteBackoff';
type MobileSyncResult = { success: boolean; stats?: MergeStats; error?: string; skipped?: MobileSyncSkipReason };
type MobileWebDavSyncConfig = { url: string; username: string; password: string; allowInsecureHttp?: boolean; allowWeakFingerprint?: boolean };
type MobileCloudSyncConfig = { url: string; token: string; allowInsecureHttp?: boolean };
const isFossBuild = (() => {
  const extra = Constants.expoConfig?.extra as { isFossBuild?: unknown } | undefined;
  return extra?.isFossBuild === true || extra?.isFossBuild === 'true';
})();
const DROPBOX_SYNC_ENABLED = !isFossBuild;

const logSyncWarning = (message: string, error?: unknown) => {
  const extra = error ? { error: sanitizeLogMessage(error instanceof Error ? error.message : String(error)) } : undefined;
  void logWarn(message, { scope: 'sync', extra });
};

const logSyncInfo = (message: string, extra?: Record<string, string>) => {
  void logInfo(message, { scope: 'sync', extra });
};

const logPendingAttachmentUploads = (message: string, backend: string, phase: string, pending: PendingAttachmentUpload[]): void => {
  if (pending.length === 0) return;
  void logWarn(message, {
    scope: 'sync',
    extra: buildPendingAttachmentUploadLogExtra(backend, phase, pending, sanitizeLogMessage),
  });
};

const sanitizeConfigValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (!value) return null;
  if (INVALID_CONFIG_CHAR_PATTERN.test(value)) return null;
  return value;
};

const resolveCloudProvider = (value: string | null): CloudProvider => (
  normalizeCoreCloudProvider(value, { allowDropbox: DROPBOX_SYNC_ENABLED })
);

const getDropboxAppKey = (): string => {
  const extra = Constants.expoConfig?.extra as { dropboxAppKey?: unknown } | undefined;
  return typeof extra?.dropboxAppKey === 'string' ? extra.dropboxAppKey.trim() : '';
};

const externalCalendarProvider = {
  load: () => getExternalCalendars(),
  save: (calendars: AppData['settings']['externalCalendars'] | undefined) =>
    saveExternalCalendars(calendars ?? []),
  onWarn: (message: string, error?: unknown) => logSyncWarning(message, error),
};

const injectExternalCalendars = async (data: AppData): Promise<AppData> =>
  injectExternalCalendarsForSync(data, externalCalendarProvider);

const persistExternalCalendars = async (data: AppData): Promise<void> =>
  persistExternalCalendarsForSync(data, externalCalendarProvider);

const readFastSyncState = async (scope: string): Promise<FastSyncState | null> => {
  try {
    const raw = await AsyncStorage.getItem(FAST_SYNC_STATE_KEY);
    return parseFastSyncState(raw, scope);
  } catch {
    return null;
  }
};

const writeFastSyncState = async (state: FastSyncState): Promise<void> => {
  try {
    await AsyncStorage.setItem(FAST_SYNC_STATE_KEY, serializeFastSyncState(state));
  } catch (error) {
    logSyncWarning('Failed to cache sync fast-check state', error);
  }
};

const sanitizeLocalSyncStatus = (value: Partial<LocalSyncStatus>): Partial<LocalSyncStatus> => {
  const next: Partial<LocalSyncStatus> = {};
  if (typeof value.lastSyncAt === 'string') next.lastSyncAt = value.lastSyncAt;
  if (
    value.lastSyncStatus === 'idle'
    || value.lastSyncStatus === 'syncing'
    || value.lastSyncStatus === 'success'
    || value.lastSyncStatus === 'error'
    || value.lastSyncStatus === 'conflict'
  ) {
    next.lastSyncStatus = value.lastSyncStatus;
  }
  if (typeof value.lastSyncError === 'string') next.lastSyncError = value.lastSyncError;
  if (value.lastSyncStats && typeof value.lastSyncStats === 'object') next.lastSyncStats = value.lastSyncStats;
  if (Array.isArray(value.lastSyncHistory)) next.lastSyncHistory = value.lastSyncHistory;
  return next;
};

const readLocalSyncStatus = async (): Promise<Partial<LocalSyncStatus> | null> => {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_SYNC_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalSyncStatus>;
    const status = sanitizeLocalSyncStatus(parsed);
    return Object.keys(status).length > 0 ? status : null;
  } catch {
    return null;
  }
};

const writeLocalSyncStatus = async (updates: Partial<LocalSyncStatus>): Promise<void> => {
  try {
    const next = sanitizeLocalSyncStatus({
      ...(await readLocalSyncStatus() ?? {}),
      ...updates,
    });
    await AsyncStorage.setItem(LOCAL_SYNC_STATUS_KEY, JSON.stringify(next));
  } catch (error) {
    logSyncWarning('Failed to cache local sync status', error);
  }
};

const applyLocalSyncStatus = async (updates: Partial<LocalSyncStatus>): Promise<void> => {
  await writeLocalSyncStatus(updates);
  useTaskStore.setState((state) => ({
    settings: {
      ...(state.settings ?? {}),
      ...updates,
    },
  }));
};

const mergeLocalSyncStatus = async (data: AppData): Promise<AppData> => {
  const status = await readLocalSyncStatus();
  if (!status) return data;
  return {
    ...data,
    settings: {
      ...(data.settings ?? {}),
      ...status,
    },
  };
};

let mobileSyncActivityState: MobileSyncActivityState = 'idle';
const mobileSyncActivityListeners = new Set<MobileSyncActivityListener>();
const webdavSyncRateLimitController = createWebdavSyncRateLimitController();
let activeMobileSyncAbortController: AbortController | null = null;
let activeMobileSyncAbortReason: 'lifecycle' | null = null;

const setMobileSyncActivityState = (next: MobileSyncActivityState) => {
  if (mobileSyncActivityState === next) return;
  mobileSyncActivityState = next;
  mobileSyncActivityListeners.forEach((listener) => {
    try {
      listener(next);
    } catch (error) {
      logSyncWarning('Failed to notify sync activity listener', error);
    }
  });
};

export const getMobileSyncActivityState = (): MobileSyncActivityState => mobileSyncActivityState;

export const subscribeMobileSyncActivityState = (listener: MobileSyncActivityListener): (() => void) => {
  mobileSyncActivityListeners.add(listener);
  listener(mobileSyncActivityState);
  return () => {
    mobileSyncActivityListeners.delete(listener);
  };
};

const readConfigValue = async (key: string, useCache = true): Promise<string | null> => {
  if (!useCache) {
    return sanitizeConfigValue(await AsyncStorage.getItem(key));
  }
  const now = Date.now();
  const cached = syncConfigCache.get(key);
  if (cached && now - cached.readAt <= SYNC_CONFIG_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = sanitizeConfigValue(await AsyncStorage.getItem(key));
  syncConfigCache.set(key, { value, readAt: now });
  return value;
};

export const clearMobileSyncConfigCache = (): void => {
  syncConfigCache.clear();
};

const getCachedConfigValue = async (key: string): Promise<string | null> => {
  return readConfigValue(key, true);
};

const getPathLeaf = (path: string): string => {
  const stripped = path.split('?')[0]?.split('#')[0]?.replace(/\/+$/, '') ?? '';
  const lastSlash = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf('\\'));
  return lastSlash >= 0 ? stripped.slice(lastSlash + 1) : stripped;
};

const SYNC_BOOKMARK_EXPIRED_MESSAGE =
  'Sync location access expired. Please re-select the sync folder or file in Settings -> Data & Sync.';

const resolveBookmarkedFileSyncPath = async (
  syncPath: string | null
): Promise<{ path: string | null; bookmark: string | null }> => {
  if (Platform.OS !== 'ios') return { path: syncPath, bookmark: null };

  const bookmark = (await getCachedConfigValue(SYNC_PATH_BOOKMARK_KEY))?.trim() ?? null;
  if (!bookmark) return { path: syncPath, bookmark: null };

  const resolved = await resolveSyncPathBookmark(bookmark);
  if (!resolved?.uri) {
    if (isSyncPathBookmarksAvailable()) {
      throw new Error(SYNC_BOOKMARK_EXPIRED_MESSAGE);
    }
    return { path: syncPath, bookmark };
  }

  let activeBookmark = bookmark;
  if (resolved.refreshedBookmark && resolved.refreshedBookmark !== bookmark) {
    await AsyncStorage.setItem(SYNC_PATH_BOOKMARK_KEY, resolved.refreshedBookmark);
    syncConfigCache.set(SYNC_PATH_BOOKMARK_KEY, { value: resolved.refreshedBookmark, readAt: Date.now() });
    activeBookmark = resolved.refreshedBookmark;
    logSyncInfo('Refreshed stale iOS sync-path bookmark');
  }

  const bookmarkUri = resolved.uri;
  let resolvedPath = bookmarkUri;
  if (syncPath && isLikelyFilePath(syncPath) && !isLikelyFilePath(bookmarkUri)) {
    const leafName = getPathLeaf(syncPath) || SYNC_FILE_NAME;
    resolvedPath = `${bookmarkUri.replace(/\/+$/, '')}/${leafName}`;
  }

  if (!syncPath || resolvedPath !== syncPath) {
    await AsyncStorage.setItem(SYNC_PATH_KEY, resolvedPath);
    syncConfigCache.set(SYNC_PATH_KEY, { value: resolvedPath, readAt: Date.now() });
    logSyncInfo('Resolved iOS sync-folder bookmark', {
      bookmarkPath: bookmarkUri,
      filePath: resolvedPath,
    });
  }

  return { path: resolvedPath, bookmark: activeBookmark };
};

const getSupportedBackend = (rawBackend: string | null): SyncBackend =>
  coerceSupportedBackend(resolveBackend(rawBackend), isCloudKitAvailable());

export async function getMobileSyncConfigurationStatus(): Promise<{ backend: SyncBackend; configured: boolean }> {
  const rawBackend = (await readConfigValue(SYNC_BACKEND_KEY, false))?.trim() ?? null;
  const backend: SyncBackend = getSupportedBackend(rawBackend);

  if (backend === 'off') {
    return { backend, configured: false };
  }
  if (backend === 'file') {
    const syncPath = (await readConfigValue(SYNC_PATH_KEY, false))?.trim();
    return { backend, configured: Boolean(syncPath) };
  }
  if (backend === 'webdav') {
    const webdavUrl = (await readConfigValue(WEBDAV_URL_KEY, false))?.trim();
    return { backend, configured: Boolean(webdavUrl) };
  }
  if (backend === 'cloudkit') {
    // CloudKit is always "configured" if the module is available — no user credentials needed.
    return { backend, configured: isCloudKitAvailable() };
  }

  const cloudProvider = resolveCloudProvider((await readConfigValue(CLOUD_PROVIDER_KEY, false))?.trim() ?? null);
  if (cloudProvider === CLOUD_PROVIDER_DROPBOX) {
    const dropboxConnected = await isDropboxConnected().catch(() => false);
    return {
      backend,
      configured: DROPBOX_SYNC_ENABLED && getDropboxAppKey().length > 0 && dropboxConnected,
    };
  }

  const cloudUrl = (await readConfigValue(CLOUD_URL_KEY, false))?.trim();
  const cloudToken = (await readConfigValue(CLOUD_TOKEN_KEY, false))?.trim();
  return {
    backend,
    configured: Boolean(cloudUrl && cloudToken),
  };
}

const getAttachmentsArray = (attachments: Attachment[] | undefined): Attachment[] => (
  Array.isArray(attachments) ? attachments : []
);

const getSyncDiagnosticAttachmentCount = (data: AppData): number => {
  const taskAttachments = data.tasks.reduce(
    (count, task) => count + getAttachmentsArray(task.attachments).length,
    0
  );
  const projectAttachments = data.projects.reduce(
    (count, project) => count + getAttachmentsArray(project.attachments).length,
    0
  );
  return taskAttachments + projectAttachments;
};

const buildSyncDataDiagnostics = (data: AppData | null | undefined): Record<string, string> => {
  if (!data) return { hasData: 'false' };
  const contexts = new Set<string>();
  const tags = new Set<string>();
  for (const task of data.tasks) {
    for (const context of task.contexts) contexts.add(context);
    for (const tag of task.tags) tags.add(tag);
  }
  return {
    hasData: 'true',
    tasks: String(data.tasks.length),
    projects: String(data.projects.length),
    areas: String(data.areas.length),
    contexts: String(contexts.size),
    tags: String(tags.size),
    checklistItems: String(data.tasks.reduce(
      (count, task) => count + (Array.isArray(task.checklist) ? task.checklist.length : 0),
      0
    )),
    attachments: String(getSyncDiagnosticAttachmentCount(data)),
  };
};

const getSyncDiagnosticElapsedMs = (startedAt: number): string => (
  String(Math.max(0, Date.now() - startedAt))
);

const logSyncDiagnostic = (
  message: string,
  startedAt: number,
  extra?: Record<string, string>
) => {
  logSyncInfo(message, {
    elapsedMs: getSyncDiagnosticElapsedMs(startedAt),
    ...(extra ?? {}),
  });
};

const buildOfflineSkipResult = (): MobileSyncResult => ({
  success: true,
  skipped: 'offline',
});

const buildRequeuedSkipResult = (): MobileSyncResult => ({
  success: true,
  skipped: 'requeued',
});

type MobileNetworkStatus = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  isAirplaneModeEnabled: boolean;
};

const getMobileNetworkStatus = (state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
  isAirplaneModeEnabled?: unknown;
}): MobileNetworkStatus => ({
  isConnected: typeof state.isConnected === 'boolean' ? state.isConnected : null,
  isInternetReachable: typeof state.isInternetReachable === 'boolean' ? state.isInternetReachable : null,
  isAirplaneModeEnabled: typeof state.isAirplaneModeEnabled === 'boolean' ? state.isAirplaneModeEnabled : false,
});

const isDefinitelyOfflineNetworkStatus = (status: MobileNetworkStatus): boolean => (
  status.isAirplaneModeEnabled
  || status.isConnected === false
  || (status.isConnected !== true && status.isInternetReachable === false)
);

const formatNetworkStatusForLog = (status: MobileNetworkStatus): Record<string, string> => ({
  isConnected: status.isConnected === null ? 'unknown' : String(status.isConnected),
  isInternetReachable: status.isInternetReachable === null ? 'unknown' : String(status.isInternetReachable),
  isAirplaneModeEnabled: String(status.isAirplaneModeEnabled),
});

const shouldSkipSyncForOfflineState = async (
  backend: SyncBackend,
  onOffline?: (status: MobileNetworkStatus) => void
): Promise<boolean> => {
  if (!isRemoteSyncBackend(backend)) return false;
  try {
    const state = await Network.getNetworkStateAsync();
    const status = getMobileNetworkStatus(state);

    if (isDefinitelyOfflineNetworkStatus(status)) {
      onOffline?.(status);
      logSyncInfo('Sync skipped: offline/airplane mode', {
        backend,
        ...formatNetworkStatusForLog(status),
      });
      return true;
    }
  } catch (error) {
    logSyncWarning('Failed to read network state before sync', error);
  }
  return false;
};

type MobileSyncRequest = { syncPathOverride?: string; manual?: boolean };

type MobileRequestFollowUp = (nextArg?: MobileSyncRequest) => void;

// One sync cycle. Mirrors the desktop SyncRun structure: shared cycle state lives in
// fields, backend config and sync phases are methods, and run() sequences them inside
// a single try/catch/finally. Methods copy field values into single-assignment locals
// (e.g. webdavConfig) where callbacks need TypeScript's narrowing to hold across awaits.
class MobileSyncRun {
  private readonly backend: SyncBackend;
  private readonly syncPathOverride: string | undefined;
  private readonly manual: boolean;
  private readonly requestFollowUp: MobileRequestFollowUp;

  private step = 'init';
  private readonly syncDiagnosticStartedAt = Date.now();
  private syncDiagnosticPhaseStartedAt = this.syncDiagnosticStartedAt;
  private visibleActivityStarted = false;
  private syncUrl: string | undefined;
  private wroteLocal = false;
  private localSnapshotChangeAt = useTaskStore.getState().lastDataChangeAt;
  private networkWentOffline = false;
  private offlineDetectionCause: string | null = null;
  private lastOfflineNetworkStatus: MobileNetworkStatus | null = null;
  private networkSubscription: { remove?: () => void } | null = null;
  private preSyncedLocalData: AppData | null = null;
  private readonly requestAbortController = new AbortController();
  private readonly fetchWithAbort = createAbortableFetch(fetch, { baseSignal: this.requestAbortController.signal });

  private webdavConfig: MobileWebDavSyncConfig | null = null;
  private cloudConfig: MobileCloudSyncConfig | null = null;
  private cloudProvider: CloudProvider = CLOUD_PROVIDER_SELF_HOSTED;
  private dropboxClientId = '';
  private dropboxLastRev: string | null = null;
  private fileSyncPath: string | null = null;
  private fileSyncBookmark: string | null = null;
  private remoteDataForCompare: AppData | null = null;
  private lastRemoteWriteFingerprint: string | null = null;
  private lastRemoteWriteMergedServerData = false;
  private localDataCache: { changeAt: number; data: AppData } | null = null;
  private readCheckRemoteData: AppData | null | undefined;
  private webdavRemoteCorrupted = false;
  private fastSyncScope: ReturnType<typeof buildFastSyncScope> = null;

  constructor(backend: SyncBackend, request: MobileSyncRequest | undefined, requestFollowUp: MobileRequestFollowUp) {
    this.backend = backend;
    this.syncPathOverride = request?.syncPathOverride;
    this.manual = request?.manual === true;
    this.requestFollowUp = requestFollowUp;
    activeMobileSyncAbortController = this.requestAbortController;
    activeMobileSyncAbortReason = null;
  }

  async run(): Promise<MobileSyncResult> {
    const backend = this.backend;
    logSyncInfo('Sync start', { backend });
    logSyncInfo('Sync diagnostic start', { backend });
    try {
      this.subscribeNetworkListener();

      this.step = 'flush';
      await flushPendingSave();
      this.logPhaseDiagnostic('flush');
      this.localSnapshotChangeAt = useTaskStore.getState().lastDataChangeAt;

      if (backend === 'file' && !(await this.resolveFileBackendConfig())) {
        return { success: true };
      }
      if (backend === 'webdav') {
        await this.resolveWebdavBackendConfig();
      }
      if (backend === 'cloud') {
        await this.resolveCloudBackendConfig();
      }

      // CloudKit setup — ensure zone and subscription exist before sync cycle.
      if (backend === 'cloudkit') {
        if (!isCloudKitAvailable()) {
          throw new Error('CloudKit is not available on this platform');
        }
        this.step = 'cloudkit_setup';
        logSyncInfo('Sync step', { step: this.step });
        await ensureCloudKitReady({ signal: this.requestAbortController.signal });
      }

      // Pre-sync local attachments only when attachment metadata shows real work.
      await this.runAttachmentPreSyncPhase();

      this.fastSyncScope = buildFastSyncScope({
        backend,
        webdavConfig: this.webdavConfig,
        cloudProvider: this.cloudProvider,
        cloudConfig: this.cloudConfig,
        dropboxClientId: this.dropboxClientId,
      });

      const unchangedFastResult = await this.trySkipUnchangedFastSync();
      const unchangedResult = unchangedFastResult ?? await this.trySkipUnchangedReadSync();
      if (unchangedResult) {
        return unchangedResult;
      }

      return await this.runMergePhase();
    } catch (error) {
      return await this.handleRunError(error);
    } finally {
      this.releaseResources();
    }
  }

  private queueFollowUp(): void {
    this.requestFollowUp({ syncPathOverride: this.syncPathOverride, manual: this.manual });
  }

  private logPhaseDiagnostic(phase: string, extra?: Record<string, string>): void {
    logSyncDiagnostic('Sync diagnostic phase', this.syncDiagnosticPhaseStartedAt, {
      backend: this.backend,
      phase,
      step: this.step,
      ...(extra ?? {}),
    });
    this.syncDiagnosticPhaseStartedAt = Date.now();
  }

  private startVisibleSyncActivity(): void {
    if (this.visibleActivityStarted) return;
    this.visibleActivityStarted = true;
    setMobileSyncActivityState('syncing');
  }

  private ensureLocalSnapshotFresh = (): void => {
    ensureFreshLocalSyncSnapshot({
      localSnapshotChangeAt: this.localSnapshotChangeAt,
      getCurrentChangeAt: () => useTaskStore.getState().lastDataChangeAt,
      requestFollowUp: () => this.queueFollowUp(),
      onStale: ({ localSnapshotChangeAt: snapshotChangeAt, currentChangeAt }) => {
        logSyncInfo('Sync detected local data changes during cycle; queued follow-up', {
          backend: this.backend,
          step: this.step,
          snapshotChangeAt: String(snapshotChangeAt),
          currentChangeAt: String(currentChangeAt),
        });
      },
    });
  };

  private ensureWebdavSyncNotRateLimited(): void {
    webdavSyncRateLimitController.assertReady(this.backend);
  }

  private handleWebdavRateLimit(error: unknown): void {
    if (!webdavSyncRateLimitController.noteError(this.backend, error)) return;
    logSyncWarning('WebDAV rate limited; pausing remote sync', error);
  }

  private markNetworkOffline(cause: string, status?: MobileNetworkStatus): void {
    this.networkWentOffline = true;
    this.offlineDetectionCause = cause;
    this.lastOfflineNetworkStatus = status ?? this.lastOfflineNetworkStatus;
  }

  private ensureNetworkStillAvailable = async (): Promise<void> => {
    if (!isRemoteSyncBackend(this.backend)) return;
    if (this.networkWentOffline) {
      this.requestAbortController.abort();
      throw new Error('Sync paused: offline state detected');
    }
    if (await shouldSkipSyncForOfflineState(this.backend, (status) => this.markNetworkOffline('network-check', status))) {
      this.requestAbortController.abort();
      throw new Error('Sync paused: offline state detected');
    }
  };

  private subscribeNetworkListener(): void {
    if (!isRemoteSyncBackend(this.backend)) return;
    try {
      this.networkSubscription = Network.addNetworkStateListener((state) => {
        const status = getMobileNetworkStatus(state);
        if (isDefinitelyOfflineNetworkStatus(status)) {
          this.markNetworkOffline('network-listener', status);
          this.requestAbortController.abort();
        }
      });
    } catch (error) {
      logSyncWarning('Failed to subscribe to network state during sync', error);
    }
  }

  /** Resolve and normalize the file-sync path. Returns false when no path is configured. */
  private async resolveFileBackendConfig(): Promise<boolean> {
    const configuredSyncPath = (await getCachedConfigValue(SYNC_PATH_KEY))?.trim() ?? null;
    let fileSyncPath = this.syncPathOverride || configuredSyncPath;
    const bookmarkResolution = await resolveBookmarkedFileSyncPath(fileSyncPath);
    fileSyncPath = bookmarkResolution.path;
    this.fileSyncBookmark = bookmarkResolution.bookmark;
    if (!fileSyncPath) {
      return false;
    }
    const normalizedPath = normalizeFileSyncPath(fileSyncPath, Platform.OS);
    if (normalizedPath && normalizedPath !== fileSyncPath) {
      fileSyncPath = normalizedPath;
      await AsyncStorage.setItem(SYNC_PATH_KEY, normalizedPath);
      syncConfigCache.set(SYNC_PATH_KEY, { value: normalizedPath, readAt: Date.now() });
      logSyncInfo('Normalized file sync path to iOS file URI');
    }
    if (fileSyncPath.startsWith('file://') && IOS_TEMP_INBOX_PATH_PATTERN.test(decodeUriSafe(fileSyncPath))) {
      throw new Error('Selected iOS sync file is in a temporary Inbox location and is read-only. Re-select a folder in Settings -> Sync.');
    }
    if (fileSyncPath.startsWith('content://')) {
      try {
        const resolvedPath = await resolveSyncFileUri(fileSyncPath, { createIfMissing: true });
        if (resolvedPath && resolvedPath !== fileSyncPath) {
          await AsyncStorage.setItem(SYNC_PATH_KEY, resolvedPath);
          syncConfigCache.set(SYNC_PATH_KEY, { value: resolvedPath, readAt: Date.now() });
          logSyncInfo('Normalized SAF sync path');
          fileSyncPath = resolvedPath;
        }
      } catch (error) {
        logSyncWarning('Failed to normalize SAF sync path', error);
      }
    } else if (!isLikelyFilePath(fileSyncPath)) {
      const trimmed = fileSyncPath.replace(/\/+$/, '');
      fileSyncPath = `${trimmed}/${SYNC_FILE_NAME}`;
    }
    this.fileSyncPath = fileSyncPath;
    return true;
  }

  private async resolveWebdavBackendConfig(): Promise<void> {
    const url = (await getCachedConfigValue(WEBDAV_URL_KEY))?.trim() ?? null;
    if (!url) throw new Error('WebDAV URL not configured');
    this.syncUrl = normalizeWebdavUrl(url);
    const username = (await getCachedConfigValue(WEBDAV_USERNAME_KEY)) ?? '';
    const password = (await getCachedConfigValue(WEBDAV_PASSWORD_KEY)) ?? '';
    const allowInsecureHttp = (await getCachedConfigValue(WEBDAV_ALLOW_INSECURE_HTTP_KEY)) === 'true';
    const allowWeakFingerprint = (await getCachedConfigValue(WEBDAV_ALLOW_WEAK_FINGERPRINT_KEY)) !== 'false';
    this.webdavConfig = { url: this.syncUrl, username, password, allowInsecureHttp, allowWeakFingerprint };
  }

  private async resolveCloudBackendConfig(): Promise<void> {
    const storedCloudProvider = (await getCachedConfigValue(CLOUD_PROVIDER_KEY))?.trim() ?? null;
    this.cloudProvider = resolveCloudProvider(storedCloudProvider);
    if (!DROPBOX_SYNC_ENABLED && storedCloudProvider === CLOUD_PROVIDER_DROPBOX) {
      throw new Error('Dropbox sync is unavailable in this build. Choose Self-hosted Cloud or install the Dropbox-enabled build.');
    }
    if (this.cloudProvider === CLOUD_PROVIDER_DROPBOX) {
      this.dropboxClientId = getDropboxAppKey();
      if (!this.dropboxClientId) {
        throw new Error('Dropbox app key is not configured');
      }
      this.dropboxLastRev = (await getCachedConfigValue(DROPBOX_LAST_REV_KEY))?.trim() ?? null;
      this.syncUrl = 'dropbox://Apps/Mindwtr/data.json';
    } else {
      const url = (await getCachedConfigValue(CLOUD_URL_KEY))?.trim() ?? null;
      if (!url) throw new Error('Self-hosted URL not configured');
      this.syncUrl = normalizeCloudUrl(url);
      const token = (await getCachedConfigValue(CLOUD_TOKEN_KEY))?.trim() ?? '';
      const allowInsecureHttp = (await getCachedConfigValue(CLOUD_ALLOW_INSECURE_HTTP_KEY)) === 'true';
      this.cloudConfig = { url: this.syncUrl, token, allowInsecureHttp };
    }
  }

  private async runDropboxOperation<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    let accessToken = await getValidDropboxAccessToken(this.dropboxClientId, this.fetchWithAbort);
    try {
      return await operation(accessToken);
    } catch (error) {
      if (!isDropboxUnauthorizedError(error)) throw error;
      accessToken = await forceRefreshDropboxAccessToken(this.dropboxClientId, this.fetchWithAbort);
      return operation(accessToken);
    }
  }

  private readLocalDataForSyncCycle = async (): Promise<AppData> => {
    const currentChangeAt = useTaskStore.getState().lastDataChangeAt;
    if (this.localDataCache && this.localDataCache.changeAt === currentChangeAt) {
      this.localSnapshotChangeAt = currentChangeAt;
      return this.localDataCache.data;
    }
    const inMemorySnapshot = getInMemoryAppDataSnapshot();
    const baseData = this.preSyncedLocalData
      ? mergeAppData(this.preSyncedLocalData, inMemorySnapshot)
      : mergeAppData(await mergeLocalSyncStatus(await mobileStorage.getData()), inMemorySnapshot);
    const data = await injectExternalCalendars(baseData);
    this.localSnapshotChangeAt = useTaskStore.getState().lastDataChangeAt;
    this.localDataCache = {
      changeAt: this.localSnapshotChangeAt,
      data,
    };
    return data;
  };

  /** Pre-sync local attachments only when attachment metadata shows real work. */
  private async runAttachmentPreSyncPhase(): Promise<void> {
    const backend = this.backend;
    const attachmentPrepareStartedAt = Date.now();
    try {
      const localData = await this.readLocalDataForSyncCycle();
      const hasAttachmentWork = await hasPendingAttachmentSyncWork(localData);
      if (hasPendingSyncSideEffects(localData) || hasAttachmentWork) {
        this.startVisibleSyncActivity();
      }
      if (!hasAttachmentWork) {
        logSyncInfo('Attachment pre-sync skipped', {
          backend,
          reason: 'no-pending-work',
        });
        logSyncDiagnostic('Sync diagnostic attachment prepare skipped', attachmentPrepareStartedAt, {
          backend,
          ...buildSyncDataDiagnostics(localData),
        });
      } else {
        this.step = 'attachments_prepare';
        logSyncInfo('Sync step', { step: this.step });
        const webdavConfig = this.webdavConfig;
        const cloudConfig = this.cloudConfig;
        const fileSyncPath = this.fileSyncPath;
        const preSyncResult = await runPreSyncAttachmentPhase({
          backend,
          cloudProvider: this.cloudProvider,
          data: localData,
          ensureNetworkStillAvailable: this.ensureNetworkStillAvailable,
          webdav: webdavConfig?.url
            ? async (data) => {
              const baseSyncUrl = getBaseSyncUrl(webdavConfig.url);
              return syncWebdavAttachments(data, webdavConfig, baseSyncUrl, this.requestAbortController.signal);
            }
            : undefined,
          cloudkit: backend === 'cloudkit'
            ? async (data) => syncCloudKitAttachments(data, this.requestAbortController.signal)
            : undefined,
          selfHostedCloud: this.cloudProvider === CLOUD_PROVIDER_SELF_HOSTED && cloudConfig?.url
            ? async (data) => {
              const baseSyncUrl = getCloudBaseUrl(cloudConfig.url);
              return syncCloudAttachments(data, cloudConfig, baseSyncUrl, {
                assertCurrent: this.ensureLocalSnapshotFresh,
                signal: this.requestAbortController.signal,
              });
            }
            : undefined,
          dropbox: this.cloudProvider === CLOUD_PROVIDER_DROPBOX
            ? async (data) => syncDropboxAttachments(data, this.dropboxClientId, this.fetchWithAbort, {
              signal: this.requestAbortController.signal,
            })
            : undefined,
          file: fileSyncPath
            ? async (data) => syncFileAttachments(data, fileSyncPath, this.requestAbortController.signal)
            : undefined,
        });
        if (preSyncResult.mutated) {
          // Capture pre-sync attachment mutations before stale-snapshot checks so we can persist them on abort.
          this.preSyncedLocalData = preSyncResult.data ?? localData;
          this.localDataCache = null;
          this.ensureLocalSnapshotFresh();
        }
        logSyncInfo('Attachment pre-sync complete', {
          backend,
          mutated: preSyncResult.mutated ? 'true' : 'false',
        });
        logSyncDiagnostic('Sync diagnostic attachment prepare complete', attachmentPrepareStartedAt, {
          backend,
          mutated: preSyncResult.mutated ? 'true' : 'false',
          ...buildSyncDataDiagnostics(preSyncResult.data ?? localData),
        });
      }
    } catch (error) {
      if (error instanceof LocalSyncAbort) {
        throw error;
      }
      if (this.requestAbortController.signal.aborted) {
        throw error;
      }
      logSyncWarning('Attachment pre-sync warning; continuing sync merge', error);
    }
  }

  private readRemoteDataByBackend = async (): Promise<AppData | null> => {
    if (this.readCheckRemoteData !== undefined) {
      const data = this.readCheckRemoteData;
      this.readCheckRemoteData = undefined;
      this.remoteDataForCompare = data;
      return data;
    }
    await this.ensureNetworkStillAvailable();
    const backend = this.backend;
    const webdavConfig = this.webdavConfig;
    if (backend === 'webdav' && webdavConfig?.url) {
      this.ensureWebdavSyncNotRateLimited();
      try {
        const data = await withRetry(
          () =>
            webdavGetJson<AppData>(webdavConfig.url, {
              ...getMobileWebDavRequestOptions(webdavConfig.allowInsecureHttp),
              username: webdavConfig.username,
              password: webdavConfig.password,
              timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
              fetcher: this.fetchWithAbort,
              allowWeakFingerprint: webdavConfig.allowWeakFingerprint,
            }),
          WEBDAV_READ_RETRY_OPTIONS
        );
        this.webdavRemoteCorrupted = false;
        this.remoteDataForCompare = data ?? null;
        return data;
      } catch (error) {
        if (isWebdavInvalidJsonError(error)) {
          this.webdavRemoteCorrupted = true;
          this.remoteDataForCompare = null;
          logSyncWarning('WebDAV remote data.json appears corrupted; treating as missing for repair write', error);
          return null;
        }
        this.handleWebdavRateLimit(error);
        throw error;
      }
    }
    const cloudConfig = this.cloudConfig;
    if (backend === 'cloud' && cloudConfig?.url) {
      const data = await cloudGetJson<AppData>(cloudConfig.url, {
        ...getMobileCloudRequestOptions(cloudConfig.allowInsecureHttp),
        token: cloudConfig.token,
        timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
        fetcher: this.fetchWithAbort,
      });
      this.remoteDataForCompare = data ?? null;
      return data;
    }
    if (backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_DROPBOX) {
      const { data, rev } = await this.runDropboxOperation((accessToken) =>
        downloadDropboxAppData(accessToken, this.fetchWithAbort)
      );
      this.dropboxLastRev = rev;
      if (rev) {
        await AsyncStorage.setItem(DROPBOX_LAST_REV_KEY, rev);
        syncConfigCache.set(DROPBOX_LAST_REV_KEY, { value: rev, readAt: Date.now() });
      } else {
        await AsyncStorage.removeItem(DROPBOX_LAST_REV_KEY);
        syncConfigCache.set(DROPBOX_LAST_REV_KEY, { value: null, readAt: Date.now() });
      }
      this.remoteDataForCompare = data ?? null;
      return data;
    }
    if (backend === 'cloudkit') {
      const data = await readRemoteCloudKit({ signal: this.requestAbortController.signal });
      this.remoteDataForCompare = data ?? null;
      return data;
    }
    const fileSyncPath = this.fileSyncPath;
    if (!fileSyncPath) {
      throw new Error('No sync folder configured');
    }
    const data = await readSyncFile(fileSyncPath, { bookmark: this.fileSyncBookmark });
    this.remoteDataForCompare = data ?? null;
    return data;
  };

  /** Final attachment upload pass right before the remote write when uploads are still pending. */
  private prepareRemoteWriteData = async (data: AppData): Promise<AppData> => {
    const pendingUploads = findPendingAttachmentUploads(data);
    if (pendingUploads.length === 0) {
      return data;
    }

    const backend = this.backend;
    this.step = 'attachments_finalize';
    logSyncInfo('Sync step', { step: this.step });
    logSyncInfo('Attachment final sync start', {
      backend,
      pending: String(pendingUploads.length),
    });

    const webdavConfig = this.webdavConfig;
    const cloudConfig = this.cloudConfig;
    const fileSyncPath = this.fileSyncPath;
    if (backend === 'webdav' && webdavConfig?.url) {
      await this.ensureNetworkStillAvailable();
      const baseSyncUrl = getBaseSyncUrl(webdavConfig.url);
      await syncWebdavAttachments(data, webdavConfig, baseSyncUrl, this.requestAbortController.signal);
    } else if (backend === 'cloudkit') {
      await this.ensureNetworkStillAvailable();
      await syncCloudKitAttachments(data, this.requestAbortController.signal);
    } else if (backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_SELF_HOSTED && cloudConfig?.url) {
      await this.ensureNetworkStillAvailable();
      const baseSyncUrl = getCloudBaseUrl(cloudConfig.url);
      await syncCloudAttachments(data, cloudConfig, baseSyncUrl, {
        assertCurrent: this.ensureLocalSnapshotFresh,
        signal: this.requestAbortController.signal,
      });
    } else if (backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_DROPBOX) {
      await this.ensureNetworkStillAvailable();
      await syncDropboxAttachments(data, this.dropboxClientId, this.fetchWithAbort, {
        signal: this.requestAbortController.signal,
      });
    } else if (backend === 'file' && fileSyncPath) {
      await syncFileAttachments(data, fileSyncPath, this.requestAbortController.signal);
    }

    const remainingUploads = findPendingAttachmentUploads(data);
    logSyncInfo('Attachment final sync done', {
      backend,
      pending: String(remainingUploads.length),
    });
    logPendingAttachmentUploads(
      'Attachment uploads still pending after final sync',
      backend,
      'attachments-finalize',
      remainingUploads
    );

    return data;
  };

  private async writeRemoteDataByBackend(data: AppData): Promise<void> {
    await this.ensureNetworkStillAvailable();
    this.lastRemoteWriteFingerprint = null;
    this.lastRemoteWriteMergedServerData = false;
    const backend = this.backend;
    logPendingAttachmentUploads(
      'Remote write blocked by pending attachment uploads',
      backend,
      'remote-write',
      findPendingAttachmentUploads(data)
    );
    assertNoPendingAttachmentUploads(data);
    const sanitized = sanitizeAppDataForRemote(data);
    const remoteSanitized = this.remoteDataForCompare
      ? sanitizeAppDataForRemote(this.remoteDataForCompare)
      : null;
    if (remoteSanitized && areSyncPayloadsEqual(remoteSanitized, sanitized)) {
      return;
    }
    if (backend === 'webdav') {
      const webdavConfig = this.webdavConfig;
      if (!webdavConfig?.url) throw new Error('WebDAV URL not configured');
      this.ensureWebdavSyncNotRateLimited();
      if (this.webdavRemoteCorrupted) {
        logSyncInfo('Repairing corrupted WebDAV data.json with current merged data');
      }
      let result: RemoteJsonWriteResult;
      try {
        result = await withRetry(
          () =>
            webdavPutJson(webdavConfig.url, sanitized, {
              ...getMobileWebDavRequestOptions(webdavConfig.allowInsecureHttp),
              username: webdavConfig.username,
              password: webdavConfig.password,
              timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
              fetcher: this.fetchWithAbort,
            }),
          WEBDAV_RETRY_OPTIONS
        );
      } catch (error) {
        this.handleWebdavRateLimit(error);
        throw error;
      }
      const writeResult = normalizeRemoteWriteResult('webdav', result);
      this.lastRemoteWriteFingerprint = writeResult.fingerprint;
      this.remoteDataForCompare = sanitized;
      this.webdavRemoteCorrupted = false;
      return;
    }
    if (backend === 'cloud') {
      if (this.cloudProvider === CLOUD_PROVIDER_DROPBOX) {
        try {
          const result = await this.runDropboxOperation((accessToken) =>
            uploadDropboxAppData(accessToken, sanitized, this.dropboxLastRev, this.fetchWithAbort)
          );
          this.dropboxLastRev = result.rev;
          if (result.rev) {
            await AsyncStorage.setItem(DROPBOX_LAST_REV_KEY, result.rev);
            syncConfigCache.set(DROPBOX_LAST_REV_KEY, { value: result.rev, readAt: Date.now() });
          } else {
            await AsyncStorage.removeItem(DROPBOX_LAST_REV_KEY);
            syncConfigCache.set(DROPBOX_LAST_REV_KEY, { value: null, readAt: Date.now() });
          }
          this.remoteDataForCompare = sanitized;
          return;
        } catch (error) {
          if (error instanceof DropboxConflictError) {
            // Another device wrote between readRemote and writeRemote; retry next cycle.
            this.queueFollowUp();
            throw new LocalSyncAbort();
          }
          throw error;
        }
      }
      const cloudConfig = this.cloudConfig;
      if (!cloudConfig?.url) throw new Error('Self-hosted URL not configured');
      const result = await cloudPutJson(cloudConfig.url, sanitized, {
        ...getMobileCloudRequestOptions(cloudConfig.allowInsecureHttp),
        token: cloudConfig.token,
        timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
        fetcher: this.fetchWithAbort,
      });
      const writeResult = normalizeRemoteWriteResult('cloud', result);
      this.lastRemoteWriteFingerprint = writeResult.fingerprint;
      this.lastRemoteWriteMergedServerData = writeResult.serverMergedRemoteData;
      if (writeResult.serverMergedRemoteData) {
        this.remoteDataForCompare = null;
        this.queueFollowUp();
      } else {
        this.remoteDataForCompare = sanitized;
      }
      return;
    }
    if (backend === 'cloudkit') {
      await writeRemoteCloudKit(sanitized as AppData, { signal: this.requestAbortController.signal });
      this.remoteDataForCompare = sanitized;
      return;
    }
    const fileSyncPath = this.fileSyncPath;
    if (!fileSyncPath) throw new Error('No sync folder configured');
    await writeSyncFile(fileSyncPath, sanitized, { bookmark: this.fileSyncBookmark });
    this.remoteDataForCompare = sanitized;
  }

  private async readRemoteFingerprintForFastCheck(): Promise<string | null> {
    await this.ensureNetworkStillAvailable();
    const backend = this.backend;
    const webdavConfig = this.webdavConfig;
    if (backend === 'webdav' && webdavConfig?.url) {
      this.ensureWebdavSyncNotRateLimited();
      try {
        const metadata = await withRetry(
          () =>
            webdavHeadFile(webdavConfig.url, {
              ...getMobileWebDavRequestOptions(webdavConfig.allowInsecureHttp),
              username: webdavConfig.username,
              password: webdavConfig.password,
              timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
              fetcher: this.fetchWithAbort,
            }),
          WEBDAV_READ_RETRY_OPTIONS
        );
        if (!metadata?.exists) return null;
        return metadata.fingerprint;
      } catch (error) {
        this.handleWebdavRateLimit(error);
        throw error;
      }
    }
    const cloudConfig = this.cloudConfig;
    if (backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_SELF_HOSTED && cloudConfig?.url) {
      const metadata = await cloudHeadJson(cloudConfig.url, {
        ...getMobileCloudRequestOptions(cloudConfig.allowInsecureHttp),
        token: cloudConfig.token,
        timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
        fetcher: this.fetchWithAbort,
      });
      if (!metadata?.exists) return null;
      return metadata.fingerprint;
    }
    if (backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_DROPBOX) {
      const metadata = await this.runDropboxOperation((accessToken) =>
        getDropboxAppDataMetadata(accessToken, this.fetchWithAbort)
      );
      this.dropboxLastRev = metadata.rev;
      return metadata.rev ? `dropbox:v1:rev=${metadata.rev}` : null;
    }
    return null;
  }

  private async recordFastSyncState(
    data: AppData,
    options: { allowRemoteFingerprintRead?: boolean } = {}
  ): Promise<void> {
    const fastSyncScope = this.fastSyncScope;
    if (!fastSyncScope || hasPendingSyncSideEffects(data)) return;
    if (useTaskStore.getState().lastDataChangeAt > this.localSnapshotChangeAt) return;
    if (this.lastRemoteWriteMergedServerData) return;
    let remoteFingerprint: string | null = null;
    if (this.backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_DROPBOX && this.dropboxLastRev) {
      remoteFingerprint = `dropbox:v1:rev=${this.dropboxLastRev}`;
    } else if (this.lastRemoteWriteFingerprint) {
      remoteFingerprint = this.lastRemoteWriteFingerprint;
    } else {
      if (options.allowRemoteFingerprintRead === false) return;
      try {
        remoteFingerprint = await this.readRemoteFingerprintForFastCheck();
      } catch (error) {
        logSyncWarning('Failed to refresh sync fast-check state', error);
        return;
      }
    }
    if (!remoteFingerprint) return;
    await writeFastSyncState({
      scope: fastSyncScope,
      localFingerprint: computeSyncPayloadFingerprint(data),
      remoteFingerprint,
      checkedAt: new Date().toISOString(),
    });
  }

  private async trySkipUnchangedFastSync(): Promise<MobileSyncResult | null> {
    // User-initiated sync: never trust the cached fingerprint pair — fall through
    // to the read check, which compares against actually-fetched remote data.
    if (this.manual) return null;
    const fastSyncScope = this.fastSyncScope;
    if (!fastSyncScope) return null;
    const fastCheckStartedAt = Date.now();
    this.step = 'fast-check';
    logSyncInfo('Sync step', { step: this.step });
    if (this.preSyncedLocalData) return null;
    const localDataForFastCheck = await this.readLocalDataForSyncCycle();
    this.ensureLocalSnapshotFresh();
    if (hasPendingSyncSideEffects(localDataForFastCheck)) return null;

    const localFingerprint = computeSyncPayloadFingerprint(localDataForFastCheck);
    const cached = await readFastSyncState(fastSyncScope);
    if (!cached || cached.localFingerprint !== localFingerprint) return null;

    let remoteFingerprint: string | null = null;
    try {
      remoteFingerprint = await this.readRemoteFingerprintForFastCheck();
    } catch (error) {
      logSyncWarning('Sync fast check failed; falling back to read-only comparison', error);
      return null;
    }
    if (!remoteFingerprint || remoteFingerprint !== cached.remoteFingerprint) return null;

    await writeFastSyncState({
      scope: fastSyncScope,
      localFingerprint,
      remoteFingerprint,
      checkedAt: new Date().toISOString(),
    });
    await applyLocalSyncStatus({
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'success',
      lastSyncError: undefined,
    });
    useTaskStore.getState().setError(null);
    logSyncInfo('Sync fast check found no changes', {
      backend: this.backend,
      elapsedMs: getSyncDiagnosticElapsedMs(fastCheckStartedAt),
      ...buildSyncDataDiagnostics(localDataForFastCheck),
    });
    return { success: true, skipped: 'unchanged' };
  }

  private async trySkipUnchangedReadSync(): Promise<MobileSyncResult | null> {
    const readCheckStartedAt = Date.now();
    this.step = 'read-check';
    logSyncInfo('Sync step', { step: this.step });
    if (this.preSyncedLocalData) return null;
    const localDataForReadCheck = await this.readLocalDataForSyncCycle();
    this.ensureLocalSnapshotFresh();
    if (hasPendingSyncSideEffects(localDataForReadCheck)) return null;

    const remoteData = await this.readRemoteDataByBackend();
    this.ensureLocalSnapshotFresh();
    if (!remoteData) return null;
    this.readCheckRemoteData = remoteData;

    const localSanitized = sanitizeAppDataForRemote(localDataForReadCheck);
    const remoteSanitized = sanitizeAppDataForRemote(remoteData);
    if (!areSyncPayloadsEqual(remoteSanitized, localSanitized)) return null;

    await this.recordFastSyncState(localDataForReadCheck, { allowRemoteFingerprintRead: false });
    await applyLocalSyncStatus({
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'success',
      lastSyncError: undefined,
    });
    this.readCheckRemoteData = undefined;
    useTaskStore.getState().setError(null);
    logSyncInfo('Sync read check found no changes', {
      backend: this.backend,
      elapsedMs: getSyncDiagnosticElapsedMs(readCheckStartedAt),
      ...buildSyncDataDiagnostics(localDataForReadCheck),
    });
    return { success: true, skipped: 'unchanged' };
  }

  /** Full merge cycle plus post-merge attachment sync, cleanup, fast-sync bookkeeping, and store refresh. */
  private async runMergePhase(): Promise<MobileSyncResult> {
    const backend = this.backend;
    this.startVisibleSyncActivity();
    const syncCycleStartedAt = Date.now();
    const syncResult = await performSyncCycle({
      readLocal: this.readLocalDataForSyncCycle,
      readRemote: this.readRemoteDataByBackend,
      writeLocal: async (data) => {
        this.ensureLocalSnapshotFresh();
        await mobileStorage.saveData(data);
        this.wroteLocal = true;
      },
      clearPendingRemoteWriteAfterLocalAbort: async (pendingAt) => {
        const current = getInMemoryAppDataSnapshot();
        if (current.settings.pendingRemoteWriteAt && current.settings.pendingRemoteWriteAt !== pendingAt) return;
        await mobileStorage.saveData({
          ...current,
          settings: {
            ...current.settings,
            pendingRemoteWriteAt: undefined,
            pendingRemoteWriteRetryAt: undefined,
            pendingRemoteWriteAttempts: undefined,
          },
        });
        this.wroteLocal = true;
      },
      flushPendingLocalBeforeRetryRead: flushPendingSave,
      prepareRemoteWrite: this.prepareRemoteWriteData,
      writeRemote: async (data) => {
        this.ensureLocalSnapshotFresh();
        await this.writeRemoteDataByBackend(data);
      },
      onStep: (next) => {
        this.step = next;
        logSyncInfo('Sync step', { step: this.step });
      },
      historyContext: {
        backend,
        type: 'merge',
      },
    });
    if (syncResult.status === 'skipped') {
      logSyncInfo('Sync skipped while pending remote write backoff is active', {
        backend,
        retryInMs: String(Math.ceil(syncResult.retryInMs)),
      });
      logSyncDiagnostic('Sync diagnostic skipped', syncCycleStartedAt, {
        backend,
        step: this.step,
        success: 'true',
        skipped: syncResult.skipped,
        retryInMs: String(Math.ceil(syncResult.retryInMs)),
        ...buildSyncDataDiagnostics(syncResult.data),
      });
      return { success: true, skipped: 'pendingRemoteWriteBackoff' };
    }
    logSyncDiagnostic('Sync diagnostic merge cycle complete', syncCycleStartedAt, {
      backend,
      status: syncResult.status,
      ...buildSyncDataDiagnostics(syncResult.data),
    });

    const stats = syncResult.stats;
    const mergeLog = buildMergeSummaryLog(stats, { clockSkewThresholdMs: CLOCK_SKEW_THRESHOLD_MS });
    if (mergeLog) {
      void logInfo(
        mergeLog.message,
        {
          scope: 'sync',
          extra: mergeLog.extra,
        }
      );
    }
    let mergedData = syncResult.data;
    let canRecordFastSyncState = true;
    const markFastSyncStateUnsafe = () => {
      canRecordFastSyncState = false;
    };
    this.ensureLocalSnapshotFresh();
    await persistExternalCalendars(mergedData);

    const webdavConfig = this.webdavConfig;
    const cloudConfig = this.cloudConfig;
    const fileSyncPath = this.fileSyncPath;
    const applyAttachmentSyncMutation = async (
      syncAttachments: (candidateData: AppData) => Promise<boolean>
    ): Promise<void> => {
      const attachmentSyncStartedAt = Date.now();
      const candidateData = cloneAppData(mergedData);
      const mutated = await syncAttachments(candidateData);
      logSyncDiagnostic('Sync diagnostic attachment sync complete', attachmentSyncStartedAt, {
        backend,
        mutated: mutated ? 'true' : 'false',
        ...buildSyncDataDiagnostics(candidateData),
      });
      if (!mutated) return;
      this.ensureLocalSnapshotFresh();
      mergedData = candidateData;
      markFastSyncStateUnsafe();
      await mobileStorage.saveData(mergedData);
      this.wroteLocal = true;
    };

    if (await hasPendingAttachmentSyncWork(mergedData)) {
      this.step = 'attachments';
      logSyncInfo('Sync step', { step: this.step });
      this.ensureLocalSnapshotFresh();
      if (backend === 'webdav' && webdavConfig?.url) {
        await this.ensureNetworkStillAvailable();
        const baseSyncUrl = getBaseSyncUrl(webdavConfig.url);
        await applyAttachmentSyncMutation((candidateData) =>
          syncWebdavAttachments(candidateData, webdavConfig, baseSyncUrl, this.requestAbortController.signal)
        );
      }

      if (backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_SELF_HOSTED && cloudConfig?.url) {
        await this.ensureNetworkStillAvailable();
        const baseSyncUrl = getCloudBaseUrl(cloudConfig.url);
        await applyAttachmentSyncMutation((candidateData) =>
          syncCloudAttachments(candidateData, cloudConfig, baseSyncUrl, {
            assertCurrent: this.ensureLocalSnapshotFresh,
            signal: this.requestAbortController.signal,
          })
        );
      }

      if (backend === 'cloud' && this.cloudProvider === CLOUD_PROVIDER_DROPBOX) {
        await this.ensureNetworkStillAvailable();
        await applyAttachmentSyncMutation((candidateData) =>
          syncDropboxAttachments(candidateData, this.dropboxClientId, this.fetchWithAbort, {
            signal: this.requestAbortController.signal,
          })
        );
      }

      if (backend === 'file' && fileSyncPath) {
        await applyAttachmentSyncMutation((candidateData) =>
          syncFileAttachments(candidateData, fileSyncPath, this.requestAbortController.signal)
        );
      }
    } else {
      logSyncInfo('Attachment sync skipped', {
        backend,
        reason: 'no-pending-work',
      });
    }

    await cleanupAttachmentTempFiles();

    if (shouldRunAttachmentCleanup(mergedData.settings.attachments?.lastCleanupAt, CLEANUP_INTERVAL_MS)) {
      this.step = 'attachments_cleanup';
      logSyncInfo('Sync step', { step: this.step });
      this.ensureLocalSnapshotFresh();
      await this.ensureNetworkStillAvailable();
      const cleanupResult = await runMobileAttachmentCleanup({
        appData: mergedData,
        backend,
        webdavConfig,
        cloudConfig,
        cloudProvider: this.cloudProvider,
        fileSyncPath,
        fetcher: this.fetchWithAbort,
        ensureLocalSnapshotFresh: this.ensureLocalSnapshotFresh,
        deleteDropboxAttachment: (cloudKey) =>
          this.runDropboxOperation((accessToken) => deleteDropboxFile(accessToken, cloudKey, this.fetchWithAbort)),
        isRemoteMissingError: (error) => error instanceof DropboxFileNotFoundError,
        logSyncInfo,
        logSyncWarning,
      });
      mergedData = cleanupResult.appData;
      if (cleanupResult.shouldInvalidateFastSyncState) {
        markFastSyncStateUnsafe();
      }
      this.ensureLocalSnapshotFresh();
      await mobileStorage.saveData(mergedData);
      this.wroteLocal = true;
    }

    if (canRecordFastSyncState) {
      await this.recordFastSyncState(mergedData);
    }

    this.step = 'refresh';
    this.ensureLocalSnapshotFresh();
    // mergedData is exactly what the last writeLocal persisted, so refresh the
    // store from it directly instead of re-reading the full dataset from SQLite.
    await useTaskStore.getState().fetchData({ silent: true, preloadedData: mergedData });
    logSyncDiagnostic('Sync diagnostic complete', this.syncDiagnosticStartedAt, {
      backend,
      step: this.step,
      status: syncResult.status,
      success: 'true',
      wroteLocal: String(this.wroteLocal),
      ...buildSyncDataDiagnostics(mergedData),
    });
    return { success: true, stats: syncResult.stats };
  }

  /** Persist attachment pre-sync mutations that would otherwise be lost when a cycle aborts early. */
  private async persistPreSyncedDataAfterAbort(): Promise<void> {
    if (!this.preSyncedLocalData || this.wroteLocal) return;
    const inMemorySnapshot = getInMemoryAppDataSnapshot();
    const reconciledData = mergeAppData(this.preSyncedLocalData, inMemorySnapshot);
    await mobileStorage.saveData(reconciledData);
    this.wroteLocal = true;
  }

  private async handleRunError(error: unknown): Promise<MobileSyncResult> {
    const backend = this.backend;
    if (this.requestAbortController.signal.aborted && activeMobileSyncAbortReason === 'lifecycle') {
      logSyncInfo('Sync aborted by app lifecycle transition', { backend, step: this.step });
      logSyncDiagnostic('Sync diagnostic lifecycle abort', this.syncDiagnosticStartedAt, {
        backend,
        step: this.step,
        success: 'true',
        aborted: 'lifecycle',
      });
      this.queueFollowUp();
      return { success: true };
    }
    if (error instanceof LocalSyncAbort) {
      await this.persistPreSyncedDataAfterAbort();
      logSyncInfo('Sync requeued after local data changed', {
        backend,
        step: this.step,
        wroteLocal: String(this.wroteLocal),
      });
      logSyncDiagnostic('Sync diagnostic requeued', this.syncDiagnosticStartedAt, {
        backend,
        step: this.step,
        success: 'true',
        wroteLocal: String(this.wroteLocal),
      });
      return buildRequeuedSkipResult();
    }
    const likelyOfflineRequestError = isLikelyOfflineSyncError(error);
    if (isRemoteSyncBackend(backend) && (this.networkWentOffline || likelyOfflineRequestError)) {
      if (!this.offlineDetectionCause && likelyOfflineRequestError) {
        this.offlineDetectionCause = 'request-error';
      }
      await this.persistPreSyncedDataAfterAbort();
      if (this.wroteLocal) {
        try {
          await useTaskStore.getState().fetchData({ silent: true });
        } catch (fetchError) {
          logSyncWarning('[Mobile] Failed to refresh store after offline sync skip', fetchError);
        }
      }
      logSyncInfo('Sync skipped after offline detection', {
        backend,
        step: this.step,
        reason: this.offlineDetectionCause ?? 'unknown',
        ...(this.lastOfflineNetworkStatus ? formatNetworkStatusForLog(this.lastOfflineNetworkStatus) : {}),
      });
      logSyncDiagnostic('Sync diagnostic offline skip', this.syncDiagnosticStartedAt, {
        backend,
        step: this.step,
        success: 'true',
        skipped: 'offline',
        reason: this.offlineDetectionCause ?? 'unknown',
      });
      return buildOfflineSkipResult();
    }
    const now = new Date().toISOString();
    const logPath = await logSyncError(error, { backend, step: this.step, url: this.syncUrl });
    const logHint = logPath ? ` (log: ${logPath})` : '';
    const safeMessage = formatSyncErrorMessage(error, backend);
    logSyncDiagnostic('Sync diagnostic error', this.syncDiagnosticStartedAt, {
      backend,
      step: this.step,
      success: 'false',
      error: safeMessage,
    });
    const nextHistory = appendSyncHistory(useTaskStore.getState().settings, {
      at: now,
      status: 'error',
      backend,
      type: 'merge',
      conflicts: 0,
      conflictIds: [],
      maxClockSkewMs: 0,
      timestampAdjustments: 0,
      details: this.step,
      error: `${safeMessage}${logHint}`,
    });
    try {
      if (this.wroteLocal) {
        await useTaskStore.getState().fetchData({ silent: true });
      }
      await applyLocalSyncStatus({
        lastSyncAt: now,
        lastSyncStatus: 'error',
        lastSyncError: `${safeMessage}${logHint}`,
        lastSyncStats: undefined,
        lastSyncHistory: nextHistory,
      });
    } catch (e) {
      logSyncWarning('[Mobile] Failed to persist sync error', e);
    }

    return { success: false, error: `${safeMessage}${logHint}` };
  }

  private releaseResources(): void {
    if (activeMobileSyncAbortController === this.requestAbortController) {
      activeMobileSyncAbortController = null;
      activeMobileSyncAbortReason = null;
    }
    try {
      this.networkSubscription?.remove?.();
    } catch (error) {
      logSyncWarning('Failed to unsubscribe network listener after sync', error);
    }
  }
}

const mobileSyncOrchestrator = createSyncOrchestrator<MobileSyncRequest | undefined, MobileSyncResult>({
  runCycle: async (request, { requestFollowUp }) => {
    const rawBackend = (await getCachedConfigValue(SYNC_BACKEND_KEY))?.trim() ?? null;
    const backend: SyncBackend = getSupportedBackend(rawBackend);

    if (backend === 'off') {
      return { success: true };
    }
    if (await shouldSkipSyncForOfflineState(backend)) {
      return buildOfflineSkipResult();
    }

    return new MobileSyncRun(backend, request, requestFollowUp).run();
  },
  onQueuedRunComplete: (queuedResult) => {
    if (!queuedResult.success) {
      logSyncWarning('[Mobile] Queued sync failed', queuedResult.error);
    }
  },
  onQueuedRunError: (error) => {
    logSyncWarning('[Mobile] Queued sync crashed', error);
  },
  onDrained: () => {
    setMobileSyncActivityState('idle');
  },
});

/** `manual` marks a user-initiated sync: it always runs the full read/merge cycle,
 *  never the fast-check skip, so a stale cached fingerprint can't hide remote data. */
export async function performMobileSync(
  syncPathOverride?: string,
  options?: { manual?: boolean }
): Promise<MobileSyncResult> {
  return mobileSyncOrchestrator.run({ syncPathOverride, manual: options?.manual });
}

export function abortMobileSync(): boolean {
  if (!activeMobileSyncAbortController) return false;
  activeMobileSyncAbortReason = 'lifecycle';
  activeMobileSyncAbortController.abort();
  return true;
}

export const __mobileSyncTestUtils = {
  reset() {
    mobileSyncOrchestrator.reset();
    clearMobileSyncConfigCache();
    mobileSyncActivityListeners.clear();
    mobileSyncActivityState = 'idle';
    webdavSyncRateLimitController.reset();
    activeMobileSyncAbortController = null;
    activeMobileSyncAbortReason = null;
  },
  getWebdavSyncBlockedUntil() {
    return webdavSyncRateLimitController.getBlockedUntil();
  },
};
