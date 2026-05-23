#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(
  repoRoot,
  'apps/mobile/ios-app-intents/MindwtrSiriCaptureIntents.swift'
);
const source = fs.readFileSync(sourcePath, 'utf8');

const supportedModesMatches = source.match(/static\s+var\s+supportedModes\s*:\s*IntentModes/g) || [];
if (supportedModesMatches.length !== 1) {
  console.error(
    `Expected exactly one AppIntent supportedModes declaration, found ${supportedModesMatches.length}.`
  );
  process.exit(1);
}

const guardedSupportedModes =
  /#if compiler\(>=6\.0\)\s*\n\s*@available\(iOS 26\.0, \*\)\s*\n\s*static\s+var\s+supportedModes\s*:\s*IntentModes\s*\{/.test(
    source
  );

if (!guardedSupportedModes) {
  console.error(
    'MindwtrSiriCaptureIntent.supportedModes must be guarded with @available(iOS 26.0, *) under #if compiler(>=6.0).'
  );
  console.error('IntentModes is iOS 26-only and the release archive targets older iOS versions.');
  process.exit(1);
}

const appShortcutPhrases = source.match(/phrases:\s*\[[\s\S]*?\]/);
if (!appShortcutPhrases) {
  console.error('Expected MindwtrSiriCaptureIntent AppShortcut phrases.');
  process.exit(1);
}

if (/\\\(\\\.\$(task|note)\)/.test(appShortcutPhrases[0])) {
  console.error(
    'MindwtrSiriCaptureIntent AppShortcut phrases must not interpolate String parameters.'
  );
  console.error(
    'The iOS 26 AppIntents metadata processor only accepts AppEntity/AppEnum values in shortcut phrases.'
  );
  process.exit(1);
}

console.log('iOS App Intents availability guard is valid.');
