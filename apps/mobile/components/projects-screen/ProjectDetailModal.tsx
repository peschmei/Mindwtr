import React from 'react';
import {
    Alert,
    Dimensions,
    findNodeHandle,
    Keyboard,
    Modal,
    KeyboardAvoidingView,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Platform,
    ScrollView,
    type ScrollViewProps,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import {
    type Attachment,
    getAttachmentDisplayTitle,
    type MarkdownSelection,
    type MarkdownToolbarActionId,
    type MarkdownToolbarResult,
    type Project,
    type ProjectSequenceTaskCue,
    type Task,
    type TaskSortBy,
    getSequentialProjectTaskCues,
    safeParseDate,
    tFallback,
} from '@mindwtr/core';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ThemeColors } from '@/hooks/use-theme-colors';
import { KeyboardAccessoryHost } from '../../components/keyboard-accessory-host';
import { ExpandedMarkdownEditor } from '../../components/expanded-markdown-editor';
import { MarkdownFormatToolbar } from '../../components/markdown-format-toolbar';
import { MarkdownReferenceAutocomplete } from '../../components/markdown-reference-autocomplete';
import { MarkdownText } from '../../components/markdown-text';
import { TaskList } from '../../components/task-list';
import { AttachmentProgressIndicator } from '../../components/AttachmentProgressIndicator';
import { projectsScreenStyles as styles } from './projects-screen.styles';

type ProjectDetailModalProps = {
    addProjectFileAttachment: () => void | Promise<void>;
    closeProjectDetail: () => void;
    commitSelectedProjectNotes: () => void;
    formatProjectDate: (value: string | undefined, fallback: string) => string;
    handleArchiveSelectedProject: () => void;
    handleSelectedProjectNotesApplyAction: (actionId: MarkdownToolbarActionId, selection: MarkdownSelection) => MarkdownToolbarResult;
    handleSelectedProjectNotesApplyAutocomplete: (next: { selection: MarkdownSelection; value: string }) => void;
    handleSelectedProjectNotesChange: (text: string) => void;
    handleSelectedProjectNotesSelectionChange: (selection: MarkdownSelection) => void;
    handleSelectedProjectNotesUndo: () => MarkdownSelection | undefined;
    handleSetProjectStatus: (status: Project['status']) => void;
    isSelectedProjectNotesFocused: boolean;
    modalHeaderStyle: Record<string, unknown>[];
    notesExpanded: boolean;
    notesFullscreen: boolean;
    onCloseNotesFullscreen: () => void;
    onDuplicateProject: (projectId: string) => void;
    onOpenAreaPicker: () => void;
    onOpenTagPicker: () => void;
    onRemoveProjectAttachment: (id: string) => void;
    onSetLinkInput: (value: string) => void;
    onSetLinkModalVisible: (visible: boolean) => void;
    onSetNotesExpanded: React.Dispatch<React.SetStateAction<boolean>>;
    onSetSelectedProjectNotesFocused: React.Dispatch<React.SetStateAction<boolean>>;
    onSetSelectedProject: React.Dispatch<React.SetStateAction<Project | null>>;
    onSetShowDueDatePicker: React.Dispatch<React.SetStateAction<boolean>>;
    onSetShowNotesFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
    onSetShowNotesPreview: React.Dispatch<React.SetStateAction<boolean>>;
    onSetShowProjectMeta: React.Dispatch<React.SetStateAction<boolean>>;
    onSetShowReviewPicker: React.Dispatch<React.SetStateAction<boolean>>;
    onSetShowStatusMenu: React.Dispatch<React.SetStateAction<boolean>>;
    onToggleShowCompletedTasks: () => void;
    onProjectTaskSortByChange: (sortBy: Extract<TaskSortBy, 'default' | 'due'>) => void;
    onDownloadAttachment: (attachment: Attachment) => void | Promise<void>;
    onOpenAttachment: (attachment: Attachment) => void | Promise<void>;
    overlayVisible: boolean;
    presentationStyle: 'pageSheet' | 'fullScreen';
    projectTaskSortBy: Extract<TaskSortBy, 'default' | 'due'>;
    selectedProjectAreaName: string;
    selectedProject: Project | null;
    selectedProjectTasks?: Task[];
    selectedProjectNotes: string;
    selectedProjectNotesDirection: 'ltr' | 'rtl';
    selectedProjectNotesInputRef: React.RefObject<TextInput | null>;
    selectedProjectNotesSelection: MarkdownSelection;
    selectedProjectNotesTextDirectionStyle: Record<string, unknown>;
    selectedProjectNotesUndoDepth: number;
    showDueDatePicker: boolean;
    showNotesPreview: boolean;
    showProjectMeta: boolean;
    showReviewPicker: boolean;
    showStatusMenu: boolean;
    showCompletedTasks: boolean;
    statusPalette: Record<Project['status'], { bg: string; border: string; text: string }>;
    t: (key: string) => string;
    tc: ThemeColors;
    updateProject: (id: string, updates: Partial<Project>) => void;
};

function getAndroidKeyboardFrame(event: { endCoordinates?: { screenY?: number; height?: number } }) {
    const windowHeight = Dimensions.get('window').height;
    const screenHeight = Dimensions.get('screen').height;
    const endCoords = event.endCoordinates;
    const eventScreenY = typeof endCoords?.screenY === 'number' ? endCoords.screenY : undefined;
    const eventHeight = typeof endCoords?.height === 'number' ? endCoords.height : undefined;
    const keyboardTop = eventScreenY ?? (typeof eventHeight === 'number' ? Math.max(0, screenHeight - eventHeight) : windowHeight);
    const screenInset = typeof eventScreenY === 'number' ? Math.max(0, screenHeight - eventScreenY) : 0;
    const windowInset = typeof eventScreenY === 'number' ? Math.max(0, windowHeight - eventScreenY) : 0;
    const heightInset = typeof eventHeight === 'number' ? Math.max(0, eventHeight) : 0;
    const inset = Math.max(screenInset, windowInset, heightInset);

    return {
        keyboardTop,
        inset,
        visible: inset > 0 || keyboardTop < windowHeight,
    };
}

