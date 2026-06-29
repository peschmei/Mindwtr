import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import {
  DEFAULT_PROJECT_COLOR,
  buildTaskUpdatesFromSpeechResult,
  generateUUID,
  findSelectableProjectByTitleAndArea,
  safeFormatDate,
  type AppSettings,
  type Attachment,
  type SpeechToTextSettings,
  type Task,
  useTaskStore,
} from '@mindwtr/core';
import { loadAIKey } from '../lib/ai-config';
import { persistAttachmentLocally } from '../lib/attachment-sync';
import { getAttachmentsDir } from '../lib/attachment-sync-utils';
import { logInfo } from '../lib/app-log';
import { useToast } from '../contexts/toast-context';
import {
  ensureWhisperModelPathForConfig,
  prepareAudioForLocalWhisper,
  preloadWhisperContext,
  processAudioCapture,
  resolveSpeechToTextRuntimeSettings,
  startWhisperRealtimeCapture,
  transcribeLocalWhisper,
  type LocalWhisperAudio,
  type SpeechToTextConfig,
  type SpeechToTextResult,
} from '../lib/speech-to-text';
import {
  buildCaptureDirectoryUri,
  buildCaptureFileUri,
  getCaptureFileExtension,
  getCaptureMimeType,
  isQuickCaptureSpeechReady,
  selectExistingCaptureFile,
  selectQuickCaptureSettings,
} from './quick-capture-sheet.utils';

type SpeechSettings = SpeechToTextSettings;
type BuildTaskPropsResult = {
  title: string;
  props: Partial<Task>;
  invalidDateCommands?: string[];
};
type SpeechApplyResult = 'applied' | 'empty' | 'skipped';

export type RecordingState =
  | { kind: 'expo' }
  | {
      kind: 'whisper';
      stop: () => Promise<void>;
      result: Promise<SpeechToTextResult>;
      file: File;
      allowRealtimeFallback: boolean;
    };

type UseQuickCaptureAudioParams = {
  addTask: (title: string, props?: Partial<Task>) => Promise<{ success: boolean; id?: string }>;
  autoRecord?: boolean;
  buildTaskProps: (fallbackTitle: string, extraProps?: Partial<Task>) => Promise<BuildTaskPropsResult>;
  handleClose: () => void;
  initialAttachments?: Attachment[];
  onError: (message: string, error?: unknown) => void;
  onWarn: (message: string, error?: unknown) => void;
  settings: AppSettings;
  t: (key: string) => string;
  updateSpeechSettings: (next: Partial<SpeechSettings>) => void;
  visible: boolean;
};

const logSpeechCaptureInfo = (message: string, extra?: Record<string, unknown>) => {
  void logInfo(message, { scope: 'speech', extra, force: true });
};

const getWhisperCapturePlatform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

const runWhisperLocalTranscription = async (input: LocalWhisperAudio, config: SpeechToTextConfig): Promise<SpeechToTextResult> => ({
  transcript: await transcribeLocalWhisper(input, config),
});

