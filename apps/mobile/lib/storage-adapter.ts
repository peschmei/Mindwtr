import { AppData, mergeAppDataWithStats, SqliteAdapter, searchAll, splitSqlStatements, type SqliteClient, type CalendarSyncEntry, StorageAdapter, type Task } from '@mindwtr/core';
import { AppState, NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { WIDGET_DATA_KEY } from './widget-data';
import { updateMobileWidgetFromData } from './widget-service';
import { logError, logInfo, logWarn } from './app-log';
import { markStartupPhase, measureStartupPhase } from './startup-profiler';

const DATA_KEY = WIDGET_DATA_KEY;
const STARTUP_BACKUP_VERSION_KEY = `${DATA_KEY}:startup-backup-version`;
const STARTUP_BACKUP_UPDATED_AT_KEY = `${DATA_KEY}:startup-backup-updated-at`;
const STARTUP_BACKUP_VERSION = '2';
const LEGACY_DATA_KEYS = ['focus-gtd-data', 'gtd-todo-data', 'gtd-data'];
const EMPTY_APP_DATA: AppData = { tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} };
const SQLITE_STARTUP_TIMEOUT_MS = 3_500;
const SQLITE_QUERY_TIMEOUT_MS = 2_500;
const SQLITE_RETRY_COOLDOWN_MS = 60_000;
const SQLITE_NATIVE_MODULE_UNAVAILABLE = 'Native SQLite module unavailable; rebuild or reinstall the app so op-sqlite is included';
// Cap how long a read may block on in-flight writes so a stalled save (e.g. a
// lost-promise native call) degrades to the existing fallback instead of hanging the UI.
const SQLITE_WRITE_WAIT_TIMEOUT_MS = 3_000;
// Diagnostics: only log waits/saves slow enough to matter, to keep the shared beta log readable.
const SQLITE_WRITE_WAIT_LOG_THRESHOLD_MS = 50;
const SQLITE_SLOW_WRITE_LOG_THRESHOLD_MS = 300;

let saveQueue: Promise<void> = Promise.resolve();

const enqueueSave = async (work: () => Promise<void>): Promise<void> => {
    const next = saveQueue.then(work, () => work());
    saveQueue = next.catch(() => undefined);
    return next;
};

const waitForQueuedSqliteWrites = async (): Promise<void> => {
    while (true) {
        const pendingSave = saveQueue;
        await pendingSave.catch(() => undefined);
        if (pendingSave === saveQueue) return;
    }
};

const SQLITE_DB_NAME = 'mindwtr.db';
// expo-sqlite stored the database under <documentDirectory>/SQLite; op-sqlite must
// open the exact same directory or existing installs would come up empty (ADR 0024).
const SQLITE_DIRECTORY_NAME = 'SQLite';

type SqliteState = {
    adapter: SqliteAdapter;
    client: SqliteClient;
};

let sqliteStatePromise: Promise<SqliteState> | null = null;
let sqliteStateRetryAfter = 0;
let sqliteOpenMode = 'unknown';
let sqliteDbPath: string | null = null;
let sqliteJournalDiagnostics: Record<string, string> | null = null;
let preferJsonBackup = false;
let preferJsonBackupUntil = 0;
let didWarnPreferJsonBackup = false;
let latestQueuedWriteStartedAtMs = 0;

const markQueuedWriteStarted = (): number => {
    const startedAtMs = Math.max(Date.now(), latestQueuedWriteStartedAtMs + 1);
    latestQueuedWriteStartedAtMs = startedAtMs;
    return startedAtMs;
};

const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error));
const buildStorageExtra = (message?: string, error?: unknown): Record<string, string> | undefined => {
    const extra: Record<string, string> = {};
    if (message) extra.message = message;
    if (error) {
        extra.error = formatError(error);
        if (error instanceof Error && error.stack) {
            extra.stack = error.stack;
        }
    }
    return Object.keys(extra).length ? extra : undefined;
};

const logStorageWarn = (message: string, error?: unknown, extra?: Record<string, string>) => {
    void logWarn(message, { scope: 'storage', extra: { ...buildStorageExtra(undefined, error), ...extra } });
};

// Diagnostic breadcrumb for the shared beta log; only written when diagnostics logging is on.
const logStorageInfo = (message: string, extra?: Record<string, string>) => {
    void logInfo(message, { scope: 'storage', extra });
};

const logStorageError = (message: string, error?: unknown) => {
    const err = error instanceof Error ? error : new Error(message);
    void logError(err, { scope: 'storage', extra: buildStorageExtra(message, error) });
};

const warnPreferJsonBackup = () => {
    if (didWarnPreferJsonBackup) return;
    logStorageWarn('[Storage] SQLite unavailable; using JSON backup for reads until SQLite recovers.');
    didWarnPreferJsonBackup = true;
};

const withOperationTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
};

// Wait for in-flight SQLite writes to finish before reading, but bounded: a save that
// stalls must not strand reads (each read site falls back when this throws).
const awaitQueuedSqliteWrites = async (phase: string): Promise<void> => {
    const startedAt = Date.now();
    try {
        await withOperationTimeout(
            waitForQueuedSqliteWrites(),
            SQLITE_WRITE_WAIT_TIMEOUT_MS,
            `Timed out waiting for queued SQLite writes before ${phase}`
        );
    } catch (error) {
        logStorageWarn('[Storage] Gave up waiting for queued SQLite writes; falling back', error, {
            phase,
            waitedMs: String(Date.now() - startedAt),
        });
        throw error;
    }
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= SQLITE_WRITE_WAIT_LOG_THRESHOLD_MS) {
        logStorageInfo('[Storage] Read waited for queued SQLite writes', {
            phase,
            waitedMs: String(waitedMs),
            ...(sqliteJournalDiagnostics ?? {}),
        });
    }
};

const shouldUseJsonBackupFastPath = () => preferJsonBackup && Date.now() < preferJsonBackupUntil;

const markPreferJsonBackup = () => {
    preferJsonBackup = true;
    preferJsonBackupUntil = Date.now() + SQLITE_RETRY_COOLDOWN_MS;
    warnPreferJsonBackup();
};