function ProjectDetailScrollFrame({
    backgroundColor,
    children,
    keyboardBottomInset,
    onScroll,
    reorderMode,
    scrollRef,
}: {
    backgroundColor: string;
    children: React.ReactNode;
    keyboardBottomInset: number;
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    reorderMode: boolean;
    scrollRef: React.RefObject<ScrollView | null>;
}) {
    const androidScrollViewFocusProps: Partial<ScrollViewProps> & { scrollsChildToFocus?: boolean } = (
        Platform.OS === 'android' ? { scrollsChildToFocus: false } : {}
    );
    const scrollProps = {
        style: [{ flex: 1 }, { backgroundColor }],
        contentContainerStyle: [
            styles.projectDetailScroll,
            { backgroundColor },
            keyboardBottomInset > 0 ? { paddingBottom: 24 + keyboardBottomInset } : null,
        ],
        keyboardShouldPersistTaps: 'always' as const,
    };

    const scrollNode = reorderMode ? (
        // Reorder mode needs the nested draggable wrapper required by the library:
        // https://github.com/computerjazz/react-native-draggable-flatlist#nesting-draggableflatlists
        <NestableScrollContainer {...scrollProps}>
            {children}
        </NestableScrollContainer>
    ) : (
        // Normal mode stays on a plain ScrollView so Swipeable rows keep horizontal gestures.
        <ScrollView
            {...scrollProps}
            ref={scrollRef}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            directionalLockEnabled
            nestedScrollEnabled
            onScroll={onScroll}
            scrollEventThrottle={16}
            {...androidScrollViewFocusProps}
        >
            {children}
        </ScrollView>
    );

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'android' ? 'height' : undefined}
            keyboardVerticalOffset={0}
            style={[{ flex: 1 }, { backgroundColor }]}
        >
            {scrollNode}
        </KeyboardAvoidingView>
    );
}

