import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataTransferSection } from './DataTransferSection';

const baseProps = {
    t: {
        dataTransfer: 'Data Transfer',
        dataTransferDesc: 'Import and export data.',
        exportBackup: 'Export Backup',
        exportBackupDesc: 'Save backup.',
        restoreBackup: 'Restore Backup',
        restoreBackupDesc: 'Restore backup.',
        importTodoist: 'Import from Todoist',
        importTodoistDesc: 'Import Todoist exports.',
        importDgt: 'Import from DGT GTD',
        importDgtDesc: 'Import DGT GTD exports.',
        importOmniFocus: 'Import from OmniFocus',
        importOmniFocusDesc: 'Import OmniFocus exports.',
        syncing: 'Working...',
    },
    transferAction: null,
    onExportBackup: vi.fn(),
    onRestoreBackup: vi.fn(),
    onImportTodoist: vi.fn(),
    onImportDgt: vi.fn(),
    onImportOmniFocus: vi.fn(),
} as unknown as ComponentProps<typeof DataTransferSection>;

describe('DataTransferSection', () => {
    it('links to the import guide on the wiki', () => {
        const { getByRole } = render(<DataTransferSection {...baseProps} />);

        expect(getByRole('link', { name: /Import guide/ })).toHaveAttribute(
            'href',
            'https://github.com/dongdongbh/Mindwtr/wiki/Data-and-Sync#imports-and-migrations'
        );
    });
});
