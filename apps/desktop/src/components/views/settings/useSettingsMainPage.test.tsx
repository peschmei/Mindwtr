import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsMainPage } from './useSettingsMainPage';

const getLaunchAtStartupEnabled = vi.fn();
const tauriAppMock = vi.hoisted(() => ({
    setTheme: vi.fn().mockResolvedValue(undefined),
}));
const tauriWindowMock = vi.hoisted(() => ({
    setTheme: vi.fn().mockResolvedValue(undefined),
    theme: vi.fn().mockResolvedValue('dark'),
    onThemeChanged: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@tauri-apps/api/app', () => ({
    setTheme: tauriAppMock.setTheme,
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => tauriWindowMock,
}));

vi.mock('../../../lib/launch-at-startup', () => ({
    getLaunchAtStartupEnabled: () => getLaunchAtStartupEnabled(),
    setLaunchAtStartupEnabled: vi.fn(),
}));

type HarnessProps = {
    isFlatpak: boolean;
    isTauri: boolean;
    settings?: Parameters<typeof useSettingsMainPage>[0]['settings'];
};

function Harness({ isFlatpak, isTauri, settings = { window: { launchAtStartup: true } } }: HarnessProps) {
    const page = useSettingsMainPage({
        globalQuickAddShortcut: 'Control+Alt+M',
        isFlatpak,
        isLinux: true,
        isTauri,
        keybindingStyle: 'vim',
        language: 'en',
        openHelp: vi.fn(),
        setGlobalQuickAddShortcut: vi.fn(),
        setKeybindingStyle: vi.fn(),
        setLanguage: vi.fn(),
        settings,
        showSaved: vi.fn(),
        updateSettings: vi.fn(),
    });

    return (
        <output data-testid="settings-main-state">
            {JSON.stringify({
                closeBehavior: page.closeBehavior,
                launchAtStartupEnabled: page.launchAtStartupEnabled,
                showCloseBehavior: page.showCloseBehavior,
                showLaunchAtStartup: page.showLaunchAtStartup,
                showTrayToggle: page.showTrayToggle,
            })}
        </output>
    );
}

const readState = () => JSON.parse(screen.getByTestId('settings-main-state').textContent ?? '{}');

describe('useSettingsMainPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getLaunchAtStartupEnabled.mockResolvedValue(true);
        tauriAppMock.setTheme.mockResolvedValue(undefined);
        tauriWindowMock.setTheme.mockResolvedValue(undefined);
        localStorage.clear();
    });

    it('exposes Flatpak lifecycle controls and defaults close handling to tray', () => {
        render(<Harness isFlatpak isTauri />);

        expect(readState()).toMatchObject({
            closeBehavior: 'tray',
            launchAtStartupEnabled: true,
            showCloseBehavior: true,
            showLaunchAtStartup: true,
            showTrayToggle: true,
        });
        expect(getLaunchAtStartupEnabled).not.toHaveBeenCalled();
    });

    it('keeps lifecycle controls hidden outside the Tauri runtime', () => {
        render(<Harness isFlatpak={false} isTauri={false} />);

        expect(readState()).toMatchObject({
            closeBehavior: 'ask',
            showCloseBehavior: false,
            showLaunchAtStartup: false,
            showTrayToggle: false,
        });
    });

    it('applies the resolved Tauri theme to the app and current window', async () => {
        render(<Harness isFlatpak={false} isTauri settings={{ theme: 'dark' }} />);

        await waitFor(() => {
            expect(tauriAppMock.setTheme).toHaveBeenCalledWith('dark');
            expect(tauriWindowMock.setTheme).toHaveBeenCalledWith('dark');
        });
    });
});