export function ProjectDetailModal({
    addProjectFileAttachment,
    closeProjectDetail,
    commitSelectedProjectNotes,
    formatProjectDate,
    handleArchiveSelectedProject,
    handleSelectedProjectNotesApplyAction,
    handleSelectedProjectNotesApplyAutocomplete,
    handleSelectedProjectNotesChange,
    handleSelectedProjectNotesSelectionChange,
    handleSelectedProjectNotesUndo,
    handleSetProjectStatus,
    isSelectedProjectNotesFocused,
    modalHeaderStyle,
    notesExpanded,
    notesFullscreen,
    onCloseNotesFullscreen,
    onDuplicateProject,
    onDownloadAttachment,
    onOpenAreaPicker,
    onOpenAttachment,
    onOpenTagPicker,
    onRemoveProjectAttachment,
    onSetLinkInput,
    onSetLinkModalVisible,
    onSetNotesExpanded,
    onSetSelectedProject,
    onSetSelectedProjectNotesFocused,
    onSetShowDueDatePicker,
    onSetShowNotesFullscreen,
    onSetShowNotesPreview,
    onSetShowProjectMeta,
    onSetShowReviewPicker,
    onSetShowStatusMenu,
    onToggleShowCompletedTasks,
    onProjectTaskSortByChange,
    overlayVisible,
    presentationStyle,
    projectTaskSortBy,
    selectedProjectAreaName,
    selectedProject,
    selectedProjectTasks,
    selectedProjectNotes,
    selectedProjectNotesDirection,
    selectedProjectNotesInputRef,
    selectedProjectNotesSelection,
    selectedProjectNotesTextDirectionStyle,
    selectedProjectNotesUndoDepth,
    showDueDatePicker,
    showNotesPreview,
    showProjectMeta,
    showReviewPicker,
    showStatusMenu,
    showCompletedTasks,
    statusPalette,
    t,
    tc,
    updateProject,
}: ProjectDetailModalProps) {
    const [projectTaskReorderMode, setProjectTaskReorderMode] = React.useState(false);
    const [projectTaskFilterOpenSignal, setProjectTaskFilterOpenSignal] = React.useState(0);
    const [projectQuickAddFocusSignal, setProjectQuickAddFocusSignal] = React.useState(0);
    const [projectTaskListOffsetY, setProjectTaskListOffsetY] = React.useState(0);
    const projectDetailScrollRef = React.useRef<ScrollView | null>(null);
    const projectDetailScrollOffsetRef = React.useRef(0);
    const [projectDetailScrollWindow, setProjectDetailScrollWindow] = React.useState({
        offsetY: 0,
        viewportHeight: 0,
    });
    const projectDetailKeyboardTopRef = React.useRef(Dimensions.get('window').height);
    const projectDetailKeyboardVisibleRef = React.useRef(false);
    const projectDetailFocusedInputHandleRef = React.useRef<number | null>(null);
    const [projectDetailKeyboardBottomInset, setProjectDetailKeyboardBottomInset] = React.useState(0);
    const safeAreaEdges = getProjectDetailModalSafeAreaEdges(presentationStyle);
    const taskListOptions = getProjectDetailTaskListOptions(selectedProject, showCompletedTasks);
    const showCompletedLabel = showCompletedTasks
        ? tFallback(t, 'common.hideCompleted', 'Hide completed')
        : tFallback(t, 'common.showCompleted', 'Show completed');
    const sequentialScopeLabel = tFallback(t, 'projects.sequentialScope', 'Sequential Scope');
    const sequentialAcrossSectionsLabel = tFallback(t, 'projects.sequentialAcrossSections', 'Across sections');
    const sequentialWithinSectionsLabel = tFallback(t, 'projects.sequentialWithinSections', 'Within sections');
    const sequentialScopeHelpLabel = tFallback(t, 'projects.sequentialScopeHelpLabel', 'Sequential scope help');
    const sequentialScopeHelpText = tFallback(
        t,
        'projects.sequentialScopeHelpText',
        'Across sections surfaces one available action for the whole project. Within sections surfaces one available action per section.'
    );
    const projectTypeHelpLabel = tFallback(t, 'projects.projectTypeHelpLabel', 'Project type help');
    const projectTypeHelpText = tFallback(
        t,
        'projects.projectTypeHelpText',
        'Sequential projects surface one available action at a time. Parallel projects can surface multiple independent Next tasks.'
    );
    const sequenceCueLabels = React.useMemo<Record<ProjectSequenceTaskCue, string>>(
        () => ({
            available: tFallback(t, 'projects.availableNextAction', 'Available next action'),
            later: tFallback(t, 'projects.laterInSequence', 'Later in sequence'),
        }),
        [t]
    );
    const resolvedSequentialScope = selectedProject?.sequentialScope === 'section' ? 'section' : 'project';
    const projectTaskSequenceCues = React.useMemo<Map<string, ProjectSequenceTaskCue>>(() => {
        if (!selectedProject || projectTaskSortBy !== 'default') return new Map();
        return getSequentialProjectTaskCues(selectedProject, selectedProjectTasks ?? []);
    }, [projectTaskSortBy, selectedProject, selectedProjectTasks]);
    const getTaskSequenceCue = React.useCallback(
        (task: Task) => projectTaskSequenceCues.get(task.id),
        [projectTaskSequenceCues]
    );
    const showProjectTypeHelp = React.useCallback(() => {
        Alert.alert(projectTypeHelpLabel, projectTypeHelpText);
    }, [projectTypeHelpLabel, projectTypeHelpText]);
    const showSequentialScopeHelp = React.useCallback(() => {
        Alert.alert(sequentialScopeHelpLabel, sequentialScopeHelpText);
    }, [sequentialScopeHelpLabel, sequentialScopeHelpText]);
    const sortLabel = tFallback(t, 'sort.label', 'Sort');
    const taskControlsLabel = tFallback(t, 'common.tasks', 'Tasks');
    const projectTaskFilterActiveCount = (
        (projectTaskSortBy !== 'default' ? 1 : 0)
        + (selectedProject?.status !== 'archived' && showCompletedTasks ? 1 : 0)
    );
    const clearProjectTaskFilters = React.useCallback(() => {
        if (projectTaskSortBy !== 'default') {
            onProjectTaskSortByChange('default');
        }
        if (selectedProject?.status !== 'archived' && showCompletedTasks) {
            onToggleShowCompletedTasks();
        }
    }, [
        onProjectTaskSortByChange,
        onToggleShowCompletedTasks,
        projectTaskSortBy,
        selectedProject?.status,
        showCompletedTasks,
    ]);
    const setSelectedProjectSequentialScope = (sequentialScope: Project['sequentialScope']) => {
        if (!selectedProject) return;
        updateProject(selectedProject.id, { sequentialScope });
        onSetSelectedProject({ ...selectedProject, sequentialScope });
    };
    const projectTaskFilterAccessory = selectedProject ? (
        <View style={styles.projectTaskFilterSection}>
            <View style={styles.projectTaskFilterGroup}>
                <Text style={[styles.projectFilterSectionLabel, { color: tc.secondaryText }]}>
                    {sortLabel}
                </Text>
                <View
                    accessibilityLabel={sortLabel}
                    accessibilityRole="radiogroup"
                    style={styles.projectFilterChipRow}
                >
                    {(['default', 'due'] as const).map((option) => {
                        const selected = projectTaskSortBy === option;
                        const label = option === 'default'
                            ? tFallback(t, 'sort.default', 'Default')
                            : tFallback(t, 'sort.due', 'Due date');
                        return (
                            <TouchableOpacity
                                key={option}
                                accessibilityLabel={`${sortLabel}: ${label}`}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                onPress={() => onProjectTaskSortByChange(option)}
                                style={[
                                    styles.projectFilterChip,
                                    {
                                        backgroundColor: selected ? tc.tint : tc.filterBg,
                                        borderColor: selected ? tc.tint : tc.border,
                                    },
                                ]}
                                testID={`project-task-sort-${option}`}
                            >
                                <Text
                                    style={[
                                        styles.projectFilterChipText,
                                        { color: selected ? tc.onTint : tc.text },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            {selectedProject.status !== 'archived' ? (
                <View style={styles.projectTaskFilterGroup}>
                    <Text style={[styles.projectFilterSectionLabel, { color: tc.secondaryText }]}>
                        {taskControlsLabel}
                    </Text>
                    <TouchableOpacity
                        accessibilityLabel={showCompletedLabel}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: showCompletedTasks }}
                        onPress={onToggleShowCompletedTasks}
                        style={[
                            styles.projectFilterSwitch,
                            {
                                backgroundColor: showCompletedTasks ? `${tc.tint}20` : tc.filterBg,
                                borderColor: showCompletedTasks ? tc.tint : tc.border,
                            },
                        ]}
                        testID="project-show-completed-toggle"
                    >
                        <Text
                            style={[
                                styles.projectFilterSwitchText,
                                { color: showCompletedTasks ? tc.tint : tc.text },
                            ]}
                            numberOfLines={1}
                        >
                            {showCompletedLabel}
                        </Text>
                        <View
                            style={[
                                styles.projectFilterSwitchIndicator,
                                {
                                    backgroundColor: showCompletedTasks ? tc.tint : 'transparent',
                                    borderColor: showCompletedTasks ? tc.tint : tc.border,
                                },
                            ]}
                        >
                            {showCompletedTasks ? (
                                <Ionicons name="checkmark" size={15} color={tc.onTint} />
                            ) : null}
                        </View>
                    </TouchableOpacity>
                </View>
            ) : null}
        </View>
    ) : null;

    const handlePinnedProjectAddTask = React.useCallback(() => {
        projectDetailScrollRef.current?.scrollTo({
            y: Math.max(0, projectTaskListOffsetY - 8),
            animated: true,
        });
        setProjectQuickAddFocusSignal((value) => value + 1);
    }, [projectTaskListOffsetY]);

    const handlePinnedProjectFilters = React.useCallback(() => {
        setProjectTaskFilterOpenSignal((value) => value + 1);
    }, []);

    const resetProjectDetailVirtualWindow = React.useCallback(() => {
        projectDetailScrollOffsetRef.current = 0;
        setProjectTaskListOffsetY(0);
        setProjectDetailScrollWindow((current) => {
            if (current.offsetY === 0 && current.viewportHeight === 0) {
                return current;
            }
            return { offsetY: 0, viewportHeight: 0 };
        });
    }, []);

    React.useEffect(() => {
        resetProjectDetailVirtualWindow();
    }, [resetProjectDetailVirtualWindow, selectedProject?.id]);

    React.useEffect(() => {
        setProjectTaskReorderMode(false);
    }, [overlayVisible, selectedProject?.id]);

    React.useEffect(() => {
        if (Platform.OS !== 'android') return;
        if (typeof Keyboard?.addListener !== 'function') return;
        const updateKeyboardTop = (event: { endCoordinates?: { screenY?: number; height?: number } }) => {
            const frame = getAndroidKeyboardFrame(event);
            projectDetailKeyboardTopRef.current = frame.keyboardTop;
            projectDetailKeyboardVisibleRef.current = frame.visible;
            setProjectDetailKeyboardBottomInset(frame.inset);
            const focusedInputHandle = projectDetailFocusedInputHandleRef.current;
            if (projectDetailKeyboardVisibleRef.current && focusedInputHandle) {
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => scrollProjectInputIntoView(focusedInputHandle));
                } else {
                    setTimeout(() => scrollProjectInputIntoView(focusedInputHandle), 0);
                }
            }
        };
        const resetKeyboardTop = () => {
            projectDetailKeyboardTopRef.current = Dimensions.get('window').height;
            projectDetailKeyboardVisibleRef.current = false;
            setProjectDetailKeyboardBottomInset(0);
        };
        const showListener = Keyboard.addListener('keyboardDidShow', updateKeyboardTop);
        const changeListener = Keyboard.addListener('keyboardDidChangeFrame', updateKeyboardTop);
        const hideListener = Keyboard.addListener('keyboardDidHide', resetKeyboardTop);
        return () => {
            showListener.remove();
            changeListener.remove();
            hideListener.remove();
        };
    }, []);

    const scrollProjectInputIntoView = React.useCallback((targetInput?: number | string) => {
        if (Platform.OS !== 'android') return;
        const targetHandle = typeof targetInput === 'number'
            ? targetInput
            : typeof targetInput === 'string'
                ? Number(targetInput)
                : NaN;
        if (!Number.isFinite(targetHandle) || targetHandle <= 0) return;
        projectDetailFocusedInputHandleRef.current = targetHandle;
        if (!projectDetailKeyboardVisibleRef.current) return;
        const scrollView = projectDetailScrollRef.current;
        if (!scrollView) return;
        const scrollHandle = findNodeHandle(scrollView);
        if (!scrollHandle) return;

        const measureAndScroll = () => {
            UIManager.measureInWindow(targetHandle, (_x, targetY, _w, targetH) => {
                if (!Number.isFinite(targetY) || !Number.isFinite(targetH)) return;
                UIManager.measureInWindow(scrollHandle, (_sx, scrollY, _sw, scrollH) => {
                    if (!Number.isFinite(scrollY) || !Number.isFinite(scrollH)) return;
                    const visibleTop = scrollY;
                    const keyboardTop = projectDetailKeyboardTopRef.current;
                    const visibleBottom = Math.min(scrollY + scrollH, keyboardTop);
                    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
                    const bottomClearance = visibleHeight * 0.18;
                    const effectiveVisibleBottom = visibleBottom - bottomClearance;
                    const targetBottom = targetY + targetH;
                    if (targetBottom <= effectiveVisibleBottom) return;
                    const delta = targetBottom - effectiveVisibleBottom;
                    const nextOffset = Math.max(0, projectDetailScrollOffsetRef.current + delta);
                    projectDetailScrollRef.current?.scrollTo({ y: nextOffset, animated: true });
                });
            });
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                measureAndScroll();
                requestAnimationFrame(measureAndScroll);
            });
        } else {
            setTimeout(measureAndScroll, 0);
        }
    }, []);

    React.useEffect(() => {
        if (Platform.OS !== 'android' || projectDetailKeyboardBottomInset <= 0) return;
        const focusedInputHandle = projectDetailFocusedInputHandleRef.current;
        if (!focusedInputHandle) return;
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => scrollProjectInputIntoView(focusedInputHandle));
        } else {
            setTimeout(() => scrollProjectInputIntoView(focusedInputHandle), 0);
        }
    }, [projectDetailKeyboardBottomInset, scrollProjectInputIntoView]);

    return (
        <Modal
            visible={overlayVisible}
            animationType="slide"
            presentationStyle={presentationStyle}
            transparent={false}
            allowSwipeDismissal
            onRequestClose={closeProjectDetail}
        >
            {/* Android Modal content needs its own gesture root; the screen root does not cover Modal.
                https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/installation/#android */}
            <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardAccessoryHost backgroundColor={tc.bg}>
                    <SafeAreaView style={[styles.projectDetailRoot, { backgroundColor: tc.bg }]} edges={safeAreaEdges}>
                        {selectedProject ? (
                            <>
                                <View style={modalHeaderStyle}>
                                    <TouchableOpacity
                                        onPress={closeProjectDetail}
                                        style={styles.backButton}
                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    >
                                        <Text style={[styles.backButtonText, { color: tc.tint }]}>{t('common.back') || 'Back'}</Text>
                                    </TouchableOpacity>
                                    <TextInput
                                        style={[styles.modalTitle, { color: tc.text, marginLeft: 8, flex: 1 }]}
                                        value={selectedProject.title}
                                        onChangeText={(text) => onSetSelectedProject({ ...selectedProject, title: text })}
                                        onSubmitEditing={() => {
                                            const title = selectedProject.title.trim();
                                            if (!title) return;
                                            updateProject(selectedProject.id, { title });
                                            onSetSelectedProject({ ...selectedProject, title });
                                        }}
                                        onEndEditing={() => {
                                            const title = selectedProject.title.trim();
                                            if (!title) return;
                                            updateProject(selectedProject.id, { title });
                                            onSetSelectedProject({ ...selectedProject, title });
                                        }}
                                        returnKeyType="done"
                                    />
                                </View>
                                <View style={[styles.projectTaskPinnedToolbar, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]}>
                                    <View style={styles.projectTaskPinnedToolbarContent}>
                                        {taskListOptions.allowAdd ? (
                                            <TouchableOpacity
                                                accessibilityRole="button"
                                                accessibilityLabel={t('projects.addTask')}
                                                onPress={handlePinnedProjectAddTask}
                                                style={[styles.projectTaskPinnedButton, { backgroundColor: tc.tint, borderColor: tc.tint }]}
                                            >
                                                <Ionicons name="add" size={16} color={tc.onTint} />
                                                <Text style={[styles.projectTaskPinnedButtonText, { color: tc.onTint }]} numberOfLines={1}>
                                                    {t('projects.addTask')}
                                                </Text>
                                            </TouchableOpacity>
                                        ) : null}
                                        <TouchableOpacity
                                            accessibilityRole="button"
                                            accessibilityLabel={tFallback(t, 'filters.label', 'Filters')}
                                            onPress={handlePinnedProjectFilters}
                                            style={[styles.projectTaskPinnedButton, { backgroundColor: tc.filterBg, borderColor: projectTaskFilterActiveCount > 0 ? tc.tint : tc.border }]}
                                        >
                                            <Ionicons name="options-outline" size={16} color={projectTaskFilterActiveCount > 0 ? tc.tint : tc.secondaryText} />
                                            <Text style={[styles.projectTaskPinnedButtonText, { color: projectTaskFilterActiveCount > 0 ? tc.tint : tc.text }]} numberOfLines={1}>
                                                {tFallback(t, 'filters.label', 'Filters')}
                                            </Text>
                                            {projectTaskFilterActiveCount > 0 ? (
                                                <View style={[styles.projectTaskPinnedBadge, { backgroundColor: tc.tint }]}>
                                                    <Text style={[styles.projectTaskPinnedBadgeText, { color: tc.onTint }]}>
                                                        {projectTaskFilterActiveCount}
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </TouchableOpacity>
                                        {(['default', 'due'] as const).map((option) => {
                                            const selected = projectTaskSortBy === option;
                                            const label = option === 'default'
                                                ? tFallback(t, 'sort.default', 'Default')
                                                : tFallback(t, 'sort.due', 'Due date');
                                            return (
                                                <TouchableOpacity
                                                    key={option}
                                                    accessibilityRole="button"
                                                    accessibilityState={{ selected }}
                                                    onPress={() => onProjectTaskSortByChange(option)}
                                                    style={[
                                                        styles.projectTaskPinnedButton,
                                                        {
                                                            backgroundColor: selected ? tc.tint : tc.filterBg,
                                                            borderColor: selected ? tc.tint : tc.border,
                                                        },
                                                    ]}
                                                >
                                                    <Text style={[styles.projectTaskPinnedButtonText, { color: selected ? tc.onTint : tc.text }]} numberOfLines={1}>
                                                        {label}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                        {selectedProject.status !== 'archived' ? (
                                            <TouchableOpacity
                                                accessibilityRole="switch"
                                                accessibilityState={{ checked: showCompletedTasks }}
                                                accessibilityLabel={showCompletedLabel}
                                                onPress={onToggleShowCompletedTasks}
                                                style={[
                                                    styles.projectTaskPinnedButton,
                                                    {
                                                        backgroundColor: showCompletedTasks ? `${tc.tint}20` : tc.filterBg,
                                                        borderColor: showCompletedTasks ? tc.tint : tc.border,
                                                    },
                                                ]}
                                            >
                                                <Ionicons name={showCompletedTasks ? 'checkmark-circle' : 'checkmark-circle-outline'} size={16} color={showCompletedTasks ? tc.tint : tc.secondaryText} />
                                                <Text style={[styles.projectTaskPinnedButtonText, { color: showCompletedTasks ? tc.tint : tc.text }]} numberOfLines={1}>
                                                    {showCompletedLabel}
                                                </Text>
                                            </TouchableOpacity>
                                        ) : null}
                                        {taskListOptions.enableProjectReorder ? (
                                            <TouchableOpacity
                                                accessibilityRole="button"
                                                accessibilityState={{ selected: projectTaskReorderMode }}
                                                accessibilityLabel={projectTaskReorderMode
                                                    ? t('common.done')
                                                    : tFallback(t, 'projects.reorderTasks', 'Order')}
                                                onPress={() => setProjectTaskReorderMode((value) => !value)}
                                                style={[
                                                    styles.projectTaskPinnedButton,
                                                    {
                                                        backgroundColor: projectTaskReorderMode ? tc.tint : tc.filterBg,
                                                        borderColor: projectTaskReorderMode ? tc.tint : tc.border,
                                                    },
                                                ]}
                                            >
                                                <Ionicons name="reorder-three-outline" size={18} color={projectTaskReorderMode ? tc.onTint : tc.secondaryText} />
                                                <Text style={[styles.projectTaskPinnedButtonText, { color: projectTaskReorderMode ? tc.onTint : tc.text }]} numberOfLines={1}>
                                                    {projectTaskReorderMode ? t('common.done') : tFallback(t, 'projects.reorderTasks', 'Order')}
                                                </Text>
                                            </TouchableOpacity>
                                        ) : null}
                                    </View>
                                </View>
                                <ProjectDetailScrollFrame
                                    backgroundColor={tc.bg}
                                    keyboardBottomInset={projectDetailKeyboardBottomInset}
                                onScroll={(event) => {
                                    const offsetY = event.nativeEvent.contentOffset.y;
                                    const viewportHeight = event.nativeEvent.layoutMeasurement?.height
                                        ?? projectDetailScrollWindow.viewportHeight;
                                    projectDetailScrollOffsetRef.current = offsetY;
                                    setProjectDetailScrollWindow((current) => {
                                        if (
                                            Math.abs(current.offsetY - offsetY) < 32
                                            && Math.abs(current.viewportHeight - viewportHeight) < 1
                                        ) {
                                            return current;
                                        }
                                        return { offsetY, viewportHeight };
                                    });
                                }}
                                    reorderMode={projectTaskReorderMode}
                                    scrollRef={projectDetailScrollRef}
                                >
                                <View style={[styles.statusBlock, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]}>
                                    <View style={styles.statusActionsRow}>
                                        <Text style={[styles.statusLabel, { color: tc.secondaryText }]}>{t('projects.statusLabel')}</Text>
                                        <TouchableOpacity
                                            onPress={() => onSetShowStatusMenu((prev) => !prev)}
                                            style={[
                                                styles.statusPicker,
                                                {
                                                    backgroundColor: statusPalette[selectedProject.status]?.bg ?? tc.filterBg,
                                                    borderColor: statusPalette[selectedProject.status]?.border ?? tc.border,
                                                },
                                            ]}
                                        >
                                            <Text style={[styles.statusPickerText, { color: statusPalette[selectedProject.status]?.text ?? tc.text }]}>
                                                {selectedProject.status === 'active'
                                                    ? t('status.active')
                                                    : selectedProject.status === 'waiting'
                                                        ? t('status.waiting')
                                                        : t('status.someday')}
                                            </Text>
                                            <Text style={[styles.statusPickerText, { color: statusPalette[selectedProject.status]?.text ?? tc.text }]}>▾</Text>
                                        </TouchableOpacity>
                                        <View style={{ flex: 1 }} />
                                        <TouchableOpacity
                                            onPress={() => onDuplicateProject(selectedProject.id)}
                                            style={[styles.statusButton, { backgroundColor: tc.filterBg }]}
                                        >
                                            <Text style={[styles.statusButtonText, { color: tc.tint }]}>
                                                {t('projects.duplicate')}
                                            </Text>
                                        </TouchableOpacity>
                                        {selectedProject.status === 'archived' ? (
                                            <TouchableOpacity
                                                onPress={() => handleSetProjectStatus('active')}
                                                style={[styles.statusButton, styles.reactivateButton]}
                                            >
                                                <Text style={[styles.statusButtonText, styles.reactivateText]}>
                                                    {t('projects.reactivate')}
                                                </Text>
                                            </TouchableOpacity>
                                        ) : (
                                            <TouchableOpacity
                                                onPress={handleArchiveSelectedProject}
                                                style={[styles.statusButton, styles.archiveButton]}
                                            >
                                                <Text style={[styles.statusButtonText, styles.archiveText]}>
                                                    {t('projects.archive')}
                                                </Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                    {showStatusMenu && (
                                        <View style={[styles.statusMenu, { backgroundColor: tc.inputBg, borderColor: tc.border }]}>
                                            {(['active', 'waiting', 'someday'] as const).map((status) => {
                                                const isActive = selectedProject.status === status;
                                                const palette = statusPalette[status];
                                                return (
                                                    <TouchableOpacity
                                                        key={status}
                                                        onPress={() => handleSetProjectStatus(status)}
                                                        style={[styles.statusMenuItem, isActive && { backgroundColor: tc.filterBg }]}
                                                    >
                                                        <View style={[styles.statusDot, { backgroundColor: palette?.border ?? tc.border }]} />
                                                        <Text style={[styles.statusMenuText, { color: palette?.text ?? tc.text }]}>
                                                            {status === 'active'
                                                                ? t('status.active')
                                                                : status === 'waiting'
                                                                    ? t('status.waiting')
                                                                    : t('status.someday')}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    )}
                                </View>

                                <View style={[styles.detailsToggle, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                    <TouchableOpacity
                                        style={styles.detailsToggleButton}
                                        onPress={() => onSetShowProjectMeta((prev) => !prev)}
                                    >
                                        <Text style={[styles.detailsToggleText, { color: tc.text }]}>
                                            {showProjectMeta ? '▾' : '▸'} {t('taskEdit.details')}
                                        </Text>
                                    </TouchableOpacity>
                                    <View style={styles.projectTypeControls}>
                                        <TouchableOpacity
                                            accessibilityRole="button"
                                            onPress={() => {
                                                updateProject(selectedProject.id, { isSequential: !selectedProject.isSequential });
                                                onSetSelectedProject({ ...selectedProject, isSequential: !selectedProject.isSequential });
                                            }}
                                            style={[
                                                styles.sequentialToggle,
                                                {
                                                    backgroundColor: selectedProject.isSequential ? tc.tint : tc.filterBg,
                                                    borderColor: selectedProject.isSequential ? tc.tint : tc.border,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.sequentialToggleText,
                                                    { color: selectedProject.isSequential ? tc.onTint : tc.secondaryText },
                                                ]}
                                            >
                                                {selectedProject.isSequential ? 'Seq' : 'Par'}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            accessibilityLabel={projectTypeHelpLabel}
                                            accessibilityRole="button"
                                            onPress={showProjectTypeHelp}
                                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                            style={[
                                                styles.projectTypeHelpButton,
                                                { backgroundColor: tc.filterBg, borderColor: tc.border },
                                            ]}
                                        >
                                            <Ionicons name="help-circle-outline" size={17} color={tc.secondaryText} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                {showProjectMeta && (
                                    <>
                                        {selectedProject.isSequential && (
                                            <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                                <View style={styles.reviewLabelRow}>
                                                    <Text style={[styles.reviewLabel, { color: tc.text }]}>{sequentialScopeLabel}</Text>
                                                    <TouchableOpacity
                                                        accessibilityLabel={sequentialScopeHelpLabel}
                                                        accessibilityRole="button"
                                                        onPress={showSequentialScopeHelp}
                                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                                        style={[
                                                            styles.projectTypeHelpButton,
                                                            { backgroundColor: tc.filterBg, borderColor: tc.border },
                                                        ]}
                                                    >
                                                        <Ionicons name="help-circle-outline" size={17} color={tc.secondaryText} />
                                                    </TouchableOpacity>
                                                </View>
                                                <View style={styles.sequentialScopeOptions}>
                                                    {(['project', 'section'] as const).map((scope) => {
                                                        const selected = resolvedSequentialScope === scope;
                                                        return (
                                                            <TouchableOpacity
                                                                key={scope}
                                                                accessibilityRole="button"
                                                                accessibilityState={{ selected }}
                                                                onPress={() => setSelectedProjectSequentialScope(scope)}
                                                                style={[
                                                                    styles.sequentialScopeButton,
                                                                    {
                                                                        backgroundColor: selected ? tc.tint : tc.inputBg,
                                                                        borderColor: selected ? tc.tint : tc.border,
                                                                    },
                                                                ]}
                                                            >
                                                                <Text
                                                                    style={[
                                                                        styles.sequentialScopeText,
                                                                        { color: selected ? tc.onTint : tc.text },
                                                                    ]}
                                                                >
                                                                    {scope === 'section'
                                                                        ? sequentialWithinSectionsLabel
                                                                        : sequentialAcrossSectionsLabel}
                                                                </Text>
                                                            </TouchableOpacity>
                                                        );
                                                    })}
                                                </View>
                                            </View>
                                        )}

                                        <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('projects.areaLabel')}</Text>
                                            <TouchableOpacity
                                                style={[styles.reviewButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                onPress={onOpenAreaPicker}
                                            >
                                                <Text style={{ color: tc.text }}>{selectedProjectAreaName}</Text>
                                            </TouchableOpacity>
                                        </View>

                                        <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('taskEdit.tagsLabel')}</Text>
                                            <TouchableOpacity
                                                style={[styles.reviewButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                onPress={onOpenTagPicker}
                                            >
                                                <Text style={{ color: tc.text }}>
                                                    {selectedProject.tagIds?.length ? selectedProject.tagIds.join(', ') : t('common.none')}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>

                                        <View style={[styles.notesContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <View style={styles.notesHeaderRow}>
                                                <TouchableOpacity
                                                    style={[styles.notesHeader, { flex: 1 }]}
                                                    onPress={() => {
                                                        onSetNotesExpanded(!notesExpanded);
                                                        if (notesExpanded) onSetShowNotesPreview(false);
                                                    }}
                                                >
                                                    <Text style={[styles.notesTitle, { color: tc.text }]}>
                                                        {notesExpanded ? '▾' : '▸'} {t('project.notes')}
                                                    </Text>
                                                </TouchableOpacity>
                                                {notesExpanded && (
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                        <TouchableOpacity
                                                            onPress={() => onSetShowNotesPreview((value) => !value)}
                                                            style={[styles.smallButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                                        >
                                                            <Text style={[styles.smallButtonText, { color: tc.tint }]}>
                                                                {showNotesPreview ? t('markdown.edit') : t('markdown.preview')}
                                                            </Text>
                                                        </TouchableOpacity>
                                                        <TouchableOpacity
                                                            onPress={() => onSetShowNotesFullscreen(true)}
                                                            accessibilityRole="button"
                                                            accessibilityLabel={t('markdown.expand')}
                                                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                                        >
                                                            <Ionicons name="expand-outline" size={20} color={tc.tint} />
                                                        </TouchableOpacity>
                                                    </View>
                                                )}
                                            </View>
                                            {notesExpanded && (
                                                showNotesPreview ? (
                                                    <View style={[styles.markdownPreview, { borderColor: tc.border, backgroundColor: tc.filterBg }]}>
                                                        <MarkdownText markdown={selectedProjectNotes} tc={tc} direction={selectedProjectNotesDirection} />
                                                    </View>
                                                ) : (
                                                    <>
                                                        <MarkdownFormatToolbar
                                                            selection={selectedProjectNotesSelection}
                                                            onSelectionChange={handleSelectedProjectNotesSelectionChange}
                                                            inputRef={selectedProjectNotesInputRef}
                                                            t={t}
                                                            tc={tc}
                                                            visible={isSelectedProjectNotesFocused}
                                                            canUndo={selectedProjectNotesUndoDepth > 0}
                                                            onUndo={handleSelectedProjectNotesUndo}
                                                            onApplyAction={handleSelectedProjectNotesApplyAction}
                                                        />
                                                        <MarkdownReferenceAutocomplete
                                                            value={selectedProjectNotes}
                                                            selection={selectedProjectNotesSelection}
                                                            inputRef={selectedProjectNotesInputRef}
                                                            visible={isSelectedProjectNotesFocused}
                                                            onApplyResult={handleSelectedProjectNotesApplyAutocomplete}
                                                            t={t}
                                                            tc={tc}
                                                        />
                                                        <TextInput
                                                            ref={selectedProjectNotesInputRef}
                                                            style={[
                                                                styles.notesInput,
                                                                selectedProjectNotesTextDirectionStyle,
                                                                { color: tc.text, backgroundColor: tc.inputBg, borderColor: tc.border },
                                                            ]}
                                                            multiline
                                                            placeholder={t('projects.notesPlaceholder')}
                                                            placeholderTextColor={tc.secondaryText}
                                                            value={selectedProjectNotes}
                                                            onFocus={() => onSetSelectedProjectNotesFocused(true)}
                                                            onBlur={() => {
                                                                onSetSelectedProjectNotesFocused(false);
                                                                commitSelectedProjectNotes();
                                                            }}
                                                            onChangeText={handleSelectedProjectNotesChange}
                                                            onSelectionChange={(event) => {
                                                                handleSelectedProjectNotesSelectionChange(event.nativeEvent.selection);
                                                            }}
                                                            selection={selectedProjectNotesSelection}
                                                            onEndEditing={commitSelectedProjectNotes}
                                                        />
                                                    </>
                                                )
                                            )}
                                        </View>

                                        <View style={[styles.attachmentsContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <View style={styles.attachmentsHeader}>
                                                <Text style={[styles.attachmentsTitle, { color: tc.text }]}>{t('attachments.title')}</Text>
                                                <View style={styles.attachmentsActions}>
                                                    <TouchableOpacity
                                                        onPress={addProjectFileAttachment}
                                                        style={[styles.smallButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                                    >
                                                        <Text style={[styles.smallButtonText, { color: tc.tint }]}>{t('attachments.addFile')}</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        onPress={() => {
                                                            onSetLinkModalVisible(true);
                                                            onSetLinkInput('');
                                                        }}
                                                        style={[styles.smallButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                                    >
                                                        <Text style={[styles.smallButtonText, { color: tc.tint }]}>{t('attachments.addLink')}</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                            {((selectedProject.attachments || []) as Attachment[]).filter((attachment) => !attachment.deletedAt).length === 0 ? (
                                                <Text style={[styles.helperText, { color: tc.secondaryText }]}>{t('common.none')}</Text>
                                            ) : (
                                                <View style={[styles.attachmentsList, { borderColor: tc.border, backgroundColor: tc.cardBg }]}>
                                                    {((selectedProject.attachments || []) as Attachment[])
                                                        .filter((attachment) => !attachment.deletedAt)
                                                        .map((attachment) => {
                                                            const isMissing = attachment.kind === 'file'
                                                                && (!attachment.uri || attachment.localStatus === 'missing');
                                                            const canDownload = isMissing && Boolean(attachment.cloudKey);
                                                            const isDownloading = attachment.localStatus === 'downloading';
                                                            return (
                                                                <View key={attachment.id} style={[styles.attachmentRow, { borderBottomColor: tc.border }]}>
                                                                    <TouchableOpacity
                                                                        style={styles.attachmentTitleWrap}
                                                                        onPress={() => onOpenAttachment(attachment)}
                                                                        disabled={isDownloading}
                                                                    >
                                                                        <Text style={[styles.attachmentTitle, { color: tc.tint }]} numberOfLines={1}>
                                                                            {getAttachmentDisplayTitle(attachment)}
                                                                        </Text>
                                                                        <AttachmentProgressIndicator attachmentId={attachment.id} />
                                                                    </TouchableOpacity>
                                                                    {isDownloading ? (
                                                                        <Text style={[styles.attachmentStatus, { color: tc.secondaryText }]}>
                                                                            {t('common.loading')}
                                                                        </Text>
                                                                    ) : canDownload ? (
                                                                        <TouchableOpacity onPress={() => onDownloadAttachment(attachment)}>
                                                                            <Text style={[styles.attachmentDownload, { color: tc.tint }]}>
                                                                                {t('attachments.download')}
                                                                            </Text>
                                                                        </TouchableOpacity>
                                                                    ) : isMissing ? (
                                                                        <Text style={[styles.attachmentStatus, { color: tc.secondaryText }]}>
                                                                            {t('attachments.missing')}
                                                                        </Text>
                                                                    ) : null}
                                                                    <TouchableOpacity onPress={() => onRemoveProjectAttachment(attachment.id)}>
                                                                        <Text style={[styles.attachmentRemove, { color: tc.secondaryText }]}>
                                                                            {t('attachments.remove')}
                                                                        </Text>
                                                                    </TouchableOpacity>
                                                                </View>
                                                            );
                                                        })}
                                                </View>
                                            )}
                                        </View>

                                        <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('taskEdit.dueDateLabel') || 'Due Date'}</Text>
                                            <TouchableOpacity
                                                style={[styles.reviewButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                onPress={() => onSetShowDueDatePicker(true)}
                                            >
                                                <Text style={{ color: tc.text }}>
                                                    {formatProjectDate(selectedProject.dueDate, t('common.notSet'))}
                                                </Text>
                                            </TouchableOpacity>
                                            {!!selectedProject.dueDate && (
                                                <TouchableOpacity
                                                    style={styles.clearReviewBtn}
                                                    onPress={() => {
                                                        updateProject(selectedProject.id, { dueDate: undefined });
                                                        onSetSelectedProject({ ...selectedProject, dueDate: undefined });
                                                    }}
                                                >
                                                    <Text style={[styles.clearReviewText, { color: tc.secondaryText }]}>{t('common.clear')}</Text>
                                                </TouchableOpacity>
                                            )}
                                            {showDueDatePicker && (
                                                <DateTimePicker
                                                    value={safeParseDate(selectedProject.dueDate) ?? new Date()}
                                                    mode="date"
                                                    display="default"
                                                        onChange={(_, date) => {
                                                            onSetShowDueDatePicker(false);
                                                            if (date) {
                                                                const iso = date.toISOString().slice(0, 10);
                                                                updateProject(selectedProject.id, { dueDate: iso });
                                                                onSetSelectedProject({ ...selectedProject, dueDate: iso });
                                                            }
                                                        }}
                                                />
                                            )}
                                        </View>

                                        <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('projects.reviewAt') || 'Review Date'}</Text>
                                            <TouchableOpacity
                                                style={[styles.reviewButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                onPress={() => onSetShowReviewPicker(true)}
                                            >
                                                <Text style={{ color: tc.text }}>
                                                    {formatProjectDate(selectedProject.reviewAt, t('common.notSet'))}
                                                </Text>
                                            </TouchableOpacity>
                                            {!!selectedProject.reviewAt && (
                                                <TouchableOpacity
                                                    style={styles.clearReviewBtn}
                                                    onPress={() => {
                                                        updateProject(selectedProject.id, { reviewAt: undefined });
                                                        onSetSelectedProject({ ...selectedProject, reviewAt: undefined });
                                                    }}
                                                >
                                                    <Text style={[styles.clearReviewText, { color: tc.secondaryText }]}>{t('common.clear')}</Text>
                                                </TouchableOpacity>
                                            )}
                                            {showReviewPicker && (
                                                <DateTimePicker
                                                    value={new Date(selectedProject.reviewAt || Date.now())}
                                                    mode="date"
                                                    display="default"
                                                        onChange={(_, date) => {
                                                            onSetShowReviewPicker(false);
                                                            if (date) {
                                                                const iso = date.toISOString();
                                                                updateProject(selectedProject.id, { reviewAt: iso });
                                                                onSetSelectedProject({ ...selectedProject, reviewAt: iso });
                                                            }
                                                        }}
                                                />
                                            )}
                                        </View>
                                    </>
                                )}

                                <View
                                    onLayout={(event) => {
                                        setProjectTaskListOffsetY(event.nativeEvent.layout.y);
                                    }}
                                >
                                    <TaskList
                                        statusFilter="all"
                                        title={selectedProject.title}
                                        filterSheetAccessory={projectTaskFilterAccessory}
                                        extraFilterActiveCount={projectTaskFilterActiveCount}
                                        onClearExtraFilters={clearProjectTaskFilters}
                                        showHeader={false}
                                        showTimeEstimateFilters={false}
                                        projectId={selectedProject.id}
                                        taskSource={selectedProjectTasks}
                                        allowAdd={taskListOptions.allowAdd}
                                        staticList
                                        staticListVirtualization={{
                                            scrollOffsetY: projectDetailScrollWindow.offsetY,
                                            viewportHeight: projectDetailScrollWindow.viewportHeight,
                                        }}
                                        enableBulkActions
                                        externalFilterOpenSignal={projectTaskFilterOpenSignal}
                                        externalQuickAddFocusSignal={projectQuickAddFocusSignal}
                                        showSort={false}
                                        enableProjectReorder={taskListOptions.enableProjectReorder}
                                        projectSortBy={projectTaskSortBy}
                                        includeArchived={taskListOptions.includeArchived}
                                        includeDone={taskListOptions.includeDone}
                                        groupCompletedTasksLast={taskListOptions.groupCompletedTasksLast}
                                        getTaskSequenceCue={getTaskSequenceCue}
                                        sequenceCueLabels={sequenceCueLabels}
                                        onQuickAddInputFocus={scrollProjectInputIntoView}
                                        projectReorderMode={projectTaskReorderMode}
                                        onProjectReorderModeChange={setProjectTaskReorderMode}
                                    />
                                </View>
                                </ProjectDetailScrollFrame>
                                <ExpandedMarkdownEditor
                                    isOpen={notesFullscreen}
                                    onClose={onCloseNotesFullscreen}
                                    value={selectedProjectNotes}
                                    onChange={handleSelectedProjectNotesChange}
                                    onCommit={commitSelectedProjectNotes}
                                    title={t('project.notes')}
                                    headerTitle={selectedProject.title || t('project.notes')}
                                    placeholder={t('projects.notesPlaceholder')}
                                    t={t}
                                    initialMode="edit"
                                    direction={selectedProjectNotesDirection}
                                    selection={selectedProjectNotesSelection}
                                    onSelectionChange={handleSelectedProjectNotesSelectionChange}
                                    canUndo={selectedProjectNotesUndoDepth > 0}
                                    onUndo={handleSelectedProjectNotesUndo}
                                    onApplyAction={handleSelectedProjectNotesApplyAction}
                                />
                            </>
                        ) : null}
                    </SafeAreaView>
                </KeyboardAccessoryHost>
            </GestureHandlerRootView>
        </Modal>
    );
}

export function getProjectDetailModalSafeAreaEdges(presentationStyle: ProjectDetailModalProps['presentationStyle']) {
    return presentationStyle === 'fullScreen'
        ? ['top', 'left', 'right', 'bottom'] as const
        : ['left', 'right', 'bottom'] as const;
}

export function getProjectDetailTaskListOptions(selectedProject: Project | null, showCompletedTasks = false) {
    const isArchived = selectedProject?.status === 'archived';
    return {
        allowAdd: !isArchived,
        enableProjectReorder: !isArchived,
        includeArchived: isArchived,
        includeDone: isArchived || showCompletedTasks,
        groupCompletedTasksLast: !isArchived && showCompletedTasks,
    };
}