const clearPreferJsonBackup = () => {
    preferJsonBackup = false;
    preferJsonBackupUntil = 0;
    didWarnPreferJsonBackup = false;
};

const createOpSqliteClient = (db: any): SqliteClient => {
    const execSql = (sql: string, params: unknown[] = []) => {
        // op-sqlite rejects undefined bindings; the adapter's row builders emit null,
        // so mapping here only guards stray callers.
        const args = params.map((value) => (value === undefined ? null : value));
        return db.execute(sql, args);
    };

    // op-sqlite prepares a single statement per execute call, so multi-statement
    // schema strings are split and run one by one on the shared connection. Each
    // statement executes directly (no wrapper transaction), so connection pragmas
    // (journal_mode) apply for real and the adapter's explicit BEGIN IMMEDIATE…COMMIT
    // stays intact instead of committing per statement (#766). Splitting must be
    // trigger-aware: a naive split on ';' cuts CREATE TRIGGER bodies apart and
    // every statement fails with "incomplete input" (1.1.5-rc.1 regression).
    const exec = async (sql: string) => {
        for (const statement of splitSqlStatements(sql)) {
            await execSql(statement);
        }
    };

    return {
        run: async (sql: string, params: unknown[] = []) => {
            await execSql(sql, params);
        },
        all: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
            const result = await execSql(sql, params);
            return (result?.rows ?? []) as T[];
        },
        get: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
            const result = await execSql(sql, params);
            const rows = result?.rows;
            if (!rows || rows.length === 0) return undefined;
            return rows[0] as T;
        },
        exec,
    };
};

const stripFileUriScheme = (uri: string) => uri.replace(/^file:\/\//, '');

const resolveSqliteDirectoryUri = (): string | null => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FileSystem = require('expo-file-system');
        const documentUri: string | undefined = FileSystem?.Paths?.document?.uri;
        if (documentUri) {
            return `${documentUri.replace(/\/+$/, '')}/${SQLITE_DIRECTORY_NAME}`;
        }
    } catch {
        // fall through to the legacy API
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const LegacyFileSystem = require('expo-file-system/legacy');
        const documentDirectory: string | null | undefined = LegacyFileSystem?.documentDirectory;
        if (documentDirectory) {
            return `${documentDirectory.replace(/\/+$/, '')}/${SQLITE_DIRECTORY_NAME}`;
        }
    } catch {
        // resolved below as an error
    }
    return null;
};

// Fresh installs have no <documentDirectory>/SQLite yet; sqlite3_open does not
// create missing parent directories.
const ensureSqliteDirectoryExists = (directoryUri: string): void => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FileSystem = require('expo-file-system');
        if (typeof FileSystem?.Directory === 'function') {
            const directory = new FileSystem.Directory(directoryUri);
            if (!directory.exists) {
                directory.create({ intermediates: true });
            }
        }
    } catch (error) {
        logStorageWarn('[Storage] Failed to ensure SQLite directory exists', error, { directoryUri });
    }
};

const getSqliteUnavailableReason = (): string | null => {
    if (Constants.appOwnership === 'expo') {
        return 'SQLite disabled in Expo Go';
    }
    const hasInstalledProxy = Boolean(
        (globalThis as typeof globalThis & { __OPSQLiteProxy?: object }).__OPSQLiteProxy
    );
    if (!hasInstalledProxy && NativeModules.OPSQLite == null) {
        return SQLITE_NATIVE_MODULE_UNAVAILABLE;
    }
    return null;
};

const createSqliteClient = async (): Promise<SqliteClient> => {
    markStartupPhase('mobile.storage.sqlite_client.create:start');
    const unavailableReason = getSqliteUnavailableReason();
    if (unavailableReason) {
        throw new Error(unavailableReason);
    }
    // Use require to avoid async bundle loading in dev client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { open } = require('@op-engineering/op-sqlite');
    const directoryUri = resolveSqliteDirectoryUri();
    if (!directoryUri) {
        // Opening at op-sqlite's default location would look like an empty database
        // to existing installs; failing here routes callers to the JSON backup instead.
        throw new Error('Could not resolve the SQLite directory');
    }
    ensureSqliteDirectoryExists(directoryUri);
    const db = open({ name: SQLITE_DB_NAME, location: stripFileUriScheme(directoryUri) });
    sqliteDbPath = typeof db.getDbPath === 'function' ? String(db.getDbPath()) : null;
    sqliteOpenMode = 'op-sqlite';
    markStartupPhase('mobile.storage.sqlite_client.create:end', { mode: 'op-sqlite' });
    return createOpSqliteClient(db);
};

const sqliteHasAnyData = async (client: SqliteClient): Promise<boolean> => {
    const count = async (table: string) => {
        const row = await client.get<{ count?: number }>(`SELECT COUNT(*) as count FROM ${table}`);
        return Number(row?.count ?? 0);
    };
    const tables = ['tasks', 'projects', 'sections', 'areas', 'people', 'saved_filters', 'settings'];
    const counts = await Promise.all(tables.map((table) => count(table)));
    return counts.some((value) => value > 0);
};

const getLegacyJson = async (AsyncStorage: any): Promise<string | null> => {
    let jsonValue = await AsyncStorage.getItem(DATA_KEY);
    if (jsonValue != null) return jsonValue;
    for (const legacyKey of LEGACY_DATA_KEYS) {
        const legacyValue = await AsyncStorage.getItem(legacyKey);
        if (legacyValue != null) {
            await AsyncStorage.setItem(DATA_KEY, legacyValue);
            return legacyValue;
        }
    }
    return null;
};

const normalizeStoredAppData = (data: AppData): AppData => ({
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    projects: Array.isArray(data.projects) ? data.projects : [],
    sections: Array.isArray(data.sections) ? data.sections : [],
    areas: Array.isArray(data.areas) ? data.areas : [],
    people: Array.isArray(data.people) ? data.people : [],
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
});

const parseStoredAppDataJson = (jsonValue: string): AppData => (
    normalizeStoredAppData(JSON.parse(jsonValue) as AppData)
);

