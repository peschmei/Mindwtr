import React from 'react';
import {
    Alert,
    Dimensions,
    findNodeHandle,
    type FlatList,
    Keyboard,
    Modal,
    KeyboardAvoidingView,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
    type Attachment,
    getAttachmentDisplayTitle,
    type MarkdownSelection,
    type MarkdownToolbarActionId,
    type MarkdownToolbarResult,
    type Project,
    type ProjectSequenceTaskCue,
    type Section,
    type Task,
    type TaskSortBy,
    getSequentialProjectTaskCues,
    safeParseDate,
    tFallback,
} from '@mindwtr/core';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { KeyboardAccessoryHost } from '../../components/keyboard-accessory-host';
import { ToastViewport } from '../../contexts/toast-context';
import { ExpandedMarkdownEditor } from '../../components/expanded-markdown-editor';
import { MarkdownFormatToolbar } from '../../components/markdown-format-toolbar';
import { MarkdownReferenceAutocomplete } from '../../components/markdown-reference-autocomplete';
import { MarkdownText } from '../../components/markdown-text';
import { TaskList } from '../../components/task-list';
import { TaskListBulkBar, type TaskListBulkBarProps } from '../task-list/TaskListBulkBar';
import { TaskListSortModal } from '../task-list/TaskListSortModal';
import { AttachmentProgressIndicator } from '../../components/AttachmentProgressIndicator';
import { projectsScreenStyles as styles } from './projects-screen.styles';
import { getAndroidKeyboardFrame } from '../../lib/android-keyboard-frame';

const PROJECT_TASK_SORT_OPTIONS: TaskSortBy[] = ['default', 'due', 'start', 'review', 'title', 'created', 'created-desc'];

type ProjectDetailModalProps = {
    addProjectFileAttachment: () => void | Promise<void>;
    addSection: (projectId: string, title: string) => Promise<Section | null> | Section | null;
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
    deleteSection: (id: string) => Promise<unknown> | unknown;
    reorderSections: (projectId: string, orderedIds: string[]) => Promise<unknown> | unknown;
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
    onProjectTaskSortByChange: (sortBy: TaskSortBy) => void;
    onDownloadAttachment: (attachment: Attachment) => void | Promise<void>;
    onOpenAttachment: (attachment: Attachment) => void | Promise<void>;
    onOpenProjectQuickAdd: (project: Project) => void;
    overlayVisible: boolean;
    presentationStyle: 'pageSheet' | 'fullScreen';
    projectTaskSortBy: TaskSortBy;
    selectedProjectAreaName: string;
    selectedProject: Project | null;
    selectedProjectSections?: Section[];
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
    updateSection: (id: string, updates: Partial<Section>) => Promise<unknown> | unknown;
};

