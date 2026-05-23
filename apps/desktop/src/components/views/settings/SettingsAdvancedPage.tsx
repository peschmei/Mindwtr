import type { SettingsLabels } from './labels';
import type { LocalApiServerStatus } from '../../../lib/local-api-server';

type SettingsAdvancedPageProps = {
    t: SettingsLabels;
    isTauri: boolean;
    localApiStatus: LocalApiServerStatus;
    localApiPortInput: string;
    localApiBusy: boolean;
    localApiPortError: string;
    onLocalApiToggle: (enabled: boolean) => void;
    onLocalApiPortInputChange: (value: string) => void;
    onLocalApiPortCommit: () => void;
};

const inputCls =
    'h-8 w-24 rounded-md border border-border bg-muted/50 px-2.5 text-right text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60';

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            {children}
        </h3>
    );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-card border border-border rounded-lg divide-y divide-border/50">
            {children}
        </div>
    );
}

function SettingsRow({
    title,
    description,
    children,
}: {
    title: string;
    description?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="px-4 py-3 flex items-center justify-between gap-6">
            <div className="min-w-0">
                <div className="text-[13px] font-medium">{title}</div>
                {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">{children}</div>
        </div>
    );
}

function Toggle({
    disabled = false,
    enabled,
    label,
    onChange,
}: {
    disabled?: boolean;
    enabled: boolean;
    label: string;
    onChange: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-label={label}
            onClick={onChange}
            className={`inline-flex h-[22px] w-10 items-center rounded-full transition-colors ${
                enabled ? 'bg-primary' : 'bg-muted'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            aria-pressed={enabled}
        >
            <span
                className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform ${
                    enabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                }`}
            />
        </button>
    );
}

export function SettingsAdvancedPage({
    t,
    isTauri,
    localApiStatus,
    localApiPortInput,
    localApiBusy,
    localApiPortError,
    onLocalApiToggle,
    onLocalApiPortInputChange,
    onLocalApiPortCommit,
}: SettingsAdvancedPageProps) {
    const statusText = !isTauri
        ? t.localApiUnavailable
        : localApiStatus.running && localApiStatus.url
            ? localApiStatus.url
            : t.localApiStopped;
    const errorText = localApiPortError || localApiStatus.error || '';

    return (
        <div className="space-y-5">
            <SectionHeader>{t.automation}</SectionHeader>
            <SettingsCard>
                <SettingsRow title={t.localApiServer} description={statusText}>
                    <Toggle
                        disabled={!isTauri || localApiBusy}
                        enabled={localApiStatus.enabled}
                        label={t.localApiServer}
                        onChange={() => onLocalApiToggle(!localApiStatus.enabled)}
                    />
                </SettingsRow>
                <SettingsRow title={t.localApiPort} description={t.localApiPortDesc}>
                    <input
                        aria-label={t.localApiPort}
                        className={inputCls}
                        disabled={!isTauri || localApiBusy}
                        inputMode="numeric"
                        min={1024}
                        max={65535}
                        type="number"
                        value={localApiPortInput}
                        onBlur={onLocalApiPortCommit}
                        onChange={(event) => onLocalApiPortInputChange(event.target.value)}
                    />
                </SettingsRow>
                {localApiStatus.enabled && localApiStatus.token && (
                    <SettingsRow title={t.localApiToken} description={t.localApiTokenDesc}>
                        <code className="max-w-[320px] break-all rounded border border-border bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
                            {localApiStatus.token}
                        </code>
                    </SettingsRow>
                )}
                {localApiStatus.enabled && (
                    <div className="px-4 py-3 text-xs text-muted-foreground">
                        {t.localApiSecurityNote}
                    </div>
                )}
                {errorText && (
                    <div className="px-4 py-3 text-xs text-destructive">
                        {errorText}
                    </div>
                )}
            </SettingsCard>
        </div>
    );
}