const saveStartupJsonBackup = async (
    AsyncStorage: any,
    data: AppData,
    phasePrefix: string,
    minimumUpdatedAtMs = 0,
): Promise<{ sizeChars: number }> => {
    const jsonValue = await measureStartupPhase(`${phasePrefix}.json_backup_stringify`, async () => JSON.stringify(data));
    const updatedAtMs = Math.max(Date.now(), minimumUpdatedAtMs);
    await measureStartupPhase(`${phasePrefix}.json_backup_set`, async () =>
        AsyncStorage.setItem(DATA_KEY, jsonValue)
    );
    await measureStartupPhase(`${phasePrefix}.json_backup_version_set`, async () =>
        AsyncStorage.setItem(STARTUP_BACKUP_VERSION_KEY, STARTUP_BACKUP_VERSION)
    );
    await measureStartupPhase(`${phasePrefix}.json_backup_updated_at_set`, async () =>
        AsyncStorage.setItem(STARTUP_BACKUP_UPDATED_AT_KEY, String(updatedAtMs))
    );
    return { sizeChars: jsonValue.length };
};

// The full-dataset JSON backup (stringify + AsyncStorage write) and the widget
// render took multiple seconds per save on large libraries and ran inside the
// save queue, so every read and every following tap waited on them (#766).
// Saves whose SQLite write succeeded only *schedule* the backup here: a single
// pending slot keeps the newest payload, a trailing timer coalesces bursts, and
// one serialized writer preserves write order. Paths where the backup IS the
// durable copy (SQLite failure) or where a fallback read is about to trust it
// await flushPendingStartupJsonBackup() to keep the freshness invariant
// (backupUpdatedAt >= latestQueuedWriteStartedAt) observable at read time.
//
// Even coalesced, the stringify + AsyncStorage write alone can take 10-20s on
// large libraries and starves the JS thread while it runs. SQLite is the
// durable copy on the healthy path, so the JSON copy (a downgrade/rollback
// safety net) only needs to land once every JSON_BACKUP_MIN_INTERVAL_MS while
// saves keep arriving; an AppState background/inactive transition flushes it
// immediately so the AsyncStorage copy stays close to fresh across process
// death (#766). Widget refresh is unaffected by the throttle: home-screen and
// lock-screen widgets get their own pending slot and short coalesce timer so
// they don't freeze for minutes while the backup is held back.
const JSON_BACKUP_COALESCE_MS = 1_000;
const JSON_BACKUP_MIN_INTERVAL_MS = 5 * 60_000;

type PendingJsonBackup = {
    data: AppData;
    phasePrefix: string;
    minimumUpdatedAtMs: number;
    coalescedSaves: number;
};

let pendingJsonBackup: PendingJsonBackup | null = null;
let jsonBackupTimer: ReturnType<typeof setTimeout> | null = null;
let jsonBackupWriter: Promise<void> = Promise.resolve();
let jsonBackupWriteInFlight = false;
let lastJsonBackupEndedAtMs = 0;

const computeJsonBackupDelayMs = (): number => {
    const remainingMs = lastJsonBackupEndedAtMs + JSON_BACKUP_MIN_INTERVAL_MS - Date.now();
    return Math.min(Math.max(remainingMs, JSON_BACKUP_COALESCE_MS), JSON_BACKUP_MIN_INTERVAL_MS);
};

// Only arms while nothing else will trigger a write: a timer already pending,
// or a write currently in flight (which re-arms itself on completion, using
// the freshly-updated lastJsonBackupEndedAtMs, if more work queued up behind
// it). This keeps the throttle correct even when saves arrive faster than a
// single backup write finishes (#766).
const armJsonBackupTimer = (): void => {
    if (jsonBackupTimer || jsonBackupWriteInFlight || !pendingJsonBackup) return;
    jsonBackupTimer = setTimeout(() => {
        jsonBackupTimer = null;
        void writeNextJsonBackup().catch((error) => {
            logStorageWarn('[Storage] Deferred JSON backup failed', error);
        });
    }, computeJsonBackupDelayMs());
};

const writeNextJsonBackup = (): Promise<void> => {
    jsonBackupWriter = jsonBackupWriter
        .catch(() => undefined)
        .then(async () => {
            const pending = pendingJsonBackup;
            if (!pending) return;
            pendingJsonBackup = null;
            jsonBackupWriteInFlight = true;
            const backupStartedAt = Date.now();
            let sizeChars = 0;
            try {
                ({ sizeChars } = await saveStartupJsonBackup(AsyncStorage, pending.data, pending.phasePrefix, pending.minimumUpdatedAtMs));
            } finally {
                lastJsonBackupEndedAtMs = Date.now();
                jsonBackupWriteInFlight = false;
            }
            const jsonBackupMs = lastJsonBackupEndedAtMs - backupStartedAt;
            if (jsonBackupMs >= SQLITE_SLOW_WRITE_LOG_THRESHOLD_MS) {
                logStorageInfo('[Storage] Slow post-save backup', {
                    jsonBackupMs: String(jsonBackupMs),
                    // AsyncStorage on Android cannot read a row back past the
                    // ~2MB CursorWindow limit; the size tells a shared log
                    // whether this backup is usable as a fallback at all.
                    sizeChars: String(sizeChars),
                    coalescedSaves: String(pending.coalescedSaves),
                });
            }
            // A save that arrived while this write was in flight left pendingJsonBackup
            // set but couldn't arm a timer (jsonBackupWriteInFlight guarded it); arm the
            // next throttle window now that lastJsonBackupEndedAtMs is current.
            armJsonBackupTimer();
        });
    return jsonBackupWriter;
};

const flushPendingStartupJsonBackup = async (): Promise<void> => {
    // Loop-drain — unlike the throttled timer path (armJsonBackupTimer), a
    // flush must land the newest pending payload even if a concurrent,
    // non-serialized caller (e.g. a fallback read racing a save) enqueues a
    // newer one while this flush is still waiting on an in-flight write.
    // Without the loop, a single write-then-return could leave a fresher
    // payload behind a just-armed 5-minute timer, so a caller relying on the
    // freshness invariant (backupUpdatedAt >= latestQueuedWriteStartedAt)
    // right after flush would see a stale backup (#766).
    while (pendingJsonBackup || jsonBackupWriteInFlight) {
        if (jsonBackupTimer) {
            clearTimeout(jsonBackupTimer);
            jsonBackupTimer = null;
        }
        if (pendingJsonBackup) {
            await writeNextJsonBackup();
        } else {
            // A write is already in flight; wait for it to settle and
            // re-check — it may have left a newer payload behind.
            await jsonBackupWriter.catch(() => undefined);
        }
    }
};