function ProjectSectionManagerModal({
    addSection,
    canManage,
    deleteSection,
    onClose,
    projectId,
    reorderSections,
    sections,
    t,
    tc,
    updateSection,
    visible,
}: {
    addSection: (projectId: string, title: string) => Promise<Section | null> | Section | null;
    canManage: boolean;
    deleteSection: (id: string) => Promise<unknown> | unknown;
    onClose: () => void;
    projectId: string;
    reorderSections: (projectId: string, orderedIds: string[]) => Promise<unknown> | unknown;
    sections: Section[];
    t: (key: string) => string;
    tc: ThemeColors;
    updateSection: (id: string, updates: Partial<Section>) => Promise<unknown> | unknown;
    visible: boolean;
}) {
    const filledButton = useFilledButtonColors();
    const [draft, setDraft] = React.useState('');
    const [editingSectionId, setEditingSectionId] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);
    const sectionTitle = tFallback(t, 'projects.sectionsLabel', 'Sections');
    const addSectionLabel = tFallback(t, 'projects.addSection', 'Add Section');
    const sectionPlaceholder = tFallback(t, 'projects.sectionPlaceholder', 'Section title');
    const saveLabel = tFallback(t, 'common.save', 'Save');
    const editLabel = tFallback(t, 'common.edit', 'Edit');
    const cancelLabel = tFallback(t, 'common.cancel', 'Cancel');
    const deleteLabel = tFallback(t, 'common.delete', 'Delete');
    const moveUpLabel = tFallback(t, 'projects.moveUp', 'Move up');
    const moveDownLabel = tFallback(t, 'projects.moveDown', 'Move down');
    const noneLabel = tFallback(t, 'common.none', 'None');
    const deleteConfirm = tFallback(
        t,
        'projects.deleteSectionConfirm',
        'Are you sure you want to delete this section?'
    );
    const sectionReorderFailed = tFallback(t, 'projects.sectionReorderFailed', 'Failed to reorder sections.');
    const editing = sections.find((section) => section.id === editingSectionId);
    const showEditor = canManage && editingSectionId !== null;

    React.useEffect(() => {
        if (visible) return;
        setDraft('');
        setEditingSectionId(null);
        setSaving(false);
    }, [visible]);

    const openCreate = React.useCallback(() => {
        setEditingSectionId('');
        setDraft('');
    }, []);

    const openEdit = React.useCallback((section: Section) => {
        setEditingSectionId(section.id);
        setDraft(section.title);
    }, []);

    const closeEditor = React.useCallback(() => {
        setEditingSectionId(null);
        setDraft('');
    }, []);

    const saveSection = React.useCallback(async () => {
        if (!canManage || saving) return;
        const title = draft.trim();
        if (!title) return;
        setSaving(true);
        try {
            if (editingSectionId) {
                await updateSection(editingSectionId, { title });
            } else {
                await addSection(projectId, title);
            }
            closeEditor();
        } finally {
            setSaving(false);
        }
    }, [addSection, canManage, closeEditor, draft, editingSectionId, projectId, saving, updateSection]);

    const confirmDeleteSection = React.useCallback((section: Section) => {
        if (!canManage) return;
        Alert.alert(
            sectionTitle,
            deleteConfirm,
            [
                { text: cancelLabel, style: 'cancel' },
                {
                    text: deleteLabel,
                    style: 'destructive',
                    onPress: () => {
                        void Promise.resolve(deleteSection(section.id));
                        if (editingSectionId === section.id) closeEditor();
                    },
                },
            ],
        );
    }, [canManage, cancelLabel, closeEditor, deleteConfirm, deleteLabel, deleteSection, editingSectionId, sectionTitle]);

    const moveSection = React.useCallback((sectionId: string, offset: -1 | 1) => {
        if (!canManage) return;
        const currentIndex = sections.findIndex((section) => section.id === sectionId);
        const nextIndex = currentIndex + offset;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sections.length) return;

        const nextIds = sections.map((section) => section.id);
        const [moved] = nextIds.splice(currentIndex, 1);
        if (!moved) return;
        nextIds.splice(nextIndex, 0, moved);

        void Promise.resolve(reorderSections(projectId, nextIds)).catch(() => {
            Alert.alert(sectionTitle, sectionReorderFailed);
        });
    }, [canManage, projectId, reorderSections, sectionReorderFailed, sectionTitle, sections]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View style={styles.overlay}>
                <View style={[styles.sectionManagerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                    <View style={styles.sectionManagerHeader}>
                        <Text style={[styles.sectionManagerTitle, { color: tc.text }]} accessibilityRole="header">
                            {sectionTitle}
                        </Text>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={cancelLabel}
                            onPress={onClose}
                            style={styles.sectionManagerCloseButton}
                        >
                            <Ionicons name="close" size={20} color={tc.secondaryText} />
                        </TouchableOpacity>
                    </View>

                    {canManage ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={addSectionLabel}
                            onPress={openCreate}
                            style={[styles.sectionManagerAddButton, { backgroundColor: filledButton.backgroundColor, borderColor: filledButton.backgroundColor }]}
                            testID="project-section-add-button"
                        >
                            <Ionicons name="add" size={16} color={filledButton.textColor ?? tc.onTint} />
                            <Text style={[styles.sectionManagerAddButtonText, { color: filledButton.textColor ?? tc.onTint }]} numberOfLines={1}>
                                {addSectionLabel}
                            </Text>
                        </TouchableOpacity>
                    ) : null}

                    {showEditor ? (
                        <View style={[styles.sectionEditor, { backgroundColor: tc.filterBg, borderColor: tc.border }]}>
                            <Text style={[styles.sectionEditorLabel, { color: tc.secondaryText }]}>
                                {editing ? sectionTitle : addSectionLabel}
                            </Text>
                            <TextInput
                                value={draft}
                                onChangeText={setDraft}
                                placeholder={sectionPlaceholder}
                                placeholderTextColor={tc.secondaryText}
                                style={[styles.sectionEditorInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
                                autoCapitalize="sentences"
                                returnKeyType="done"
                                onSubmitEditing={saveSection}
                                testID="project-section-title-input"
                            />
                            <View style={styles.sectionEditorActions}>
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={cancelLabel}
                                    onPress={closeEditor}
                                    style={[styles.smallButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                >
                                    <Text style={[styles.smallButtonText, { color: tc.secondaryText }]}>{cancelLabel}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={saveLabel}
                                    disabled={!draft.trim() || saving}
                                    onPress={saveSection}
                                    style={[
                                        styles.linkModalButton,
                                        { backgroundColor: filledButton.backgroundColor },
                                        (!draft.trim() || saving) && styles.linkModalButtonDisabled,
                                    ]}
                                    testID="project-section-save-button"
                                >
                                    <Text style={[styles.linkModalButtonText, { color: filledButton.textColor ?? tc.onTint }]}>{saveLabel}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : null}

                    {sections.length === 0 ? (
                        <View style={[styles.sectionManagerEmpty, { backgroundColor: tc.filterBg, borderColor: tc.border }]}>
                            <Text style={[styles.helperText, { color: tc.secondaryText }]}>{noneLabel}</Text>
                        </View>
                    ) : (
                        <ScrollView
                            style={[styles.sectionManagerList, { borderColor: tc.border, backgroundColor: tc.inputBg }]}
                            contentContainerStyle={styles.sectionManagerListContent}
                        >
                            {sections.map((section, index) => {
                                const canMoveUp = index > 0;
                                const canMoveDown = index < sections.length - 1;
                                return (
                                    <View
                                        key={section.id}
                                        style={[styles.sectionManagerRow, { borderBottomColor: tc.border }]}
                                        testID={`project-section-row-${section.id}`}
                                    >
                                        <View style={styles.sectionManagerRowTitleWrap}>
                                            <Text style={[styles.sectionManagerRowTitle, { color: tc.text }]} numberOfLines={1}>
                                                {section.title}
                                            </Text>
                                        </View>
                                        {canManage ? (
                                            <View style={styles.sectionManagerRowActions}>
                                                <View style={styles.sectionManagerOrderButtons}>
                                                    <TouchableOpacity
                                                        accessibilityRole="button"
                                                        accessibilityLabel={`${moveUpLabel}: ${section.title}`}
                                                        accessibilityState={{ disabled: !canMoveUp }}
                                                        disabled={!canMoveUp}
                                                        onPress={() => moveSection(section.id, -1)}
                                                        style={[
                                                            styles.sectionManagerIconButton,
                                                            { borderColor: tc.border, backgroundColor: tc.cardBg },
                                                            !canMoveUp && styles.sectionManagerIconButtonDisabled,
                                                        ]}
                                                        testID={`project-section-move-up-${section.id}`}
                                                    >
                                                        <Ionicons name="chevron-up" size={16} color={tc.secondaryText} />
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        accessibilityRole="button"
                                                        accessibilityLabel={`${moveDownLabel}: ${section.title}`}
                                                        accessibilityState={{ disabled: !canMoveDown }}
                                                        disabled={!canMoveDown}
                                                        onPress={() => moveSection(section.id, 1)}
                                                        style={[
                                                            styles.sectionManagerIconButton,
                                                            { borderColor: tc.border, backgroundColor: tc.cardBg },
                                                            !canMoveDown && styles.sectionManagerIconButtonDisabled,
                                                        ]}
                                                        testID={`project-section-move-down-${section.id}`}
                                                    >
                                                        <Ionicons name="chevron-down" size={16} color={tc.secondaryText} />
                                                    </TouchableOpacity>
                                                </View>
                                                <TouchableOpacity
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${editLabel}: ${section.title}`}
                                                    onPress={() => openEdit(section)}
                                                    style={[styles.smallButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                                    testID={`project-section-edit-${section.id}`}
                                                >
                                                    <Text style={[styles.smallButtonText, { color: tc.tint }]}>{editLabel}</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${deleteLabel}: ${section.title}`}
                                                    onPress={() => confirmDeleteSection(section)}
                                                    style={[styles.smallButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                                    testID={`project-section-delete-${section.id}`}
                                                >
                                                    <Text style={[styles.smallButtonText, { color: tc.danger }]}>{deleteLabel}</Text>
                                                </TouchableOpacity>
                                            </View>
                                        ) : null}
                                    </View>
                                );
                            })}
                        </ScrollView>
                    )}
                </View>
            </View>
        </Modal>
    );
}

function ProjectDetailScrollFrame({
    backgroundColor,
    children,
}: {
    backgroundColor: string;
    children: React.ReactNode;
}) {
    // The task list (normal mode) or the reorder DraggableFlatList owns the
    // scroll, so the frame is a plain flex column. The previous ScrollView +
    // manually windowed list positioned rows from height estimates, which made
    // the list shift as scrolls settled (#831).
    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'android' ? 'height' : undefined}
            keyboardVerticalOffset={0}
            style={[{ flex: 1 }, { backgroundColor }]}
        >
            <View style={[{ flex: 1 }, { backgroundColor }]}>
                {children}
            </View>
        </KeyboardAvoidingView>
    );
}

function ProjectOptionsModal({
    children,
    closeLabel,
    onClose,
    title,
    visible,
    tc,
}: {
    children: React.ReactNode;
    closeLabel: string;
    onClose: () => void;
    title: string;
    visible: boolean;
    tc: ThemeColors;
}) {
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View style={styles.overlay}>
                <View style={[styles.projectOptionsCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                    <View style={styles.projectOptionsHeader}>
                        <Text style={[styles.projectOptionsTitle, { color: tc.text }]} accessibilityRole="header">
                            {title}
                        </Text>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={closeLabel}
                            onPress={onClose}
                            style={styles.sectionManagerCloseButton}
                        >
                            <Ionicons name="close" size={20} color={tc.secondaryText} />
                        </TouchableOpacity>
                    </View>
                    <View style={[styles.projectOptionsList, { borderColor: tc.border }]}>
                        {children}
                    </View>
                </View>
            </View>
        </Modal>
    );
}

function ProjectOptionRow({
    description,
    icon,
    label,
    onPress,
    selected = false,
    testID,
    value,
    tc,
}: {
    description?: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    selected?: boolean;
    testID: string;
    value?: string;
    tc: ThemeColors;
}) {
    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={onPress}
            style={[styles.projectOptionsRow, { borderBottomColor: tc.border }]}
            testID={testID}
        >
            <View style={[styles.projectOptionsIcon, { backgroundColor: selected ? `${tc.tint}20` : tc.filterBg }]}>
                <Ionicons name={icon} size={19} color={selected ? tc.tint : tc.secondaryText} />
            </View>
            <View style={styles.projectOptionsCopy}>
                <Text style={[styles.projectOptionsRowLabel, { color: tc.text }]}>{label}</Text>
                {description ? (
                    <Text style={[styles.projectOptionsDescription, { color: tc.secondaryText }]}>
                        {description}
                    </Text>
                ) : null}
            </View>
            {value ? (
                <Text style={[styles.projectOptionsValue, { color: tc.secondaryText }]} numberOfLines={1}>
                    {value}
                </Text>
            ) : null}
            {selected ? <Ionicons name="checkmark" size={18} color={tc.tint} /> : null}
        </TouchableOpacity>
    );
}

export function ProjectDetailModal({
    addProjectFileAttachment,
    addSection,
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
    onOpenProjectQuickAdd,
    onOpenTagPicker,
    onRemoveProjectAttachment,
    deleteSection,
    reorderSections,
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
    selectedProjectSections = [],
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
    updateSection,
}: ProjectDetailModalProps) {
    const filledButton = useFilledButtonColors();
    const [projectTaskReorderMode, setProjectTaskReorderMode] = React.useState(false);
    const [projectTaskFilterOpenSignal, setProjectTaskFilterOpenSignal] = React.useState(0);
    const [projectTaskFilterActiveCount, setProjectTaskFilterActiveCount] = React.useState(0);
    const [projectSortModalVisible, setProjectSortModalVisible] = React.useState(false);
    const [projectViewOptionsVisible, setProjectViewOptionsVisible] = React.useState(false);
    const [projectActionsVisible, setProjectActionsVisible] = React.useState(false);
    const [projectTaskBulkBarProps, setProjectTaskBulkBarProps] = React.useState<TaskListBulkBarProps | null>(null);
    const [sectionManagerVisible, setSectionManagerVisible] = React.useState(false);
    const projectDetailListRef = React.useRef<FlatList | null>(null);
    const projectDetailScrollOffsetRef = React.useRef(0);
    const pendingProjectDetailScrollRestoreRef = React.useRef<number | null>(null);
    const projectTaskBulkBarPropsRef = React.useRef<TaskListBulkBarProps | null>(null);
    const projectDetailKeyboardTopRef = React.useRef(Dimensions.get('window').height);
    const projectDetailKeyboardVisibleRef = React.useRef(false);
    const projectDetailFocusedInputHandleRef = React.useRef<number | null>(null);
    const [projectDetailKeyboardBottomInset, setProjectDetailKeyboardBottomInset] = React.useState(0);
    const safeAreaEdges = getProjectDetailModalSafeAreaEdges(presentationStyle);
    const taskListOptions = getProjectDetailTaskListOptions(selectedProject, showCompletedTasks);
    const canManageProjectSections = selectedProject?.status !== 'archived';
    // Reorder mode always renders one self-scrolling DraggableFlatList (section
    // headers are fixed rows inside it), so it owns the scroll for every project.
    const projectReorderOwnsScroll = projectTaskReorderMode;
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
    const projectSectionsLabel = tFallback(t, 'projects.sectionsLabel', 'Sections');
    const addProjectTaskLabel = tFallback(t, 'nav.addTask', 'Add task');
    const projectOrderLabel = tFallback(t, 'projects.reorderTasks', 'Order');
    const moreOptionsLabel = tFallback(t, 'taskEdit.moreOptions', 'More options');
    const closeLabel = tFallback(t, 'common.close', 'Close');
    const hasProjectTaskOrderTargets = Boolean(
        selectedProjectSections.length > 1
        || (selectedProjectTasks ?? []).some((task) => (
            !task.deletedAt && (taskListOptions.includeDone || task.status !== 'done')
        ))
    );
    const openProjectQuickAdd = React.useCallback(() => {
        if (!selectedProject || !taskListOptions.allowAdd) return;
        onOpenProjectQuickAdd(selectedProject);
    }, [onOpenProjectQuickAdd, selectedProject, taskListOptions.allowAdd]);
    const openProjectTaskFilters = React.useCallback(() => {
        setProjectTaskFilterOpenSignal((value) => value + 1);
    }, []);
    const handleProjectFilterStateChange = React.useCallback(
        ({ activeCount }: { activeCount: number; hasActive: boolean }) => {
            setProjectTaskFilterActiveCount(activeCount);
        },
        []
    );
    const handleProjectBulkBarPropsChange = React.useCallback((props: TaskListBulkBarProps | null) => {
        const hadBulkBar = projectTaskBulkBarPropsRef.current !== null;
        const hasBulkBar = props !== null;
        if (hadBulkBar !== hasBulkBar && projectDetailScrollOffsetRef.current > 0) {
            pendingProjectDetailScrollRestoreRef.current = projectDetailScrollOffsetRef.current;
        }
        projectTaskBulkBarPropsRef.current = props;
        setProjectTaskBulkBarProps(props);
    }, []);
    const handleProjectListScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        projectDetailScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
    }, []);
    const openProjectTaskSort = React.useCallback(() => {
        setProjectSortModalVisible(true);
    }, []);
    const handleProjectTaskSortSelect = React.useCallback((option: TaskSortBy) => {
        setProjectSortModalVisible(false);
        onProjectTaskSortByChange(option);
    }, [onProjectTaskSortByChange]);
    const toggleProjectTaskReorderMode = React.useCallback(() => {
        setProjectTaskReorderMode((value) => !value);
    }, []);
    const filterButtonLabel = tFallback(t, 'filters.label', 'Filters');
    const doneButtonLabel = tFallback(t, 'common.done', 'Done');
    const projectTypeLabel = tFallback(t, 'projects.projectTypeLabel', 'Type');
    const projectActionsLabel = tFallback(t, 'projects.actionsLabel', 'Actions');
    const projectActionsHelpText = tFallback(
        t,
        'projects.archiveHelp',
        'Completing a project files it in Archived — reactivate it anytime.'
    );
    const projectStatusLabel = selectedProject
        ? (selectedProject.status === 'active'
            ? t('status.active')
            : selectedProject.status === 'waiting'
                ? t('status.waiting')
                : selectedProject.status === 'someday'
                    ? t('status.someday')
                    : tFallback(t, 'status.archived', 'Archived'))
        : '';
    const projectTypeValueLabel = selectedProject?.isSequential
        ? tFallback(t, 'projects.sequential', 'Sequential')
        : tFallback(t, 'projects.parallel', 'Parallel');
    const noAreaLabel = tFallback(t, 'projects.noArea', 'No Area');
    const projectDetailsSummary = [
        projectStatusLabel,
        projectTypeValueLabel,
        selectedProjectAreaName && selectedProjectAreaName !== noAreaLabel ? selectedProjectAreaName : '',
        selectedProjectSections.length > 0 ? `${selectedProjectSections.length} ${projectSectionsLabel}` : '',
    ].filter(Boolean).join(' · ');
    const sortIsActive = projectTaskSortBy !== 'default';
    const projectViewOptionsActive = sortIsActive || showCompletedTasks || projectTaskReorderMode;
    const projectTaskPinnedToolbar = selectedProject ? (
        <View style={[styles.projectTaskPinnedToolbar, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]}>
            <TouchableOpacity
                accessibilityLabel={projectTaskFilterActiveCount > 0 ? `${filterButtonLabel}: ${projectTaskFilterActiveCount}` : filterButtonLabel}
                accessibilityRole="button"
                onPress={openProjectTaskFilters}
                hitSlop={8}
                style={[
                    styles.projectTaskPinnedControl,
                    {
                        backgroundColor: projectTaskFilterActiveCount > 0 ? `${tc.tint}20` : tc.filterBg,
                        borderColor: projectTaskFilterActiveCount > 0 ? tc.tint : tc.border,
                    },
                ]}
                testID="project-task-filter-button"
            >
                <View style={styles.projectTaskPinnedControlIcon}>
                    <Ionicons
                        name="filter-outline"
                        size={20}
                        color={projectTaskFilterActiveCount > 0 ? tc.tint : tc.secondaryText}
                    />
                    {projectTaskFilterActiveCount > 0 ? (
                        <View style={[styles.projectTaskPinnedBadge, { backgroundColor: tc.tint }]}>
                            <Text style={[styles.projectTaskPinnedBadgeText, { color: tc.onTint }]}>
                                {projectTaskFilterActiveCount}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </TouchableOpacity>
            <TouchableOpacity
                accessibilityLabel={moreOptionsLabel}
                accessibilityRole="button"
                accessibilityState={{ expanded: projectViewOptionsVisible, selected: projectViewOptionsActive }}
                onPress={() => setProjectViewOptionsVisible(true)}
                hitSlop={8}
                style={[
                    styles.projectTaskPinnedControl,
                    {
                        backgroundColor: projectViewOptionsActive ? `${tc.tint}20` : tc.filterBg,
                        borderColor: projectViewOptionsActive ? tc.tint : tc.border,
                    },
                ]}
                testID="project-task-view-options-button"
            >
                <View style={styles.projectTaskPinnedControlIcon}>
                    <Ionicons
                        name="ellipsis-horizontal"
                        size={20}
                        color={projectViewOptionsActive ? tc.tint : tc.secondaryText}
                    />
                </View>
            </TouchableOpacity>
            <View style={styles.projectTaskPinnedSpacer} />
            {taskListOptions.allowAdd ? (
                <TouchableOpacity
                    accessibilityLabel={addProjectTaskLabel}
                    accessibilityRole="button"
                    onPress={openProjectQuickAdd}
                    hitSlop={8}
                    style={[
                        styles.projectTaskPinnedAddButton,
                        { backgroundColor: filledButton.backgroundColor, borderColor: filledButton.backgroundColor },
                    ]}
                    testID="project-add-task-button"
                >
                    <Ionicons name="add" size={24} color={filledButton.textColor ?? tc.onTint} />
                </TouchableOpacity>
            ) : null}
        </View>
    ) : null;
    const projectTaskSelectionBulkBar = projectTaskBulkBarProps ? (
        <View testID="project-task-selection-bulk-bar">
            <TaskListBulkBar {...projectTaskBulkBarProps} />
        </View>
    ) : null;
    const setSelectedProjectSequentialScope = (sequentialScope: Project['sequentialScope']) => {
        if (!selectedProject) return;
        updateProject(selectedProject.id, { sequentialScope });
        onSetSelectedProject({ ...selectedProject, sequentialScope });
    };

    const restoreProjectDetailScrollOffset = React.useCallback((offsetY: number) => {
        if (!Number.isFinite(offsetY) || offsetY <= 0) return;
        const scrollToOffset = () => {
            projectDetailListRef.current?.scrollToOffset({ offset: offsetY, animated: false });
        };
        scrollToOffset();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(scrollToOffset);
        }
        // A freshly mounted list clamps the jump until enough rows render, and
        // each clamped jump renders more — keep retrying briefly, stopping as
        // soon as the list reaches (or the user scrolls past) the target.
        let attempts = 0;
        const retry = () => {
            if (projectDetailScrollOffsetRef.current >= offsetY - 1) return;
            scrollToOffset();
            attempts += 1;
            if (attempts < 5) setTimeout(retry, 250);
        };
        setTimeout(retry, 250);
    }, []);

    // Exiting reorder mode swaps the reorder list back to the task FlatList,
    // which mounts at offset 0 (#784). Queue a restore so the list comes back
    // at the position the user left it.
    const prevProjectReorderOwnsScrollRef = React.useRef(projectReorderOwnsScroll);
    React.useLayoutEffect(() => {
        const wasReordering = prevProjectReorderOwnsScrollRef.current;
        prevProjectReorderOwnsScrollRef.current = projectReorderOwnsScroll;
        if (wasReordering && !projectReorderOwnsScroll && projectDetailScrollOffsetRef.current > 0) {
            pendingProjectDetailScrollRestoreRef.current = projectDetailScrollOffsetRef.current;
        }
    }, [projectReorderOwnsScroll]);

    React.useLayoutEffect(() => {
        const offsetY = pendingProjectDetailScrollRestoreRef.current;
        if (offsetY === null) return;
        pendingProjectDetailScrollRestoreRef.current = null;
        if (projectReorderOwnsScroll) return;
        restoreProjectDetailScrollOffset(offsetY);
    }, [projectReorderOwnsScroll, projectTaskBulkBarProps, restoreProjectDetailScrollOffset]);

    const resetProjectDetailScroll = React.useCallback(() => {
        projectDetailScrollOffsetRef.current = 0;
        pendingProjectDetailScrollRestoreRef.current = null;
        projectDetailListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, []);

    React.useEffect(() => {
        resetProjectDetailScroll();
    }, [resetProjectDetailScroll, selectedProject?.id]);

    React.useEffect(() => {
        setProjectTaskReorderMode(false);
        setSectionManagerVisible(false);
        setProjectViewOptionsVisible(false);
        setProjectActionsVisible(false);
    }, [overlayVisible, selectedProject?.id]);

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
        const listView = projectDetailListRef.current;
        if (!listView) return;
        const scrollHandle = findNodeHandle(listView);
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
                    projectDetailListRef.current?.scrollToOffset({ offset: nextOffset, animated: true });
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
    }, [scrollProjectInputIntoView]);

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

    // Scrolls away with the task rows as the list's ListHeaderComponent in
    // normal mode; stays pinned above the self-scrolling reorder list in reorder mode.
    const projectDetailListHeader = selectedProject ? (
        <>
                                <TouchableOpacity
                                    style={[styles.detailsToggle, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                                    onPress={() => onSetShowProjectMeta((prev) => !prev)}
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded: showProjectMeta }}
                                    testID="project-details-toggle"
                                >
                                    <View style={styles.detailsToggleHeading}>
                                        <Ionicons
                                            name={showProjectMeta ? 'chevron-down' : 'chevron-forward'}
                                            size={16}
                                            color={tc.secondaryText}
                                        />
                                        <Text style={[styles.detailsToggleText, { color: tc.text }]}>
                                            {t('taskEdit.details')}
                                        </Text>
                                    </View>
                                    {!showProjectMeta ? (
                                        <Text
                                            style={[styles.detailsSummaryText, { color: tc.secondaryText }]}
                                            numberOfLines={1}
                                            testID="project-details-summary"
                                        >
                                            {projectDetailsSummary}
                                        </Text>
                                    ) : null}
                                </TouchableOpacity>

                                {showProjectMeta && (
                                    <>
                                        <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <View style={styles.reviewLabelRow}>
                                                <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('projects.statusLabel')}</Text>
                                                <TouchableOpacity
                                                    onPress={() => onSetShowStatusMenu((prev) => !prev)}
                                                    style={[
                                                        styles.statusPicker,
                                                        {
                                                            backgroundColor: statusPalette[selectedProject.status]?.bg ?? tc.filterBg,
                                                            borderColor: statusPalette[selectedProject.status]?.border ?? tc.border,
                                                        },
                                                    ]}
                                                    testID="project-status-picker"
                                                >
                                                    <Text style={[styles.statusPickerText, { color: statusPalette[selectedProject.status]?.text ?? tc.text }]}>
                                                        {projectStatusLabel}
                                                    </Text>
                                                    <Text style={[styles.statusPickerText, { color: statusPalette[selectedProject.status]?.text ?? tc.text }]}>▾</Text>
                                                </TouchableOpacity>
                                            </View>
                                            {showStatusMenu && (
                                                <View style={[styles.statusMenu, { backgroundColor: tc.inputBg, borderColor: tc.border, marginHorizontal: 0, marginTop: 8, marginBottom: 0 }]}>
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

                                            <View style={[styles.reviewLabelRow, styles.projectSettingsRowSpacing]}>
                                                <Text style={[styles.reviewLabel, { color: tc.text }]}>{projectTypeLabel}</Text>
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
                                                        testID="project-type-toggle"
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.sequentialToggleText,
                                                                { color: selectedProject.isSequential ? tc.onTint : tc.secondaryText },
                                                            ]}
                                                        >
                                                            {selectedProject.isSequential
                                                                ? tFallback(t, 'projects.sequential', 'Sequential')
                                                                : tFallback(t, 'projects.parallel', 'Parallel')}
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
                                        </View>

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
                                            <View style={styles.reviewLabelRow}>
                                                <Text style={[styles.reviewLabel, { color: tc.text }]}>{projectSectionsLabel}</Text>
                                                {(canManageProjectSections || selectedProjectSections.length > 0) ? (
                                                    <TouchableOpacity
                                                        accessibilityRole="button"
                                                        accessibilityLabel={selectedProjectSections.length > 0
                                                            ? tFallback(t, 'settings.manage', 'Manage')
                                                            : tFallback(t, 'projects.addSection', 'Add Section')}
                                                        onPress={() => setSectionManagerVisible(true)}
                                                        style={[styles.smallButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                                        testID="project-sections-button"
                                                    >
                                                        <Text style={[styles.smallButtonText, { color: tc.tint }]}>
                                                            {selectedProjectSections.length > 0
                                                                ? tFallback(t, 'settings.manage', 'Manage')
                                                                : tFallback(t, 'projects.addSection', 'Add Section')}
                                                        </Text>
                                                    </TouchableOpacity>
                                                ) : null}
                                            </View>
                                            {selectedProjectSections.length > 0 ? (
                                                <View style={styles.projectSectionPillRow}>
                                                    {selectedProjectSections.map((section) => (
                                                        <View
                                                            key={section.id}
                                                            style={[styles.projectSectionPill, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                        >
                                                            <Text style={[styles.projectSectionPillText, { color: tc.text }]} numberOfLines={1}>
                                                                {section.title}
                                                            </Text>
                                                        </View>
                                                    ))}
                                                </View>
                                            ) : null}
                                        </View>

                                        <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <View style={styles.projectMetadataRow}>
                                                <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('projects.areaLabel')}</Text>
                                                <TouchableOpacity
                                                    style={[styles.projectMetadataValueButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                    onPress={onOpenAreaPicker}
                                                >
                                                    <Text style={[styles.projectMetadataValueText, { color: tc.text }]} numberOfLines={1}>
                                                        {selectedProjectAreaName}
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                            <View style={[styles.projectMetadataRow, styles.projectMetadataRowDivider, { borderTopColor: tc.border }]}>
                                                <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('taskEdit.tagsLabel')}</Text>
                                                <TouchableOpacity
                                                    style={[styles.projectMetadataValueButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                    onPress={onOpenTagPicker}
                                                >
                                                    <Text style={[styles.projectMetadataValueText, { color: tc.text }]} numberOfLines={1}>
                                                        {selectedProject.tagIds?.length ? selectedProject.tagIds.join(', ') : t('common.none')}
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
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
                                            {((selectedProject.attachments || []) as Attachment[]).filter((attachment) => !attachment.deletedAt).length > 0 ? (
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
                                            ) : null}
                                        </View>

                                        <View style={[styles.reviewContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                                            <View style={styles.projectMetadataRow}>
                                                <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('taskEdit.dueDateLabel') || 'Due Date'}</Text>
                                                <View style={styles.projectMetadataControls}>
                                                    <TouchableOpacity
                                                        style={[styles.projectMetadataValueButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                        onPress={() => onSetShowDueDatePicker(true)}
                                                    >
                                                        <Text style={[styles.projectMetadataValueText, { color: tc.text }]} numberOfLines={1}>
                                                            {formatProjectDate(selectedProject.dueDate, t('common.notSet'))}
                                                        </Text>
                                                    </TouchableOpacity>
                                                    {!!selectedProject.dueDate ? (
                                                        <TouchableOpacity
                                                            accessibilityRole="button"
                                                            accessibilityLabel={`${t('common.clear')} ${t('taskEdit.dueDateLabel') || 'Due Date'}`}
                                                            style={styles.projectMetadataClearButton}
                                                            onPress={() => {
                                                                updateProject(selectedProject.id, { dueDate: undefined });
                                                                onSetSelectedProject({ ...selectedProject, dueDate: undefined });
                                                            }}
                                                        >
                                                            <Ionicons name="close-circle-outline" size={19} color={tc.secondaryText} />
                                                        </TouchableOpacity>
                                                    ) : null}
                                                </View>
                                            </View>
                                            {showDueDatePicker ? (
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
                                            ) : null}
                                            <View style={[styles.projectMetadataRow, styles.projectMetadataRowDivider, { borderTopColor: tc.border }]}>
                                                <Text style={[styles.reviewLabel, { color: tc.text }]}>{t('projects.reviewAt') || 'Review Date'}</Text>
                                                <View style={styles.projectMetadataControls}>
                                                    <TouchableOpacity
                                                        style={[styles.projectMetadataValueButton, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
                                                        onPress={() => onSetShowReviewPicker(true)}
                                                    >
                                                        <Text style={[styles.projectMetadataValueText, { color: tc.text }]} numberOfLines={1}>
                                                            {formatProjectDate(selectedProject.reviewAt, t('common.notSet'))}
                                                        </Text>
                                                    </TouchableOpacity>
                                                    {!!selectedProject.reviewAt ? (
                                                        <TouchableOpacity
                                                            accessibilityRole="button"
                                                            accessibilityLabel={`${t('common.clear')} ${t('projects.reviewAt') || 'Review Date'}`}
                                                            style={styles.projectMetadataClearButton}
                                                            onPress={() => {
                                                                updateProject(selectedProject.id, { reviewAt: undefined });
                                                                onSetSelectedProject({ ...selectedProject, reviewAt: undefined });
                                                            }}
                                                        >
                                                            <Ionicons name="close-circle-outline" size={19} color={tc.secondaryText} />
                                                        </TouchableOpacity>
                                                    ) : null}
                                                </View>
                                            </View>
                                            {showReviewPicker ? (
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
                                            ) : null}
                                        </View>
                                    </>
                                )}
        </>
    ) : null;

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
                                        accessibilityRole="button"
                                        accessibilityLabel={t('common.back') || 'Back'}
                                    >
                                        <Ionicons name="chevron-back" size={24} color={tc.tint} />
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
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={projectActionsLabel}
                                        accessibilityState={{ expanded: projectActionsVisible }}
                                        onPress={() => setProjectActionsVisible(true)}
                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                        style={[styles.projectHeaderActionButton, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                                        testID="project-actions-menu-button"
                                    >
                                        <Ionicons name="ellipsis-horizontal" size={20} color={tc.secondaryText} />
                                    </TouchableOpacity>
                                </View>
                                {projectTaskPinnedToolbar}
                                {projectTaskSelectionBulkBar}
                                <ProjectDetailScrollFrame backgroundColor={tc.bg}>
                                {projectTaskReorderMode ? projectDetailListHeader : null}

                                <View style={styles.projectReorderListFill}>
                                    <TaskList
                                        statusFilter="all"
                                        title={selectedProject.title}
                                        showHeader={false}
                                        showFilterButton={false}
                                        onFilterStateChange={handleProjectFilterStateChange}
                                        showTimeEstimateFilters={false}
                                        projectId={selectedProject.id}
                                        taskSource={selectedProjectTasks}
                                        allowAdd={false}
                                        bulkBarPlacement="external"
                                        listHeaderComponent={projectTaskReorderMode ? null : projectDetailListHeader}
                                        listRef={projectDetailListRef}
                                        onListScroll={handleProjectListScroll}
                                        contentPaddingBottom={projectDetailKeyboardBottomInset > 0 ? projectDetailKeyboardBottomInset + 12 : 12}
                                        enableBulkActions
                                        enableProjectBulkOrganize={taskListOptions.allowAdd}
                                        onBulkBarPropsChange={handleProjectBulkBarPropsChange}
                                        externalFilterOpenSignal={projectTaskFilterOpenSignal}
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
                                <TaskListSortModal
                                    onClose={() => setProjectSortModalVisible(false)}
                                    onSelect={handleProjectTaskSortSelect}
                                    sortBy={projectTaskSortBy}
                                    sortOptions={PROJECT_TASK_SORT_OPTIONS}
                                    t={t}
                                    themeColors={tc}
                                    visible={projectSortModalVisible}
                                />
                                <ProjectOptionsModal
                                    closeLabel={closeLabel}
                                    onClose={() => setProjectViewOptionsVisible(false)}
                                    title={moreOptionsLabel}
                                    visible={projectViewOptionsVisible}
                                    tc={tc}
                                >
                                    <ProjectOptionRow
                                        icon="swap-vertical-outline"
                                        label={sortLabel}
                                        onPress={() => {
                                            setProjectViewOptionsVisible(false);
                                            openProjectTaskSort();
                                        }}
                                        selected={sortIsActive}
                                        testID="project-view-sort-option"
                                        value={t(`sort.${projectTaskSortBy}`)}
                                        tc={tc}
                                    />
                                    {selectedProject.status !== 'archived' ? (
                                        <ProjectOptionRow
                                            icon={showCompletedTasks ? 'eye-outline' : 'eye-off-outline'}
                                            label={showCompletedLabel}
                                            onPress={() => {
                                                setProjectViewOptionsVisible(false);
                                                onToggleShowCompletedTasks();
                                            }}
                                            selected={showCompletedTasks}
                                            testID="project-view-completed-option"
                                            tc={tc}
                                        />
                                    ) : null}
                                    {taskListOptions.enableProjectReorder && hasProjectTaskOrderTargets && !sortIsActive ? (
                                        <ProjectOptionRow
                                            icon={projectTaskReorderMode ? 'checkmark-circle-outline' : 'list-outline'}
                                            label={projectTaskReorderMode ? doneButtonLabel : projectOrderLabel}
                                            onPress={() => {
                                                setProjectViewOptionsVisible(false);
                                                toggleProjectTaskReorderMode();
                                            }}
                                            selected={projectTaskReorderMode}
                                            testID="project-view-reorder-option"
                                            tc={tc}
                                        />
                                    ) : null}
                                </ProjectOptionsModal>
                                <ProjectOptionsModal
                                    closeLabel={closeLabel}
                                    onClose={() => setProjectActionsVisible(false)}
                                    title={projectActionsLabel}
                                    visible={projectActionsVisible}
                                    tc={tc}
                                >
                                    <ProjectOptionRow
                                        icon="copy-outline"
                                        label={t('projects.duplicate')}
                                        onPress={() => {
                                            setProjectActionsVisible(false);
                                            onDuplicateProject(selectedProject.id);
                                        }}
                                        testID="project-duplicate-button"
                                        tc={tc}
                                    />
                                    <ProjectOptionRow
                                        description={selectedProject.status === 'archived' ? undefined : projectActionsHelpText}
                                        icon={selectedProject.status === 'archived' ? 'refresh-outline' : 'archive-outline'}
                                        label={selectedProject.status === 'archived' ? t('projects.reactivate') : t('projects.archive')}
                                        onPress={() => {
                                            setProjectActionsVisible(false);
                                            if (selectedProject.status === 'archived') {
                                                handleSetProjectStatus('active');
                                            } else {
                                                handleArchiveSelectedProject();
                                            }
                                        }}
                                        testID={selectedProject.status === 'archived'
                                            ? 'project-reactivate-button'
                                            : 'project-archive-button'}
                                        tc={tc}
                                    />
                                </ProjectOptionsModal>
                                <ProjectSectionManagerModal
                                    addSection={addSection}
                                    canManage={canManageProjectSections}
                                    deleteSection={deleteSection}
                                    onClose={() => setSectionManagerVisible(false)}
                                    projectId={selectedProject.id}
                                    reorderSections={reorderSections}
                                    sections={selectedProjectSections}
                                    t={t}
                                    tc={tc}
                                    updateSection={updateSection}
                                    visible={sectionManagerVisible}
                                />
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
                <ToastViewport />
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
