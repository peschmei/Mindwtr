import { isOpenFeatureUrl, parseOpenFeatureUrl, resolveOpenFeaturePath } from '@/lib/capture-deeplink';

// Expo Router routes incoming system URLs by path, so mindwtr://open-feature
// would land on the Unmatched Route screen before the root-layout hook can
// redirect. Rewrite it to the destination route up front (#755).
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
    try {
        if (isOpenFeatureUrl(path)) {
            return resolveOpenFeaturePath(parseOpenFeatureUrl(path)?.feature ?? null);
        }
    } catch {
        // redirectSystemPath must never throw; fall through to the original path.
    }
    return path;
}