// The widget render is decoupled from the throttled JSON backup (#766): it
// keeps its own pending slot, short trailing coalesce, and serialized writer
// so home-screen/lock-screen widgets stay fresh per save burst even while the
// JSON backup itself is held back for up to JSON_BACKUP_MIN_INTERVAL_MS.
type PendingWidgetRefresh = {
    data: AppData;
    phasePrefix: string;
    coalescedRefreshes: number;
};

let pendingWidgetRefresh: PendingWidgetRefresh | null = null;
let widgetRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let widgetRefreshWriter: Promise<void> = Promise.resolve();

const writePendingWidgetRefresh = async (): Promise<void> => {
    const pending = pendingWidgetRefresh;
    if (!pending) return;
    pendingWidgetRefresh = null;
    const widgetStartedAt = Date.now();
    try {
        await measureStartupPhase(`${pending.phasePrefix}.widget_update`, async () =>
            updateMobileWidgetFromData(pending.data)
        );
    } catch (error) {
        logStorageWarn('[Widgets] Failed to update mobile widget after backup', error);
    }
    const widgetMs = Date.now() - widgetStartedAt;
    if (widgetMs >= SQLITE_SLOW_WRITE_LOG_THRESHOLD_MS) {
        logStorageInfo('[Storage] Slow widget refresh', {
            widgetMs: String(widgetMs),
            coalescedRefreshes: String(pending.coalescedRefreshes),
        });
    }
};

const drainWidgetRefreshQueue = (): Promise<void> => {
    widgetRefreshWriter = widgetRefreshWriter
        .catch(() => undefined)
        .then(async () => {
            while (pendingWidgetRefresh) {
                await writePendingWidgetRefresh();
            }
        });
    return widgetRefreshWriter;
};

const scheduleWidgetRefresh = (data: AppData, phasePrefix: string): void => {
    pendingWidgetRefresh = {
        data,
        phasePrefix,
        coalescedRefreshes: (pendingWidgetRefresh?.coalescedRefreshes ?? 0) + 1,
    };
    if (widgetRefreshTimer) return;
    widgetRefreshTimer = setTimeout(() => {
        widgetRefreshTimer = null;
        void drainWidgetRefreshQueue().catch((error) => {
            logStorageWarn('[Widgets] Deferred widget refresh failed', error);
        });
    }, JSON_BACKUP_COALESCE_MS);
};

const flushPendingWidgetRefresh = async (): Promise<void> => {
    if (widgetRefreshTimer) {
        clearTimeout(widgetRefreshTimer);
        widgetRefreshTimer = null;
    }
    await drainWidgetRefreshQueue();
};

const scheduleStartupJsonBackup = (
    data: AppData,
    phasePrefix: string,
    minimumUpdatedAtMs = 0,
): void => {
    pendingJsonBackup = {
        data,
        phasePrefix,
        minimumUpdatedAtMs: Math.max(pendingJsonBackup?.minimumUpdatedAtMs ?? 0, minimumUpdatedAtMs),
        coalescedSaves: (pendingJsonBackup?.coalescedSaves ?? 0) + 1,
    };
    armJsonBackupTimer();
    scheduleWidgetRefresh(data, phasePrefix);
};

let appStateListenerRegistered = false;

// Keeps the AsyncStorage copy near-fresh for the pre-1.1.5 downgrade path and
// for process death after backgrounding, without waiting out the throttle
// window while the app stays foregrounded and busy (#766). Feature-detected
// because AppState isn't available in every host environment (vitest/jsdom
// have no native AppState module) — this must not crash module load there.
const registerBackgroundFlushListener = (): void => {
    if (Platform.OS === 'web' || appStateListenerRegistered) return;
    const appStateModule = AppState as unknown as { addEventListener?: (...args: any[]) => unknown } | undefined;
    if (typeof appStateModule?.addEventListener !== 'function') return;
    appStateListenerRegistered = true;
    (AppState as any).addEventListener('change', (nextState: string) => {
        if (nextState !== 'background' && nextState !== 'inactive') return;
        flushPendingStartupJsonBackup().catch((error) => {
            logStorageWarn('[Storage] Failed to flush JSON backup on app background', error);
        });
    });
};

