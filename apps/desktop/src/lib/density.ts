export type DensityMode = 'comfortable' | 'compact' | 'condensed';

// Toolbar button and keyboard shortcut both cycle Comfortable → Compact →
// Condensed → Comfortable. Anything unrecognized is treated as 'comfortable'
// (matching the callers' `?? 'comfortable'` fallback), so it advances to
// 'compact'.
export function nextDensityMode(current: DensityMode | string | null | undefined): DensityMode {
    switch (current) {
        case 'comfortable':
            return 'compact';
        case 'compact':
            return 'condensed';
        case 'condensed':
            return 'comfortable';
        default:
            return 'compact';
    }
}
