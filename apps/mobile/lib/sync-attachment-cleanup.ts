import {
  AppData,
  cloudDeleteFile,
  decodeUriSafe,
  runAttachmentCleanupLifecycle,
  sanitizeAttachmentUriForSyncMerge,
  webdavDeleteFile,
  type CloudProvider,
} from '@mindwtr/core';
import { getBaseSyncUrl, getCloudBaseUrl } from './attachment-sync';
import { ATTACHMENTS_DIR_NAME } from './attachment-sync-utils';
import * as FileSystem from './file-system';
import { getFileSyncBaseDir, type SyncBackend } from './sync-service-utils';
import { getMobileCloudRequestOptions, getMobileWebDavRequestOptions } from './webdav-request-options';

const ATTACHMENT_CLEANUP_BATCH_LIMIT = 25;

type MobileWebDavCleanupConfig = {
  url: string;
  username: string;
  password: string;
  allowInsecureHttp?: boolean;
};

type MobileCloudCleanupConfig = {
  url: string;
  token: string;
  allowInsecureHttp?: boolean;
};

type MobileAttachmentCleanupOptions = {
  appData: AppData;
  backend: SyncBackend;
  webdavConfig: MobileWebDavCleanupConfig | null;
  cloudConfig: MobileCloudCleanupConfig | null;
  cloudProvider: CloudProvider;
  fileSyncPath: string | null;
  fetcher: typeof fetch;
  ensureLocalSnapshotFresh: () => void;
  deleteDropboxAttachment: (cloudKey: string) => Promise<void>;
  isRemoteMissingError: (error: unknown) => boolean;
  logSyncInfo: (message: string, extra?: Record<string, string>) => void;
  logSyncWarning: (message: string, error?: unknown) => void;
};

type MobileAttachmentCleanupResult = {
  appData: AppData;
  shouldInvalidateFastSyncState: boolean;
};

const getManagedAttachmentCleanupPrefixes = (): string[] => {
  return [FileSystem.documentDirectory, FileSystem.cacheDirectory]
    .filter((base): base is string => typeof base === 'string' && base.length > 0)
    .map((base) => {
      const normalized = base.endsWith('/') ? base : `${base}/`;
      return `${normalized}${ATTACHMENTS_DIR_NAME}/`;
    });
};

const deleteAttachmentFile = async (
  uri: string | undefined,
  logSyncWarning: MobileAttachmentCleanupOptions['logSyncWarning']
): Promise<void> => {
  const safeUri = sanitizeAttachmentUriForSyncMerge(uri);
  if (!safeUri) return;
  if (safeUri.startsWith('content://') || /^https?:\/\//i.test(safeUri)) return;
  const decodedUri = decodeUriSafe(safeUri);
  const managedPrefixes = getManagedAttachmentCleanupPrefixes();
  if (!managedPrefixes.some((prefix) => safeUri.startsWith(prefix) || decodedUri.startsWith(prefix))) {
    return;
  }
  try {
    await FileSystem.deleteAsync(safeUri, { idempotent: true });
  } catch (error) {
    logSyncWarning('Failed to delete attachment file', error);
  }
};

export const runMobileAttachmentCleanup = async (
  options: MobileAttachmentCleanupOptions
): Promise<MobileAttachmentCleanupResult> => {
  const isWebdavBackend = options.backend === 'webdav' && Boolean(options.webdavConfig?.url);
  const isCloudBackend = options.backend === 'cloud'
    && options.cloudProvider === 'selfhosted'
    && Boolean(options.cloudConfig?.url);
  const isDropboxBackend = options.backend === 'cloud' && options.cloudProvider === 'dropbox';
  const fileBaseDir = options.backend === 'file'
    && options.fileSyncPath
    && !options.fileSyncPath.startsWith('content://')
    ? getFileSyncBaseDir(options.fileSyncPath)
    : null;
  const canAttemptRemoteDelete = Boolean(
    isWebdavBackend
    || isCloudBackend
    || isDropboxBackend
    || fileBaseDir
  );
  const deleteRemoteAttachment = canAttemptRemoteDelete
    ? async (target: { cloudKey: string }) => {
      if (isWebdavBackend && options.webdavConfig) {
        const baseSyncUrl = getBaseSyncUrl(options.webdavConfig.url);
        await webdavDeleteFile(baseSyncUrl + '/' + target.cloudKey, {
          ...getMobileWebDavRequestOptions(options.webdavConfig.allowInsecureHttp),
          username: options.webdavConfig.username,
          password: options.webdavConfig.password,
          timeoutMs: 30_000,
          fetcher: options.fetcher,
        });
      } else if (isCloudBackend && options.cloudConfig) {
        const baseSyncUrl = getCloudBaseUrl(options.cloudConfig.url);
        await cloudDeleteFile(baseSyncUrl + '/' + target.cloudKey, {
          ...getMobileCloudRequestOptions(options.cloudConfig.allowInsecureHttp),
          token: options.cloudConfig.token,
          timeoutMs: 30_000,
          fetcher: options.fetcher,
        });
      } else if (isDropboxBackend) {
        await options.deleteDropboxAttachment(target.cloudKey);
      } else if (fileBaseDir) {
        await FileSystem.deleteAsync(fileBaseDir + '/' + target.cloudKey, { idempotent: true });
      }
    }
    : undefined;

  const result = await runAttachmentCleanupLifecycle({
    appData: options.appData,
    maxAttachmentTargets: ATTACHMENT_CLEANUP_BATCH_LIMIT,
    beforeEachAttachment: options.ensureLocalSnapshotFresh,
    deleteLocalAttachment: (attachment) => deleteAttachmentFile(
      attachment.uri,
      options.logSyncWarning,
    ),
    deleteRemoteAttachment,
    isRemoteMissingError: options.isRemoteMissingError,
    onRemoteAttachmentMissing: (target) => {
      options.logSyncInfo('Remote attachment already missing during cleanup', {
        cloudKey: target.cloudKey,
      });
    },
    onRemoteDeleteError: (_target, error) => {
      options.logSyncWarning('Failed to delete remote attachment', error);
    },
    onBatchLimitReached: ({ limit, total }) => {
      options.logSyncInfo('Attachment cleanup batch limit reached', {
        limit: String(limit),
        total: String(total),
      });
    },
  });
  return {
    appData: result.appData,
    shouldInvalidateFastSyncState: result.shouldInvalidateFastSyncState,
  };
};