const readStartupJsonBackupUpdatedAt = async (AsyncStorage: any): Promise<number | null> => {
    const raw = await AsyncStorage.getItem(STARTUP_BACKUP_UPDATED_AT_KEY);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const assertJsonBackupFreshEnough = async (AsyncStorage: any, phase: string): Promise<void> => {
    if (latestQueuedWriteStartedAtMs <= 0) return;
    const backupUpdatedAtMs = await readStartupJsonBackupUpdatedAt(AsyncStorage);
    if (backupUpdatedAtMs !== null && backupUpdatedAtMs >= latestQueuedWriteStartedAtMs) return;
    logStorageWarn('[Storage] Refusing stale JSON backup fallback', undefined, {
        phase,
        backupUpdatedAtMs: backupUpdatedAtMs === null ? 'missing' : String(backupUpdatedAtMs),
        latestQueuedWriteStartedAtMs: String(latestQueuedWriteStartedAtMs),
    });
    throw new Error('JSON backup is older than the latest queued SQLite write. Please wait for the save to finish and try again.');
};

export const getMobileStartupSnapshotFromBackup = async (): Promise<AppData | null> => {
    const backupVersion = await AsyncStorage.getItem(STARTUP_BACKUP_VERSION_KEY);
    if (backupVersion !== STARTUP_BACKUP_VERSION) {
        return null;
    }
    const jsonValue = await getLegacyJson(AsyncStorage);
    if (jsonValue == null) {
        return null;
    }
    try {
        return parseStoredAppDataJson(jsonValue);
    } catch (error) {
        logStorageWarn('[Storage] Failed to parse startup JSON backup snapshot', error);
        return null;
    }
};

// 1.1.5-rc.1 shipped with a broken exec splitter, so SQLite init failed and every
// save on that build landed only in the AsyncStorage JSON backup. Once SQLite works
// again it holds pre-rc.1 data and the normal "migrate only into an empty DB" path
// would silently drop everything written on rc.1. Recover by merging the backup into
// SQLite once, through the same revision-aware merge sync uses (idempotent, LWW,
// tombstone-safe). Never blocks startup: any failure is logged and retried next launch.
const SQLITE_JSON_RECONCILE_KEY = `${DATA_KEY}:sqlite-json-reconcile-v1`;

const reconcileJsonBackupIntoSqlite = async (
    adapter: SqliteAdapter,
    currentSnapshot?: AppData,
): Promise<void> => {
    if (await AsyncStorage.getItem(SQLITE_JSON_RECONCILE_KEY) != null) return;
    const backupVersion = await AsyncStorage.getItem(STARTUP_BACKUP_VERSION_KEY);
    if (backupVersion !== STARTUP_BACKUP_VERSION) {
        // Only merge a backup maintained by the current SQLite bridge. An old,
        // unmarked legacy snapshot may be stale and must not reintroduce entities
        // after SQLite has already become the primary store.
        await AsyncStorage.setItem(SQLITE_JSON_RECONCILE_KEY, '1');
        return;
    }
    let jsonValue: string | null = null;
    try {
        jsonValue = await getLegacyJson(AsyncStorage);
    } catch (error) {
        // Oversized backups (> Android's 2MB CursorWindow) are unreadable; there is
        // nothing to recover from them, so don't fail init and don't mark done.
        logStorageWarn('[Storage] Skipped JSON backup reconcile; backup unreadable', error);
        return;
    }
    if (jsonValue != null) {
        let backup: AppData;
        try {
            backup = parseStoredAppDataJson(jsonValue);
        } catch (error) {
            // A corrupt backup has nothing to recover; don't re-parse it every launch.
            logStorageWarn('[Storage] Skipped JSON backup reconcile; backup did not parse', error);
            await AsyncStorage.setItem(SQLITE_JSON_RECONCILE_KEY, '1');
            return;
        }
        const current = currentSnapshot ?? await adapter.getData();
        const { data: merged, stats } = mergeAppDataWithStats(current, backup);
        await adapter.saveData(merged);
        logStorageInfo('[Storage] Reconciled JSON backup into SQLite', {
            backupTasks: String(backup.tasks.length),
            sqliteTasks: String(current.tasks.length),
            mergedTasks: String(merged.tasks.length),
            tasksFromBackup: String((stats.tasks?.incomingOnly ?? 0) + (stats.tasks?.resolvedUsingIncoming ?? 0)),
        });
    }
    await AsyncStorage.setItem(SQLITE_JSON_RECONCILE_KEY, '1');
};

const prepareSqliteData = async (adapter: SqliteAdapter, client: SqliteClient): Promise<void> => {
    let readableSnapshot: AppData | undefined;
    let hasData: boolean;
    try {
        hasData = await measureStartupPhase('mobile.storage.sqlite_init.has_any_data', async () =>
            sqliteHasAnyData(client)
        );
    } catch (error) {
        // A failed count means unknown, never empty. If the full read still works,
        // use that authoritative snapshot to classify and reconcile safely.
        if (__DEV__) {
            logStorageWarn('[Storage] SQLite availability check failed; using full read', error);
        }
        readableSnapshot = await adapter.getData();
        hasData = (readableSnapshot.tasks?.length ?? 0) > 0
            || (readableSnapshot.projects?.length ?? 0) > 0
            || (readableSnapshot.sections?.length ?? 0) > 0
            || (readableSnapshot.areas?.length ?? 0) > 0
            || (readableSnapshot.people?.length ?? 0) > 0
            || Object.keys(readableSnapshot.settings ?? {}).length > 0;
    }
    if (hasData) {
        try {
            await measureStartupPhase('mobile.storage.sqlite_init.reconcile_json_backup', async () =>
                reconcileJsonBackupIntoSqlite(adapter, readableSnapshot)
            );
        } catch (error) {
            logStorageWarn('[Storage] Failed to reconcile JSON backup into SQLite', error);
        }
        return;
    }

    const jsonValue = await measureStartupPhase('mobile.storage.sqlite_init.read_legacy_json', async () =>
        getLegacyJson(AsyncStorage)
    );
    if (jsonValue == null) return;
    try {
        const backup = parseStoredAppDataJson(jsonValue);
        // Re-read after the emptiness probe and merge even on first migration.
        // A second process may have inserted rows between the two operations;
        // promoting the JSON snapshot directly would make those rows omissions.
        const current = readableSnapshot ?? await adapter.getData();
        const { data: merged } = mergeAppDataWithStats(current, backup);
        // Ensure fallback stays consistent before attempting the SQLite write.
        await saveStartupJsonBackup(AsyncStorage, merged, 'mobile.storage.sqlite_init.migrate');
        await measureStartupPhase('mobile.storage.sqlite_init.migrate_json_to_sqlite', async () =>
            adapter.saveData(merged)
        );
        await AsyncStorage.setItem(SQLITE_JSON_RECONCILE_KEY, '1');
    } catch (error) {
        logStorageWarn('[Storage] Failed to migrate JSON data to SQLite', error);
    }
};

const initSqliteState = async (): Promise<SqliteState> => {
    markStartupPhase('mobile.storage.sqlite_init.start');
    const client = await measureStartupPhase('mobile.storage.sqlite_init.create_client', async () => createSqliteClient());
    const adapter = new SqliteAdapter(client);
    await measureStartupPhase('mobile.storage.sqlite_init.ensure_schema', async () => adapter.ensureSchema());
    // Diagnostic: confirm whether WAL actually took effect on this device. Init runs
    // during the getData that loads the settings which enable diagnostic logging, so a
    // log line written here is dropped — capture the values and attach them to the
    // slow-save/read-wait logs that fire later instead.
    try {
        const journalRow = await client.get<{ journal_mode?: string }>('PRAGMA journal_mode');
        const busyRow = await client.get<{ timeout?: number }>('PRAGMA busy_timeout');
        sqliteJournalDiagnostics = {
            journalMode: String(journalRow?.journal_mode ?? 'unknown'),
            busyTimeoutMs: String(busyRow?.timeout ?? 'unknown'),
            openMode: sqliteOpenMode,
            ...(sqliteDbPath ? { dbPath: sqliteDbPath } : {}),
        };
        logStorageInfo('[Storage] SQLite journal mode ready', sqliteJournalDiagnostics);
    } catch (error) {
        logStorageWarn('[Storage] Failed to read SQLite journal mode', error);
    }
    try {
        await prepareSqliteData(adapter, client);
    } catch (error) {
        if (__DEV__) {
            logStorageWarn('[Storage] SQLite availability check failed', error);
        }
        throw error;
    }
    markStartupPhase('mobile.storage.sqlite_init.end');
    return { adapter, client };
};

let initializeSqliteState = initSqliteState;

const startSqliteStateInitialization = (): Promise<SqliteState> => {
    const promise = initializeSqliteState().catch((error) => {
        if (sqliteStatePromise === promise) {
            sqliteStateRetryAfter = Date.now() + SQLITE_RETRY_COOLDOWN_MS;
        }
        throw error;
    });
    sqliteStatePromise = promise;
    return promise;
};

const getSqliteState = async (): Promise<SqliteState> => {
    if (sqliteStatePromise && sqliteStateRetryAfter > 0 && Date.now() >= sqliteStateRetryAfter) {
        markStartupPhase('mobile.storage.sqlite_state.retry_cooldown_elapsed');
        sqliteStatePromise = null;
        sqliteStateRetryAfter = 0;
    }
    let statePromise = sqliteStatePromise;
    if (!statePromise) {
        markStartupPhase('mobile.storage.sqlite_state.cache_miss');
        statePromise = startSqliteStateInitialization();
    } else {
        markStartupPhase('mobile.storage.sqlite_state.cache_hit');
    }
    try {
        const state = await statePromise;
        sqliteStateRetryAfter = 0;
        markStartupPhase('mobile.storage.sqlite_state.ready');
        return state;
    } catch (error) {
        markStartupPhase('mobile.storage.sqlite_state.unavailable_during_cooldown');
        throw error;
    }
};

// Platform-specific storage implementation
const createStorage = (): StorageAdapter => {
    // Web platform - use localStorage
    if (Platform.OS === 'web') {
        return {
            getData: async (): Promise<AppData> => {
                if (typeof window === 'undefined') {
                    return { tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} };
                }
                let jsonValue = localStorage.getItem(DATA_KEY);
                if (jsonValue == null) {
                    for (const legacyKey of LEGACY_DATA_KEYS) {
                        const legacyValue = localStorage.getItem(legacyKey);
                        if (legacyValue != null) {
                            localStorage.setItem(DATA_KEY, legacyValue);
                            jsonValue = legacyValue;
                            break;
                        }
                    }
                }
                if (jsonValue == null) {
                    return { tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} };
                }
                try {
                    const data = parseStoredAppDataJson(jsonValue);
                    return data;
                } catch (e) {
                    // JSON parse error - data corrupted, throw so user is notified
                    logStorageError('Failed to parse stored data - may be corrupted', e);
                    throw new Error('Data appears corrupted. Please restore from backup.');
                }
            },
            saveData: async (data: AppData): Promise<void> => {
                try {
                    if (typeof window !== 'undefined') {
                        const jsonValue = JSON.stringify(data);
                        localStorage.setItem(DATA_KEY, jsonValue);
                    }
                } catch (e) {
                    logStorageError('Failed to save data', e);
                    throw new Error('Failed to save data: ' + (e as Error).message);
                }
            },
        };
    }

    // Native platforms - use SQLite with AsyncStorage backup for widgets/rollback.
    const sqliteUnavailableReason = getSqliteUnavailableReason();
    const shouldUseSqlite = sqliteUnavailableReason == null;
    registerBackgroundFlushListener();

    return {
        getData: async (): Promise<AppData> => {
            markStartupPhase('mobile.storage.get_data.start');
            const loadJsonBackup = async (phase = 'get_data') => {
                // A deferred backup may still be pending; land it before trusting
                // the stored copy (and before the freshness assert reads its stamp).
                await flushPendingStartupJsonBackup();
                await assertJsonBackupFreshEnough(AsyncStorage, phase);
                const jsonValue = await getLegacyJson(AsyncStorage);
                if (jsonValue == null) {
                    return { ...EMPTY_APP_DATA };
                }
                if (jsonValue != null) {
                    try {
                        const data = parseStoredAppDataJson(jsonValue);
                        updateMobileWidgetFromData(data).catch((error) => {
                            logStorageWarn('[Widgets] Failed to update mobile widget from backup', error);
                        });
                        return data;
                    } catch (parseError) {
                        logStorageError('Failed to parse stored data - may be corrupted', parseError);
                    }
                }
                throw new Error('Data appears corrupted. Please restore from backup.');
            };

            if (shouldUseJsonBackupFastPath()) {
                warnPreferJsonBackup();
                return loadJsonBackup('json_fast_path');
            }
            if (preferJsonBackup && !shouldUseSqlite) {
                warnPreferJsonBackup();
                return loadJsonBackup('json_preferred_sqlite_disabled');
            }
            if (preferJsonBackup) {
                warnPreferJsonBackup();
            }
            try {
                if (!shouldUseSqlite) {
                    throw new Error(sqliteUnavailableReason ?? 'SQLite unavailable');
                }
                await measureStartupPhase(
                    'mobile.storage.get_data.await_sqlite_writes',
                    async () => awaitQueuedSqliteWrites('get_data')
                );
                const { adapter } = await measureStartupPhase('mobile.storage.get_data.sqlite_get_state', async () =>
                    withOperationTimeout(
                        getSqliteState(),
                        SQLITE_STARTUP_TIMEOUT_MS,
                        'SQLite initialization timed out'
                    )
                );
                const readStartedAt = Date.now();
                const data = await measureStartupPhase('mobile.storage.get_data.sqlite_read', async () =>
                    withOperationTimeout(
                        adapter.getData(),
                        SQLITE_STARTUP_TIMEOUT_MS,
                        'SQLite read timed out'
                    )
                );
                const readMs = Date.now() - readStartedAt;
                if (readMs >= SQLITE_SLOW_WRITE_LOG_THRESHOLD_MS) {
                    logStorageInfo('[Storage] Slow SQLite load', { readMs: String(readMs), ...(sqliteJournalDiagnostics ?? {}) });
                }
                data.areas = Array.isArray(data.areas) ? data.areas : [];
                scheduleStartupJsonBackup(data, 'mobile.storage.get_data', latestQueuedWriteStartedAtMs);
                markStartupPhase('mobile.storage.get_data.widget_update_dispatched');
                clearPreferJsonBackup();
                markStartupPhase('mobile.storage.get_data.end');
                return data;
            } catch (e) {
                if (__DEV__ && sqliteUnavailableReason) {
                    logStorageWarn(`[Storage] ${sqliteUnavailableReason}; falling back to JSON backup`);
                } else {
                    logStorageWarn('[Storage] SQLite load failed, falling back to JSON backup', e);
                }
                markPreferJsonBackup();
                const fallbackData = await measureStartupPhase('mobile.storage.get_data.json_fallback_read', async () => loadJsonBackup('get_data_fallback'));
                markStartupPhase('mobile.storage.get_data.end');
                return fallbackData;
            }
        },
        saveData: async (data: AppData): Promise<void> => {
            const enqueuedAtMs = Date.now();
            return enqueueSave(async () => {
                markStartupPhase('mobile.storage.save_data.start');
                const queueWaitMs = Date.now() - enqueuedAtMs;
                const queuedWriteStartedAtMs = markQueuedWriteStarted();
                try {
                    if (!shouldUseSqlite) {
                        throw new Error(sqliteUnavailableReason ?? 'SQLite unavailable');
                    }
                    const { adapter } = await measureStartupPhase('mobile.storage.save_data.sqlite_get_state', async () => getSqliteState());
                    // Sample JS-thread congestion alongside the write: a setTimeout(0)
                    // that resolves late means the thread is starved, which inflates every
                    // awaited SQL statement (large beginMs) without SQLite being at fault.
                    // Not awaited, so it never delays the write; it has always resolved by
                    // the time a save is slow enough to hit the log threshold.
                    let eventLoopLagMs = -1;
                    const lagProbeStartedAt = Date.now();
                    setTimeout(() => {
                        eventLoopLagMs = Date.now() - lagProbeStartedAt;
                    }, 0);
                    const writeStartedAt = Date.now();
                    await measureStartupPhase('mobile.storage.save_data.sqlite_write', async () => adapter.saveData(data));
                    const writeMs = Date.now() - writeStartedAt;
                    if (writeMs >= SQLITE_SLOW_WRITE_LOG_THRESHOLD_MS) {
                        const stats = adapter.getLastSaveDataStats?.();
                        logStorageInfo('[Storage] Slow SQLite save', {
                            writeMs: String(writeMs),
                            queueWaitMs: String(queueWaitMs),
                            eventLoopLagMs: String(eventLoopLagMs),
                            ...(stats
                                ? {
                                    rowsWritten: String(stats.writtenRows),
                                    rowsRemoved: String(stats.removedRows),
                                    rowsTotal: String(stats.totalRows),
                                    incremental: String(stats.incremental),
                                    settingsWritten: String(stats.settingsWritten),
                                    sqlMs: String(stats.sqlMs),
                                    sqlCount: String(stats.sqlCount),
                                    beginMs: String(stats.beginMs),
                                    commitMs: String(stats.commitMs),
                                }
                                : {}),
                            ...(sqliteJournalDiagnostics ?? {}),
                        });
                    }
                    clearPreferJsonBackup();
                    // SQLite is the durable copy; the JSON backup and widget render
                    // land coalesced off the save queue so reads and following taps
                    // never wait on them (#766).
                    scheduleStartupJsonBackup(data, 'mobile.storage.save_data', queuedWriteStartedAtMs);
                    markStartupPhase('mobile.storage.save_data.end');
                } catch (error) {
                    markPreferJsonBackup();
                    if (__DEV__ && sqliteUnavailableReason) {
                        logStorageWarn(`[Storage] ${sqliteUnavailableReason}; keeping JSON backup`);
                    } else {
                        logStorageWarn('[Storage] SQLite save failed, keeping JSON backup', error);
                    }
                    try {
                        // With SQLite down the JSON backup IS the durable copy; it
                        // must land before this save reports success.
                        scheduleStartupJsonBackup(data, 'mobile.storage.save_data.json_fallback', queuedWriteStartedAtMs);
                        await flushPendingStartupJsonBackup();
                        markStartupPhase('mobile.storage.save_data.end');
                    } catch (e) {
                        markStartupPhase('mobile.storage.save_data.error');
                        logStorageError('Failed to save data', e);
                        throw new Error('Failed to save data: ' + (e as Error).message);
                    }
                }
            });
        },
        saveTask: async (task: Task, snapshot?: AppData): Promise<void> => {
            return enqueueSave(async () => {
                const queuedWriteStartedAtMs = markQueuedWriteStarted();
                try {
                    if (!shouldUseSqlite) {
                        throw new Error(sqliteUnavailableReason ?? 'SQLite unavailable');
                    }
                    const { adapter } = await measureStartupPhase('mobile.storage.save_task.sqlite_get_state', async () => getSqliteState());
                    const writeStartedAt = Date.now();
                    await measureStartupPhase('mobile.storage.save_task.sqlite_write', async () => adapter.saveTask(task));
                    const writeMs = Date.now() - writeStartedAt;
                    clearPreferJsonBackup();
                    if (snapshot) {
                        scheduleStartupJsonBackup(snapshot, 'mobile.storage.save_task', queuedWriteStartedAtMs);
                    }
                    if (writeMs >= SQLITE_SLOW_WRITE_LOG_THRESHOLD_MS) {
                        logStorageInfo('[Storage] Slow task save', {
                            writeMs: String(writeMs),
                        });
                    }
                } catch (error) {
                    markPreferJsonBackup();
                    logStorageWarn('[Storage] SQLite task save failed', error);
                    if (!snapshot) {
                        throw error;
                    }

                    try {
                        // With SQLite down the JSON backup IS the durable copy; it
                        // must land before this save reports success.
                        scheduleStartupJsonBackup(snapshot, 'mobile.storage.save_task.json_fallback', queuedWriteStartedAtMs);
                        await flushPendingStartupJsonBackup();
                    } catch (fallbackError) {
                        logStorageError('Failed to save task fallback data', fallbackError);
                        throw new Error('Failed to save task: ' + (fallbackError as Error).message);
                    }
                }
            });
        },
        queryTasks: async (options) => {
            if (shouldUseJsonBackupFastPath()) {
                warnPreferJsonBackup();
                const data = await mobileStorage.getData();
                const statusFilter = options.status;
                const excludeStatuses = options.excludeStatuses ?? [];
                const includeArchived = options.includeArchived === true;
                const includeDeleted = options.includeDeleted === true;
                return data.tasks.filter((task) => {
                    if (!includeDeleted && task.deletedAt) return false;
                    if (!includeArchived && task.status === 'archived') return false;
                    if (statusFilter && statusFilter !== 'all' && task.status !== statusFilter) return false;
                    if (excludeStatuses.length > 0 && excludeStatuses.includes(task.status)) return false;
                    if (options.projectId && task.projectId !== options.projectId) return false;
                    return true;
                });
            }
            try {
                await awaitQueuedSqliteWrites('query_tasks');
                const { adapter } = await withOperationTimeout(
                    getSqliteState(),
                    SQLITE_QUERY_TIMEOUT_MS,
                    'SQLite query initialization timed out'
                );
                if (typeof (adapter as any).queryTasks === 'function') {
                    return withOperationTimeout(
                        (adapter as any).queryTasks(options),
                        SQLITE_QUERY_TIMEOUT_MS,
                        'SQLite query timed out'
                    );
                }
            } catch (error) {
                markPreferJsonBackup();
                logStorageWarn('[Storage] SQLite query failed, falling back to in-memory filter', error);
            }
            const data = await mobileStorage.getData();
            const statusFilter = options.status;
            const excludeStatuses = options.excludeStatuses ?? [];
            const includeArchived = options.includeArchived === true;
            const includeDeleted = options.includeDeleted === true;
            return data.tasks.filter((task) => {
                if (!includeDeleted && task.deletedAt) return false;
                if (!includeArchived && task.status === 'archived') return false;
                if (statusFilter && statusFilter !== 'all' && task.status !== statusFilter) return false;
                if (excludeStatuses.length > 0 && excludeStatuses.includes(task.status)) return false;
                if (options.projectId && task.projectId !== options.projectId) return false;
                return true;
            });
        },
        searchAll: async (query: string) => {
            if (shouldUseJsonBackupFastPath()) {
                warnPreferJsonBackup();
                const data = await mobileStorage.getData();
                return searchAll(data.tasks, data.projects, query);
            }
            try {
                await awaitQueuedSqliteWrites('search_all');
                const { adapter } = await withOperationTimeout(
                    getSqliteState(),
                    SQLITE_QUERY_TIMEOUT_MS,
                    'SQLite search initialization timed out'
                );
                if (typeof (adapter as any).searchAll === 'function') {
                    return withOperationTimeout(
                        (adapter as any).searchAll(query),
                        SQLITE_QUERY_TIMEOUT_MS,
                        'SQLite search timed out'
                    );
                }
            } catch (error) {
                markPreferJsonBackup();
                logStorageWarn('[Storage] SQLite search failed, falling back to in-memory search', error);
            }
            const data = await mobileStorage.getData();
            return searchAll(data.tasks, data.projects, query);
        },
    };
};

