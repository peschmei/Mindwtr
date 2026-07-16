import { ensureFreshLocalSyncSnapshot } from './sync-client-helpers';
import { cloneAppData } from './sync-runtime-utils';
import type { AppData } from './types';

export type DataTransferStaleDetails = {
    currentChangeAt: number;
    localSnapshotChangeAt: number;
    operation: string;
};

export type DataTransferApplication<TResult> = {
    data: AppData;
    result: TResult;
};

export type DataTransferTransactionOptions<TResult> = {
    operation: string;
    flushPendingSave: () => Promise<void>;
    getCurrentChangeAt: () => number;
    readCurrentData: () => Promise<AppData>;
    apply: (
        currentData: AppData
    ) => DataTransferApplication<TResult> | Promise<DataTransferApplication<TResult>>;
    persistData: (data: AppData) => Promise<void>;
    refreshData: () => Promise<void>;
    onStale?: (details: DataTransferStaleDetails) => void;
};

export type DataTransferTransactionWithSnapshotOptions<TResult, TSnapshot> =
    DataTransferTransactionOptions<TResult> & {
        createRecoverySnapshot: (currentData: AppData) => Promise<TSnapshot>;
    };

export class DataTransferRefreshError extends Error {
    readonly committed = true;
    readonly operation: string;
    readonly cause: unknown;

    constructor(operation: string, cause: unknown) {
        super('Data was saved, but Mindwtr could not reload it. Restart Mindwtr before retrying this transfer.');
        this.name = 'DataTransferRefreshError';
        this.operation = operation;
        this.cause = cause;
    }
}

export async function runDataTransferTransaction<TResult, TSnapshot>(
    options: DataTransferTransactionWithSnapshotOptions<TResult, TSnapshot>
): Promise<{ result: TResult; snapshot: TSnapshot }> {
    await options.flushPendingSave();
    const localSnapshotChangeAt = options.getCurrentChangeAt();
    const currentData = await options.readCurrentData();
    const recoveryData = cloneAppData(currentData);
    const application = await options.apply(currentData);

    const ensureFresh = () => {
        ensureFreshLocalSyncSnapshot({
            localSnapshotChangeAt,
            getCurrentChangeAt: options.getCurrentChangeAt,
            requestFollowUp: () => undefined,
            onStale: ({ currentChangeAt, localSnapshotChangeAt: snapshotChangeAt }) => {
                options.onStale?.({
                    operation: options.operation,
                    localSnapshotChangeAt: snapshotChangeAt,
                    currentChangeAt,
                });
            },
        });
    };

    ensureFresh();
    const snapshot = await options.createRecoverySnapshot(recoveryData);
    ensureFresh();

    await options.persistData(application.data);
    try {
        await options.refreshData();
    } catch (error) {
        throw new DataTransferRefreshError(options.operation, error);
    }

    return {
        result: application.result,
        snapshot,
    };
}

export const runDataTransferTransactionWithoutSnapshot = async <TResult>(
    options: DataTransferTransactionOptions<TResult>
): Promise<{ result: TResult; snapshot: null }> => runDataTransferTransaction({
    ...options,
    createRecoverySnapshot: async () => null,
});