const describeCaptureFile = (file: File | null | undefined): Record<string, string> => {
  if (!file) return { uri: '' };
  const uri = file.uri ?? '';
  try {
    const info = file.info() as { exists?: boolean; isDirectory?: boolean; size?: number };
    return {
      uri,
      exists: String(Boolean(info?.exists)),
      isDirectory: String(Boolean(info?.isDirectory)),
      size: typeof info?.size === 'number' ? String(info.size) : 'unknown',
    };
  } catch (error) {
    return {
      uri,
      exists: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const describeCaptureFiles = (files: (File | null | undefined)[]) => files
  .map((file, index) => Object.entries(describeCaptureFile(file))
    .map(([key, value]) => `${index}.${key}=${value}`)
    .join('|'))
  .join('; ');

const describeAttachmentCacheInfo = (uri: string): Record<string, string> => {
  try {
    const info = new File(uri).info() as { exists?: boolean; isDirectory?: boolean; size?: number };
    return {
      uri,
      exists: String(Boolean(info?.exists)),
      isDirectory: String(Boolean(info?.isDirectory)),
      size: typeof info?.size === 'number' ? String(info.size) : 'unknown',
    };
  } catch (error) {
    return {
      uri,
      exists: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const cacheAudioAttachmentOrThrow = async (attachment: Attachment): Promise<Attachment> => {
  const sourceUri = attachment.uri;
  const cached = await persistAttachmentLocally(attachment);
  const attachmentsDir = await getAttachmentsDir();
  const cachedInfo = describeAttachmentCacheInfo(cached.uri);
  const cachedInManagedDir = Boolean(attachmentsDir && cached.uri.startsWith(attachmentsDir));
  logSpeechCaptureInfo('Quick capture audio attachment cache result', {
    id: attachment.id,
    sourceUri,
    cachedUri: cached.uri,
    attachmentsDir: attachmentsDir ?? '',
    cachedInManagedDir: String(cachedInManagedDir),
    ...cachedInfo,
  });
  if (!cachedInManagedDir || cachedInfo.exists !== 'true' || cachedInfo.isDirectory === 'true') {
    throw new Error(`Audio attachment was not cached into managed storage: ${cached.uri}`);
  }
  return cached;
};

export function useQuickCaptureAudio({
  addTask,
  autoRecord,
  buildTaskProps,
  handleClose,
  initialAttachments,
  onError,
  onWarn,
  settings,
  t,
  updateSpeechSettings,
  visible,
}: UseQuickCaptureAudioParams) {
  const { showToast } = useToast();
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingReady, setRecordingReady] = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const ensureAudioDirectory = useCallback(async () => {
    const candidates: Directory[] = [];
    try {
      candidates.push(Paths.document);
    } catch (error) {
      onWarn('Document directory unavailable', error);
    }
    try {
      candidates.push(Paths.cache);
    } catch (error) {
      onWarn('Cache directory unavailable', error);
    }
    for (const root of candidates) {
      try {
        const directoryUri = buildCaptureDirectoryUri(root.uri, 'audio-captures');
        const dir = new Directory(directoryUri);
        dir.create({ intermediates: true, idempotent: true });
        logSpeechCaptureInfo('Quick capture audio directory ready', {
          platform: Platform.OS,
          rootUri: root.uri,
          directoryUri: dir.uri,
          exists: String(Boolean(dir.exists)),
        });
        return dir;
      } catch (error) {
        onWarn('Failed to create audio directory', error);
      }
    }
    return null;
  }, [onWarn]);

  const stripFileScheme = useCallback((uri: string) => {
    if (uri.startsWith('file://')) return uri.slice(7);
    if (uri.startsWith('file:/')) return uri.replace(/^file:\//, '/');
    return uri;
  }, []);

  const isUnsafeDeleteTarget = useCallback((uri: string) => {
    if (!uri) return true;
    const normalized = stripFileScheme(uri).replace(/\/+$/, '');
    const docBase = stripFileScheme(Paths.document?.uri ?? '').replace(/\/+$/, '');
    const cacheBase = stripFileScheme(Paths.cache?.uri ?? '').replace(/\/+$/, '');
    if (!normalized) return true;
    if (normalized === '/' || normalized === docBase || normalized === cacheBase) return true;
    return false;
  }, [stripFileScheme]);

  const safeDeleteFile = useCallback((file: File, reason: string) => {
    try {
      const uri = file.uri ?? '';
      if (isUnsafeDeleteTarget(uri)) {
        onWarn('Refusing to delete unsafe file target', new Error(`${reason}:${uri}`));
        return;
      }
      const info = Paths.info(uri);
      if (info?.exists && info.isDirectory) {
        onWarn('Refusing to delete directory target', new Error(`${reason}:${uri}`));
        return;
      }
      file.delete();
    } catch (error) {
      onWarn('Audio cleanup failed', error);
    }
  }, [isUnsafeDeleteTarget, onWarn]);

  const resolveWhisperModel = useCallback((modelId: string, storedPath?: string) => {
    const resolved = ensureWhisperModelPathForConfig(modelId, storedPath);
    if (resolved.exists) {
      const currentPath = storedPath ? stripFileScheme(storedPath) : '';
      const resolvedPath = stripFileScheme(resolved.uri);
      if (!currentPath || currentPath !== resolvedPath) {
        updateSpeechSettings({ model: modelId, offlineModelPath: resolved.uri });
      }
    }
    return resolved;
  }, [stripFileScheme, updateSpeechSettings]);

  useEffect(() => {
    if (!visible) return;
    const speech = settings.ai?.speechToText;
    const speechRuntime = resolveSpeechToTextRuntimeSettings(speech);
    if (!speechRuntime.enabled || speechRuntime.provider !== 'whisper') return;
    const { model, modelPath } = speechRuntime;
    const resolved = resolveWhisperModel(model, modelPath);
    if (!resolved.exists) return;
    let cancelled = false;
    void preloadWhisperContext({ model, modelPath: resolved.path }).catch((error) => {
      if (cancelled) return;
      onWarn('Failed to preload whisper model', error);
    });
    return () => {
      cancelled = true;
    };
  }, [onWarn, resolveWhisperModel, settings.ai?.speechToText, visible]);

  const applySpeechResult = useCallback(async (taskId: string, result: SpeechToTextResult): Promise<SpeechApplyResult> => {
    const { tasks: currentTasks, projects: currentProjects, addProject: addProjectNow, updateTask: updateTaskNow, settings: currentSettings } = useTaskStore.getState();
    const existing = currentTasks.find((task) => task.id === taskId);
    if (!existing) return 'skipped';

    const { updates, suggestedProjectTitle } = buildTaskUpdatesFromSpeechResult(existing, result, currentSettings);
    if (suggestedProjectTitle && !existing.projectId) {
      const targetAreaId = updates.areaId ?? existing.areaId;
      const match = findSelectableProjectByTitleAndArea(currentProjects, suggestedProjectTitle, targetAreaId);
      if (match) {
        updates.projectId = match.id;
      } else {
        const created = await addProjectNow(
          suggestedProjectTitle,
          DEFAULT_PROJECT_COLOR,
          targetAreaId ? { areaId: targetAreaId } : undefined
        );
        if (!created) return 'skipped';
        updates.projectId = created.id;
      }
    }

    if (Object.keys(updates).length) {
      await updateTaskNow(taskId, updates);
      return 'applied';
    }

    logSpeechCaptureInfo('Quick capture speech produced no task fields', {
      taskId,
      transcriptLength: String(result.transcript?.trim().length ?? 0),
      hasTitle: String(Boolean(result.title?.trim())),
      hasDescription: String(Boolean(result.description?.trim())),
    });
    return 'empty';
  }, []);

  const discardEmptySpeechTask = useCallback(async (taskId: string, files: (File | null | undefined)[], reason = 'empty_transcript') => {
    try {
      await useTaskStore.getState().deleteTask(taskId);
      logSpeechCaptureInfo('Quick capture discarded empty speech task', { taskId, reason });
    } catch (error) {
      onWarn('Failed to discard empty speech task', error);
    }
    const seen = new Set<string>();
    for (const file of files) {
      const uri = file?.uri ?? '';
      if (!file || !uri || seen.has(uri)) continue;
      seen.add(uri);
      safeDeleteFile(file, reason);
    }
  }, [onWarn, safeDeleteFile]);

  const startRecording = useCallback(async () => {
    if (recording || recordingBusy) return;
    setRecordingBusy(true);
    setRecordingReady(false);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('quickAdd.audioPermissionTitle'), t('quickAdd.audioPermissionBody'));
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        interruptionModeAndroid: 'duckOthers',
      });
      const currentSettings = selectQuickCaptureSettings(settings, useTaskStore.getState().settings);
      const speech = currentSettings.ai?.speechToText;
      const speechRuntime = resolveSpeechToTextRuntimeSettings(speech);
      const { provider, model, modelPath } = speechRuntime;
      const whisperResolved = provider === 'whisper'
        ? resolveWhisperModel(model, modelPath)
        : null;
      const whisperModelReady = provider === 'whisper' ? Boolean(whisperResolved?.exists) : false;
      const resolvedModelPath = provider === 'whisper'
        ? (whisperResolved?.exists ? whisperResolved.path : modelPath)
        : undefined;
      const useWhisperRealtime = speechRuntime.enabled
        && provider === 'whisper'
        && whisperModelReady;
      if (provider === 'whisper') {
        logSpeechCaptureInfo('Quick capture Whisper start resolved', {
          platform: Platform.OS,
          model,
          speechEnabled: String(speechRuntime.enabled),
          modelReady: String(whisperModelReady),
          resolvedModelPath: resolvedModelPath ?? '',
          resolvedModelSize: String(whisperResolved?.size ?? 0),
          realtimeEnabled: String(Boolean(useWhisperRealtime)),
        });
      }
      if (useWhisperRealtime) {
        try {
          const now = new Date();
          const timestamp = safeFormatDate(now, 'yyyyMMdd-HHmmss');
          const directory = await ensureAudioDirectory();
          const fileName = `mindwtr-audio-${timestamp}.wav`;
          const buildOutputFile = (base?: Directory | null) => {
            if (!base?.uri) return null;
            return new File(buildCaptureFileUri(base.uri, fileName));
          };
          let outputFile: File | null = buildOutputFile(directory);
          if (!outputFile) {
            try {
              outputFile = buildOutputFile(Paths.cache);
            } catch (error) {
              onWarn('Whisper cache directory unavailable', error);
            }
          }
          if (!outputFile) {
            try {
              outputFile = buildOutputFile(Paths.document);
            } catch (error) {
              onWarn('Whisper document directory unavailable', error);
            }
          }
          if (!outputFile) {
            throw new Error('Whisper audio output path unavailable');
          }
          const outputPath = stripFileScheme(outputFile.uri);
          const handle = await startWhisperRealtimeCapture(outputPath, {
            provider,
            model,
            modelPath: resolvedModelPath,
            isFossBuild: speechRuntime.isFossBuild,
            language: speechRuntime.language,
            mode: speechRuntime.mode,
            fieldStrategy: speechRuntime.fieldStrategy,
          });
          setRecording({
            kind: 'whisper',
            stop: handle.stop,
            result: handle.result,
            file: outputFile,
            allowRealtimeFallback: handle.hasRealtimeTranscript,
          });
          setRecordingReady(true);
          return;
        } catch (error) {
          onWarn('Whisper realtime start failed, falling back to audio recording', error);
        }
      }

      if (provider === 'whisper') {
          logSpeechCaptureInfo('Quick capture Whisper using recorded audio path', {
            platform: Platform.OS,
            model,
            modelReady: String(whisperModelReady),
          reason: 'realtime-start-fallback',
        });
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecording({ kind: 'expo' });
      setRecordingReady(true);
    } catch (error) {
      onError('Failed to start recording', error);
      Alert.alert(t('quickAdd.audioErrorTitle'), t('quickAdd.audioErrorBody'));
      setRecordingReady(false);
    } finally {
      setRecordingBusy(false);
    }
  }, [
    audioRecorder,
    ensureAudioDirectory,
    onError,
    onWarn,
    recording,
    recordingBusy,
    resolveWhisperModel,
    settings,
    stripFileScheme,
    t,
  ]);

  const stopRecording = useCallback(async ({ saveTask }: { saveTask: boolean }) => {
    if (recordingBusy) return;
    const currentRecording = recording;
    if (!currentRecording) return;
    setRecordingBusy(true);
    setRecordingReady(false);
    setRecording(null);
    try {
      if (currentRecording.kind === 'whisper') {
        try {
          await currentRecording.stop();
        } catch (error) {
          onWarn('Failed to stop whisper recording', error);
        }
        if (!saveTask) {
          if (currentRecording.allowRealtimeFallback) {
            void currentRecording.result.catch((error) => onWarn('Speech-to-text failed', error));
          }
          safeDeleteFile(currentRecording.file, 'whisper_cancel');
          return;
        }

        const finalFile = currentRecording.file;
        let fileInfo: { exists?: boolean; size?: number } | null = null;
        try {
          fileInfo = finalFile.info();
        } catch (error) {
          onWarn('Audio info lookup failed', error);
        }
        const now = new Date();
        const nowIso = now.toISOString();
        const displayTitle = `${t('quickAdd.audioNoteTitle')} ${safeFormatDate(now, 'Pp')}`;
        const currentSettings = selectQuickCaptureSettings(settings, useTaskStore.getState().settings);
        const speech = currentSettings.ai?.speechToText;
        const speechRuntime = resolveSpeechToTextRuntimeSettings(speech);
        const { provider, model, modelPath } = speechRuntime;
        const apiKey = provider === 'whisper' ? '' : await loadAIKey(provider).catch(() => '');
        const whisperResolved = provider === 'whisper'
          ? resolveWhisperModel(model, modelPath)
          : null;
        const whisperModelReady = provider === 'whisper' ? Boolean(whisperResolved?.exists) : false;
        const resolvedModelPath = provider === 'whisper'
          ? (whisperResolved?.exists ? whisperResolved.path : modelPath)
          : undefined;

        const speechReady = isQuickCaptureSpeechReady({
          speechEnabled: speechRuntime.enabled,
          provider,
          apiKey,
          whisperModelReady,
          whisperModelPath: modelPath,
        });
        const localWhisperInput = speechReady && provider === 'whisper'
          ? await prepareAudioForLocalWhisper({
            uri: finalFile.uri,
            platform: getWhisperCapturePlatform(),
            source: 'pcm-recorder',
            extension: '.wav',
          })
          : null;
        const canTranscribeSpeech = provider === 'whisper' ? Boolean(localWhisperInput) : speechReady;
        const saveAudioAttachments = currentSettings.gtd?.saveAudioAttachments !== false || !canTranscribeSpeech;

        let attachment: Attachment | null = saveAudioAttachments ? {
          id: generateUUID(),
          kind: 'file',
          title: displayTitle,
          uri: finalFile.uri,
          mimeType: getCaptureMimeType('.wav'),
          size: fileInfo?.exists && fileInfo.size ? fileInfo.size : undefined,
          createdAt: nowIso,
          updatedAt: nowIso,
          localStatus: 'available',
        } : null;
        if (attachment) {
          try {
            attachment = await cacheAudioAttachmentOrThrow(attachment);
          } catch (error) {
            onWarn('Failed to persist audio attachment', error);
            throw error;
          }
        }

        const attachments = [...(initialAttachments ?? [])];
        if (attachment) attachments.push(attachment);
        const { title, props, invalidDateCommands } = await buildTaskProps(displayTitle, { attachments });
        if (invalidDateCommands && invalidDateCommands.length > 0) {
          showToast({
            title: t('common.notice'),
            message: `${t('quickAdd.invalidDateCommand')}: ${invalidDateCommands.join(', ')}`,
            tone: 'warning',
            durationMs: 4200,
          });
          return;
        }
        if (!title.trim()) return;

        const addTaskResult = await addTask(title, props);
        handleClose();

        if (!addTaskResult.success || !addTaskResult.id) return;
        const taskId = addTaskResult.id;

        if (canTranscribeSpeech) {
          const timeZone = typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : undefined;
          const transcriptionUri = stripFileScheme(attachment?.uri ?? finalFile.uri);
          if (provider === 'whisper') {
            logSpeechCaptureInfo('Quick capture Whisper offline transcription queued', {
              platform: Platform.OS,
              model,
              modelReady: String(whisperModelReady),
              fileSize: String(fileInfo?.size ?? 0),
              realtimeFallback: String(currentRecording.allowRealtimeFallback),
              saveAudioAttachments: String(saveAudioAttachments),
              localWhisperInputReady: String(Boolean(localWhisperInput)),
            });
          }
          const speechConfig = {
            provider,
            apiKey,
            model,
            modelPath: resolvedModelPath,
            isFossBuild: speechRuntime.isFossBuild,
            language: speechRuntime.language,
            mode: speechRuntime.mode,
            fieldStrategy: speechRuntime.fieldStrategy,
            parseModel: provider === 'openai' && currentSettings.ai?.provider === 'openai' ? currentSettings.ai?.model : undefined,
            now: new Date(),
            timeZone,
          } satisfies SpeechToTextConfig;
          const speechPromise = provider === 'whisper' && localWhisperInput
            ? runWhisperLocalTranscription(localWhisperInput, speechConfig)
            : processAudioCapture(transcriptionUri, speechConfig);
          void speechPromise
            .then(async (result) => {
              const applyResult = await applySpeechResult(taskId, result);
              if (applyResult === 'empty') {
                await discardEmptySpeechTask(taskId, [
                  finalFile,
                  attachment?.uri ? new File(attachment.uri) : null,
                ], 'whisper_empty_transcript');
              }
            })
            .catch((error) => {
              if (!currentRecording.allowRealtimeFallback) {
                onWarn('Whisper offline transcription failed', error);
                return undefined;
              }
              onWarn('Whisper offline transcription failed, using realtime result', error);
              return currentRecording.result
                .then(async (result) => {
                  const applyResult = await applySpeechResult(taskId, result);
                  if (applyResult === 'empty') {
                    await discardEmptySpeechTask(taskId, [
                      finalFile,
                      attachment?.uri ? new File(attachment.uri) : null,
                    ], 'whisper_empty_realtime_fallback');
                  }
                })
                .catch((realtimeError) => onWarn('Speech-to-text failed', realtimeError));
            })
            .finally(() => {
              if (!saveAudioAttachments) {
                safeDeleteFile(finalFile, 'whisper_cleanup');
              }
            });
        } else {
          if (provider === 'whisper') {
            logSpeechCaptureInfo('Quick capture Whisper transcription skipped', {
              platform: Platform.OS,
              model,
              modelReady: String(whisperModelReady),
              speechEnabled: String(speechRuntime.enabled),
              localWhisperInputReady: String(Boolean(localWhisperInput)),
            });
          }
          if (!saveAudioAttachments) {
            safeDeleteFile(finalFile, 'whisper_skip_cleanup');
          }
        }
        return;
      }

      try {
        await audioRecorder.stop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('not recording') && !message.includes('already')) {
          throw error;
        }
      }
      const uri = audioRecorder.uri;
      if (!uri) {
        throw new Error('Recording URI missing');
      }
      if (!saveTask) return;

      const now = new Date();
      const timestamp = safeFormatDate(now, 'yyyyMMdd-HHmmss');
      const extension = getCaptureFileExtension(uri);
      const shouldRelocateRecording = Platform.OS !== 'ios';
      const directory = shouldRelocateRecording ? await ensureAudioDirectory() : null;
      const fileName = `mindwtr-audio-${timestamp}${extension}`;
      const sourceFile = new File(uri);
      const destinationFile = directory ? new File(buildCaptureFileUri(directory.uri, fileName)) : null;
      let captureCandidates: (File | null)[] = [sourceFile];
      logSpeechCaptureInfo('Quick capture Expo recording stopped', {
        platform: Platform.OS,
        recorderUri: uri,
        directoryUri: directory?.uri ?? '',
        destinationUri: destinationFile?.uri ?? '',
        extension,
      });

      if (!shouldRelocateRecording) {
        logSpeechCaptureInfo('Quick capture using recorder source without move', {
          platform: Platform.OS,
          sourceBeforeUri: uri,
          candidates: describeCaptureFiles(captureCandidates),
        });
      }

      if (destinationFile) {
        try {
          sourceFile.move(destinationFile);
          captureCandidates = [sourceFile, destinationFile];
          logSpeechCaptureInfo('Quick capture audio move result', {
            platform: Platform.OS,
            sourceBeforeUri: uri,
            candidates: describeCaptureFiles(captureCandidates),
          });
        } catch (error) {
          onWarn('Move recording failed, falling back to copy', error);
          try {
            sourceFile.copy(destinationFile);
            captureCandidates = [destinationFile, sourceFile];
            const copiedDestination = selectExistingCaptureFile([destinationFile]);
            logSpeechCaptureInfo('Quick capture audio copy result', {
              platform: Platform.OS,
              sourceBeforeUri: uri,
              candidates: describeCaptureFiles(captureCandidates),
              copiedDestinationReady: String(Boolean(copiedDestination)),
            });
            if (copiedDestination) {
              safeDeleteFile(sourceFile, 'recording_copy_cleanup');
            }
          } catch (copyError) {
            onWarn('Copy recording failed, using original file', copyError);
            captureCandidates = [sourceFile];
            logSpeechCaptureInfo('Quick capture audio copy failed', {
              platform: Platform.OS,
              sourceBeforeUri: uri,
              candidates: describeCaptureFiles(captureCandidates),
              error: copyError instanceof Error ? copyError.message : String(copyError),
            });
          }
        }
      }

      const verifiedCapture = selectExistingCaptureFile(captureCandidates);
      if (!verifiedCapture) {
        logSpeechCaptureInfo('Quick capture audio file missing after save', {
          platform: Platform.OS,
          sourceBeforeUri: uri,
          directoryUri: directory?.uri ?? '',
          destinationUri: destinationFile?.uri ?? '',
          candidates: describeCaptureFiles(captureCandidates),
        });
        throw new Error(`Recording file missing after save: ${captureCandidates.map((file) => file?.uri ?? '').filter(Boolean).join(', ')}`);
      }
      const finalFile = verifiedCapture.file;
      const fileInfo = verifiedCapture.info;
      logSpeechCaptureInfo('Quick capture audio file selected', {
        platform: Platform.OS,
        sourceBeforeUri: uri,
        selectedUri: finalFile.uri,
        selectedSize: typeof fileInfo.size === 'number' ? String(fileInfo.size) : 'unknown',
        candidates: describeCaptureFiles(captureCandidates),
      });
      const nowIso = now.toISOString();
      const displayTitle = `${t('quickAdd.audioNoteTitle')} ${safeFormatDate(now, 'Pp')}`;
      const currentSettings = selectQuickCaptureSettings(settings, useTaskStore.getState().settings);
      const speech = currentSettings.ai?.speechToText;
      const speechRuntime = resolveSpeechToTextRuntimeSettings(speech);
      const { provider, model, modelPath } = speechRuntime;
      const apiKey = provider === 'whisper' ? '' : await loadAIKey(provider).catch(() => '');
      const whisperResolved = provider === 'whisper'
        ? resolveWhisperModel(model, modelPath)
        : null;
      const whisperModelReady = provider === 'whisper' ? Boolean(whisperResolved?.exists) : false;
      const resolvedModelPath = provider === 'whisper'
        ? (whisperResolved?.exists ? whisperResolved.path : modelPath)
        : undefined;

      const speechReady = isQuickCaptureSpeechReady({
        speechEnabled: speechRuntime.enabled,
        provider,
        apiKey,
        whisperModelReady,
        whisperModelPath: modelPath,
      });
      const audioUri = finalFile.uri;
      const localWhisperInput = speechReady && provider === 'whisper'
        ? await prepareAudioForLocalWhisper({
          uri: audioUri,
          platform: getWhisperCapturePlatform(),
          source: 'expo-recorder',
          extension,
        })
        : null;
      const canTranscribeSpeech = provider === 'whisper' ? Boolean(localWhisperInput) : speechReady;
      const saveAudioAttachments = currentSettings.gtd?.saveAudioAttachments !== false || !canTranscribeSpeech;

      let attachment: Attachment | null = saveAudioAttachments ? {
        id: generateUUID(),
        kind: 'file',
        title: displayTitle,
        uri: audioUri,
        mimeType: getCaptureMimeType(extension),
        size: fileInfo?.exists && fileInfo.size ? fileInfo.size : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
        localStatus: 'available',
      } : null;
      if (attachment) {
        try {
          attachment = await cacheAudioAttachmentOrThrow(attachment);
        } catch (error) {
          onWarn('Failed to persist audio attachment', error);
          throw error;
        }
      }

      const attachments = [...(initialAttachments ?? [])];
      if (attachment) attachments.push(attachment);
      const { title, props, invalidDateCommands } = await buildTaskProps(displayTitle, { attachments });
      if (invalidDateCommands && invalidDateCommands.length > 0) {
        showToast({
          title: t('common.notice'),
          message: `${t('quickAdd.invalidDateCommand')}: ${invalidDateCommands.join(', ')}`,
          tone: 'warning',
          durationMs: 4200,
        });
        return;
      }
      if (!title.trim()) return;

      const addTaskResult = await addTask(title, props);
      handleClose();

      if (!addTaskResult.success || !addTaskResult.id) return;
      const taskId = addTaskResult.id;

      if (canTranscribeSpeech) {
        const timeZone = typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;
        if (provider === 'whisper') {
          logSpeechCaptureInfo('Quick capture Whisper offline transcription queued', {
            platform: Platform.OS,
            model,
            modelReady: String(whisperModelReady),
            fileSize: String(fileInfo?.size ?? 0),
            saveAudioAttachments: String(saveAudioAttachments),
            localWhisperInputReady: String(Boolean(localWhisperInput)),
          });
        }
        const speechConfig = {
          provider,
          apiKey,
          model,
          modelPath: resolvedModelPath,
          isFossBuild: speechRuntime.isFossBuild,
          language: speechRuntime.language,
          mode: speechRuntime.mode,
          fieldStrategy: speechRuntime.fieldStrategy,
          parseModel: provider === 'openai' && currentSettings.ai?.provider === 'openai' ? currentSettings.ai?.model : undefined,
          now: new Date(),
          timeZone,
        } satisfies SpeechToTextConfig;
        const speechPromise = provider === 'whisper' && localWhisperInput
          ? runWhisperLocalTranscription(localWhisperInput, speechConfig)
          : processAudioCapture(audioUri, speechConfig);
        void speechPromise
          .then(async (result) => {
            const applyResult = await applySpeechResult(taskId, result);
            if (applyResult === 'empty') {
              await discardEmptySpeechTask(taskId, [
                finalFile,
                attachment?.uri ? new File(attachment.uri) : null,
              ], 'speech_empty_transcript');
            }
          })
          .catch((error) => onWarn('Speech-to-text failed', error))
          .finally(() => {
            if (!saveAudioAttachments) {
              safeDeleteFile(finalFile, 'expo_cleanup');
            }
          });
      } else {
        if (provider === 'whisper') {
          logSpeechCaptureInfo('Quick capture Whisper transcription skipped', {
            platform: Platform.OS,
            model,
            modelReady: String(whisperModelReady),
            speechEnabled: String(speechRuntime.enabled),
            localWhisperInputReady: String(Boolean(localWhisperInput)),
          });
        }
        if (!saveAudioAttachments) {
          safeDeleteFile(finalFile, 'expo_skip_cleanup');
        }
      }
    } catch (error) {
      onError('Failed to save recording', error);
      Alert.alert(t('quickAdd.audioErrorTitle'), t('quickAdd.audioErrorBody'));
    } finally {
      setRecordingBusy(false);
    }
  }, [
    addTask,
    applySpeechResult,
    audioRecorder,
    buildTaskProps,
    discardEmptySpeechTask,
    ensureAudioDirectory,
    handleClose,
    initialAttachments,
    onError,
    onWarn,
    recording,
    recordingBusy,
    resolveWhisperModel,
    safeDeleteFile,
    settings,
    showToast,
    stripFileScheme,
    t,
  ]);

  useEffect(() => {
    if (visible && autoRecord && !recording && !recordingBusy) {
      const handle = setTimeout(() => {
        void startRecording();
      }, 150);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [autoRecord, recording, recordingBusy, startRecording, visible]);

  return {
    recording,
    recordingBusy,
    recordingReady,
    startRecording,
    stopRecording,
  };
}