export const mobileStorage = createStorage();

export const __mobileStorageTestUtils = {
    createOpSqliteClientForTests: createOpSqliteClient,
    flushPendingStartupJsonBackup,
    flushPendingWidgetRefresh,
    prepareSqliteDataForTests: prepareSqliteData,
    reconcileJsonBackupIntoSqliteForTests: reconcileJsonBackupIntoSqlite,
    sqliteHasAnyDataForTests: sqliteHasAnyData,
    reset: () => {
        saveQueue = Promise.resolve();
        sqliteStatePromise = null;
        sqliteStateRetryAfter = 0;
        latestQueuedWriteStartedAtMs = 0;
        if (jsonBackupTimer) {
            clearTimeout(jsonBackupTimer);
            jsonBackupTimer = null;
        }
        pendingJsonBackup = null;
        jsonBackupWriter = Promise.resolve();
        jsonBackupWriteInFlight = false;
        lastJsonBackupEndedAtMs = 0;
        if (widgetRefreshTimer) {
            clearTimeout(widgetRefreshTimer);
            widgetRefreshTimer = null;
        }
        pendingWidgetRefresh = null;
        widgetRefreshWriter = Promise.resolve();
        initializeSqliteState = initSqliteState;
        clearPreferJsonBackup();
    },
    setSqliteInitializerForTests: (initializer: () => Promise<SqliteState>) => {
        sqliteStatePromise = null;
        sqliteStateRetryAfter = 0;
        initializeSqliteState = initializer;
        clearPreferJsonBackup();
    },
    setSqliteStateForTests: (state: { adapter: Pick<SqliteAdapter, 'saveTask'>; client: Partial<SqliteClient> }) => {
        sqliteStatePromise = Promise.resolve(state as SqliteState);
        sqliteStateRetryAfter = 0;
        clearPreferJsonBackup();
    },
};

// MARK: - Calendar Sync SQLite helpers

export const ensureCalendarSyncStorageReady = async (): Promise<void> => {
    await getSqliteState();
};

export const getCalendarSyncEntry = async (taskId: string, platform: string) => {
    const { adapter } = await getSqliteState();
    return adapter.getCalendarSyncEntry(taskId, platform);
};

export const upsertCalendarSyncEntry = async (entry: CalendarSyncEntry) => {
    const { adapter } = await getSqliteState();
    return adapter.upsertCalendarSyncEntry(entry);
};

export const deleteCalendarSyncEntry = async (taskId: string, platform: string) => {
    const { adapter } = await getSqliteState();
    return adapter.deleteCalendarSyncEntry(taskId, platform);
};

export const getAllCalendarSyncEntries = async (platform: string) => {
    const { adapter } = await getSqliteState();
    return adapter.getAllCalendarSyncEntries(platform);
};
