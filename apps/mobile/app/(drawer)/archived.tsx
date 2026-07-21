import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { getInlineMarkdownPreview, projectMatchesAreaFilter, safeFormatDate, shallow, taskMatchesAreaFilter, tFallback, useTaskStore } from '@mindwtr/core';
import type { Project, Task } from '@mindwtr/core';
import { MarkdownInlineText } from '@/components/markdown-text';
import { useLanguage } from '../../contexts/language-context';

import { useMobileAreaFilter } from '@/hooks/use-mobile-area-filter';
import { useThemeColors } from '@/hooks/use-theme-colors';
import type { ThemeColors } from '@/hooks/use-theme-colors';
import { openContextsScreen, openProjectScreen } from '@/lib/task-meta-navigation';
import { TaskEditModal } from '@/components/task-edit-modal';
import { CompletedAtPicker } from '@/components/completed-at-picker';
import { assertBulkActionSucceeded, useTaskListSelection } from '@/components/use-task-list-selection';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Archive } from 'lucide-react-native';

function ArchivedTaskItem({
    task,
    tc,
    onOpen,
    onRestore,
    onDelete,
    onEditCompletedAt,
    onToggleSelect,
    completedLabel,
    editCompletedAtLabel,
    selectLabel,
    restoreLabel,
    deleteLabel,
    selectionMode,
    isSelected,
    isHighlighted,
}: {
    task: Task;
    tc: ThemeColors;
    onOpen: () => void;
    onRestore: () => void;
    onDelete: () => void;
    onEditCompletedAt: () => void;
    onToggleSelect: () => void;
    completedLabel: string;
    editCompletedAtLabel: string;
    selectLabel: string;
    restoreLabel: string;
    deleteLabel: string;
    selectionMode: boolean;
    isSelected: boolean;
    isHighlighted?: boolean;
}) {
    const swipeableRef = useRef<Swipeable>(null);
    const completionTimestamp = task.completedAt || task.updatedAt;
    const completionDateLabel = completionTimestamp
        ? safeFormatDate(completionTimestamp, 'Pp', completionTimestamp)
        : 'Unknown';

    const renderLeftActions = () => (
        <Pressable
            style={styles.swipeActionRestore}
            onPress={() => {
                swipeableRef.current?.close();
                onRestore();
            }}
        >
            <Text style={styles.swipeActionText}>↩️ {restoreLabel}</Text>
        </Pressable>
    );

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeActionDelete}
            onPress={() => {
                swipeableRef.current?.close();
                onDelete();
            }}
        >
            <Text style={styles.swipeActionText}>🗑️ {deleteLabel}</Text>
        </Pressable>
    );

    return (
        <Swipeable
            ref={swipeableRef}
            renderLeftActions={selectionMode ? undefined : renderLeftActions}
            renderRightActions={selectionMode ? undefined : renderRightActions}
            overshootLeft={false}
            overshootRight={false}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={selectionMode ? `${selectLabel} ${task.title}` : `Open archived task details: ${task.title}`}
                accessibilityState={selectionMode ? { selected: isSelected } : undefined}
                onPress={selectionMode ? onToggleSelect : onOpen}
                style={({ pressed }) => [
                    styles.taskItem,
                    { backgroundColor: tc.taskItemBg, borderColor: tc.border },
                    pressed && styles.taskItemPressed,
                    isHighlighted && !selectionMode && { borderWidth: 2, borderColor: tc.tint },
                    selectionMode && isSelected && { borderWidth: 2, borderColor: tc.tint },
                ]}
            >
                {selectionMode && (
                    <View
                        style={[
                            styles.selectionIndicator,
                            { borderColor: tc.tint, backgroundColor: isSelected ? tc.tint : 'transparent' },
                        ]}
                    >
                        {isSelected && <Text style={[styles.selectionMark, { color: tc.onTint }]}>✓</Text>}
                    </View>
                )}
                <View style={styles.taskContent}>
                    <Text style={[styles.taskTitle, { color: tc.secondaryText }]} numberOfLines={2}>
                        {task.title}
                    </Text>
                    {task.description && (
                        <MarkdownInlineText
                            markdown={getInlineMarkdownPreview(task.description)}
                            tc={tc}
                            style={[styles.taskDescription, { color: tc.secondaryText }]}
                            numberOfLines={1}
                        />
                    )}
                    <Pressable
                        disabled={selectionMode}
                        onPress={(event) => {
                            event.stopPropagation();
                            onEditCompletedAt();
                        }}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={editCompletedAtLabel}
                        style={styles.archivedDateButton}
                    >
                        <Text style={[styles.archivedDate, { color: tc.secondaryText }]}>
                            {completedLabel}: {completionDateLabel}
                        </Text>
                    </Pressable>
                </View>
                <View style={[styles.statusIndicator, { backgroundColor: '#6B7280' }]} />
            </Pressable>
        </Swipeable>
    );
}

type ArchiveSegment = 'tasks' | 'projects';

function ArchivedProjectItem({
    project,
    tc,
    areaName,
    onOpen,
    onRestore,
    onDelete,
    completedLabel,
    restoreLabel,
    deleteLabel,
}: {
    project: Project;
    tc: ThemeColors;
    areaName?: string;
    onOpen: () => void;
    onRestore: () => void;
    onDelete: () => void;
    completedLabel: string;
    restoreLabel: string;
    deleteLabel: string;
}) {
    const swipeableRef = useRef<Swipeable>(null);
    const archivedDateLabel = project.updatedAt
        ? safeFormatDate(project.updatedAt, 'Pp', project.updatedAt)
        : 'Unknown';

    const renderLeftActions = () => (
        <Pressable
            style={styles.swipeActionRestore}
            onPress={() => {
                swipeableRef.current?.close();
                onRestore();
            }}
        >
            <Text style={styles.swipeActionText}>↩️ {restoreLabel}</Text>
        </Pressable>
    );

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeActionDelete}
            onPress={() => {
                swipeableRef.current?.close();
                onDelete();
            }}
        >
            <Text style={styles.swipeActionText}>🗑️ {deleteLabel}</Text>
        </Pressable>
    );

    return (
        <Swipeable
            ref={swipeableRef}
            renderLeftActions={renderLeftActions}
            renderRightActions={renderRightActions}
            overshootLeft={false}
            overshootRight={false}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open archived project: ${project.title}`}
                onPress={onOpen}
                style={({ pressed }) => [
                    styles.taskItem,
                    { backgroundColor: tc.taskItemBg, borderColor: tc.border },
                    pressed && styles.taskItemPressed,
                ]}
            >
                <View style={styles.taskContent}>
                    <Text style={[styles.taskTitle, { color: tc.secondaryText }]} numberOfLines={2}>
                        {project.title}
                    </Text>
                    <Text style={[styles.archivedDate, { color: tc.secondaryText }]}>
                        {completedLabel}: {archivedDateLabel}
                    </Text>
                    {areaName ? (
                        <Text style={[styles.archivedDate, { color: tc.secondaryText }]}>{areaName}</Text>
                    ) : null}
                </View>
                <View style={[styles.statusIndicator, { backgroundColor: project.color || '#6B7280' }]} />
            </Pressable>
        </Swipeable>
    );
}

export default function ArchivedScreen() {
    const {
        _allTasks,
        projects,
        updateTask,
        deleteTask,
        updateProject,
        deleteProject,
        restoreTask,
        batchMoveTasks,
        batchDeleteTasks,
        batchUpdateTasks,
        highlightTaskId,
        setHighlightTask,
    } = useTaskStore((state) => ({
        _allTasks: state._allTasks,
        projects: state.projects,
        updateTask: state.updateTask,
        deleteTask: state.deleteTask,
        updateProject: state.updateProject,
        deleteProject: state.deleteProject,
        restoreTask: state.restoreTask,
        batchMoveTasks: state.batchMoveTasks,
        batchDeleteTasks: state.batchDeleteTasks,
        batchUpdateTasks: state.batchUpdateTasks,
        highlightTaskId: state.highlightTaskId,
        setHighlightTask: state.setHighlightTask,
    }), shallow);
    const { t } = useLanguage();
    const [segment, setSegment] = useState<ArchiveSegment>('tasks');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    const tc = useThemeColors();
    const { areaById, resolvedAreaFilter } = useMobileAreaFilter();
    const projectById = useMemo(
        () => new Map(projects.map((project) => [project.id, project])),
        [projects],
    );

    const archivedTasks = useMemo(
        () => _allTasks.filter((task) => (
            task.status === 'archived'
            && !task.deletedAt
            && taskMatchesAreaFilter(task, resolvedAreaFilter, projectById, areaById)
        )),
        [_allTasks, resolvedAreaFilter, projectById, areaById],
    );
    const archivedProjects = useMemo(
        () => projects
            .filter((project) => (
                project.status === 'archived'
                && projectMatchesAreaFilter(project, resolvedAreaFilter, areaById)
            ))
            .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
        [projects, resolvedAreaFilter, areaById],
    );
    const selectedTask = useMemo(
        () => selectedTaskId ? _allTasks.find((task) => task.id === selectedTaskId && !task.deletedAt) ?? null : null,
        [_allTasks, selectedTaskId],
    );
    const tasksById = useMemo(
        () => archivedTasks.reduce((acc, task) => {
            acc[task.id] = task;
            return acc;
        }, {} as Record<string, Task>),
        [archivedTasks],
    );
    const restoreActionLabel = tFallback(t, 'trash.restoreToInbox', 'Restore');
    const {
        exitSelectionMode,
        handleBatchDelete,
        multiSelectedIds,
        runBulkAction,
        selectedIdsArray,
        selectionMode,
        setMultiSelectedIds,
        setSelectionMode,
        toggleMultiSelect,
    } = useTaskListSelection({
        batchDeleteTasks,
        batchMoveTasks,
        batchUpdateTasks,
        restoreActionLabel,
        restoreTask,
        t,
        tasksById,
    });
    const selectedIds = multiSelectedIds;
    const listExtraData = useMemo(
        () => ({ highlightTaskId, selectedIds, selectionMode }),
        [highlightTaskId, selectedIds, selectionMode],
    );

    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!highlightTaskId) return;
        if (highlightTimerRef.current) {
            clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = setTimeout(() => {
            setHighlightTask(null);
        }, 3500);
        return () => {
            if (highlightTimerRef.current) {
                clearTimeout(highlightTimerRef.current);
            }
        };
    }, [highlightTaskId, setHighlightTask]);

    useEffect(() => {
        if (selectedTaskId && !selectedTask) {
            setSelectedTaskId(null);
        }
    }, [selectedTask, selectedTaskId]);

    useEffect(() => {
        const visibleIds = new Set(archivedTasks.map((task) => task.id));
        setMultiSelectedIds((previous) => {
            const next = new Set(Array.from(previous).filter((id) => visibleIds.has(id)));
            return next.size === previous.size ? previous : next;
        });
    }, [archivedTasks, setMultiSelectedIds]);

    const handleOpenTask = useCallback((taskId: string) => {
        setSelectedTaskId(taskId);
    }, []);

    const handleSaveTask = useCallback((taskId: string, updates: Partial<Task>) => {
        updateTask(taskId, updates);
        setSelectedTaskId(null);
    }, [updateTask]);

    const handleRestore = useCallback((taskId: string) => {
        updateTask(taskId, { status: 'inbox' });
    }, [updateTask]);

    const selectAllTasks = useCallback(() => {
        setMultiSelectedIds(new Set(archivedTasks.map((task) => task.id)));
    }, [archivedTasks, setMultiSelectedIds]);

    const handleBulkRestore = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        await runBulkAction(restoreActionLabel, async () => {
            assertBulkActionSucceeded(await batchMoveTasks(selectedIdsArray, 'inbox'));
            exitSelectionMode();
        });
    }, [batchMoveTasks, exitSelectionMode, restoreActionLabel, runBulkAction, selectedIdsArray]);

    const handleBulkMoveToDone = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        await runBulkAction(t('status.done'), async () => {
            assertBulkActionSucceeded(await batchMoveTasks(selectedIdsArray, 'done'));
            exitSelectionMode();
        });
    }, [batchMoveTasks, exitSelectionMode, runBulkAction, selectedIdsArray, t]);

    const [completedAtTaskId, setCompletedAtTaskId] = useState<string | null>(null);
    const completedAtTask = useMemo(
        () => completedAtTaskId ? _allTasks.find((task) => task.id === completedAtTaskId) ?? null : null,
        [_allTasks, completedAtTaskId],
    );
    const applyCompletedAt = useCallback((iso: string) => {
        const taskId = completedAtTaskId;
        setCompletedAtTaskId(null);
        if (!taskId) return;
        updateTask(taskId, { completedAt: iso });
    }, [completedAtTaskId, updateTask]);

    const handleDelete = useCallback((taskId: string) => {
        Alert.alert(
            t('common.delete') || 'Delete',
            t('task.deleteConfirmBody') || 'Move this task to Trash?',
            [
                { text: t('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: t('common.delete') || 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        void deleteTask(taskId);
                    },
                },
            ]
        );
    }, [deleteTask, t]);

    const handleRestoreProject = useCallback((projectId: string) => {
        void updateProject(projectId, { status: 'active' });
    }, [updateProject]);

    const handleDeleteProject = useCallback((projectId: string) => {
        const project = projects.find((item) => item.id === projectId);
        Alert.alert(
            project?.title || t('common.delete') || 'Delete',
            t('projects.deleteConfirm') || 'Delete this project? Tasks in this project will be kept and moved to unassigned.',
            [
                { text: t('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: t('common.delete') || 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        void deleteProject(projectId);
                    },
                },
            ],
        );
    }, [deleteProject, projects, t]);

    const handleSegmentChange = useCallback((next: ArchiveSegment) => {
        setSegment((current) => {
            if (current === next) return current;
            exitSelectionMode();
            return next;
        });
    }, [exitSelectionMode]);

    const renderArchivedProject = useCallback(({ item }: { item: Project }) => (
        <ArchivedProjectItem
            project={item}
            tc={tc}
            areaName={item.areaId ? areaById.get(item.areaId)?.name : undefined}
            onOpen={() => openProjectScreen(item.id)}
            onRestore={() => handleRestoreProject(item.id)}
            onDelete={() => handleDeleteProject(item.id)}
            completedLabel={t('list.done') || 'Completed'}
            restoreLabel={t('trash.restore') || 'Restore'}
            deleteLabel={t('common.delete') || 'Delete'}
        />
    ), [tc, areaById, handleRestoreProject, handleDeleteProject, t]);

    const renderArchivedTask = useCallback(({ item }: { item: Task }) => (
        <ArchivedTaskItem
            task={item}
            tc={tc}
            onOpen={() => handleOpenTask(item.id)}
            onRestore={() => handleRestore(item.id)}
            onDelete={() => handleDelete(item.id)}
            onEditCompletedAt={() => setCompletedAtTaskId(item.id)}
            onToggleSelect={() => toggleMultiSelect(item.id)}
            completedLabel={t('list.done') || 'Completed'}
            editCompletedAtLabel={tFallback(t, 'task.editCompletedAt', 'Edit completion time')}
            selectLabel={tFallback(t, 'bulk.select', 'Select')}
            restoreLabel={t('trash.restore') || 'Restore'}
            deleteLabel={t('common.delete') || 'Delete'}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(item.id)}
            isHighlighted={item.id === highlightTaskId}
        />
    ), [tc, handleDelete, handleOpenTask, handleRestore, highlightTaskId, selectedIds, selectionMode, t, toggleMultiSelect]);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <View style={[styles.container, { backgroundColor: tc.bg }]}>
                <View style={styles.segmentRow}>
                    {(['tasks', 'projects'] as ArchiveSegment[]).map((value) => {
                        const selected = segment === value;
                        const label = value === 'tasks' ? (t('common.tasks') || 'Tasks') : (t('projects.title') || 'Projects');
                        return (
                            <Pressable
                                key={value}
                                onPress={() => handleSegmentChange(value)}
                                accessibilityRole="button"
                                accessibilityLabel={label}
                                accessibilityState={{ selected }}
                                style={[
                                    styles.segmentChip,
                                    { backgroundColor: selected ? tc.tint : tc.filterBg, borderColor: tc.border },
                                ]}
                            >
                                <Text style={[styles.segmentChipText, { color: selected ? tc.onTint : tc.text }]}>
                                    {label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
                {segment === 'tasks' && archivedTasks.length > 0 && (
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryText, { color: tc.secondaryText }]}>
                            {archivedTasks.length} {t('common.tasks') || 'tasks'}
                        </Text>
                        <Pressable
                            onPress={selectionMode ? exitSelectionMode : () => setSelectionMode(true)}
                            accessibilityRole="button"
                            accessibilityLabel={selectionMode ? tFallback(t, 'common.done', 'Done') : tFallback(t, 'bulk.select', 'Select')}
                            style={[styles.selectButton, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                        >
                            <Text style={[styles.selectButtonText, { color: tc.text }]}>
                                {selectionMode ? tFallback(t, 'common.done', 'Done') : tFallback(t, 'bulk.select', 'Select')}
                            </Text>
                        </Pressable>
                    </View>
                )}
                {segment === 'projects' && archivedProjects.length > 0 && (
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryText, { color: tc.secondaryText }]}>
                            {archivedProjects.length} {t('projects.title') || 'projects'}
                        </Text>
                    </View>
                )}
                {segment === 'tasks' && selectionMode && (
                    <View style={[styles.bulkBar, { borderColor: tc.border, backgroundColor: tc.cardBg }]}>
                        <Text
                            accessibilityLabel={`${selectedIds.size} ${t('bulk.selected')}`}
                            style={[styles.bulkCount, { color: tc.secondaryText }]}
                        >
                            {selectedIds.size} {t('bulk.selected')}
                        </Text>
                        <View style={styles.bulkActions}>
                            <Pressable
                                onPress={selectAllTasks}
                                disabled={archivedTasks.length === 0 || selectedIds.size === archivedTasks.length}
                                accessibilityRole="button"
                                accessibilityLabel={`${tFallback(t, 'bulk.select', 'Select')} ${tFallback(t, 'common.all', 'all')}`}
                                style={[styles.bulkButton, { backgroundColor: tc.taskItemBg }]}
                            >
                                <Text style={[styles.bulkButtonText, { color: tc.text }]}>
                                    {tFallback(t, 'bulk.select', 'Select')} {tFallback(t, 'common.all', 'all')}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={() => { void handleBulkMoveToDone(); }}
                                disabled={selectedIds.size === 0}
                                accessibilityRole="button"
                                accessibilityLabel={`${t('bulk.moveTo')} ${t('status.done')}`}
                                style={[styles.bulkButton, { backgroundColor: tc.taskItemBg }]}
                            >
                                <Text style={[styles.bulkButtonText, { color: tc.text }]}>
                                    {t('status.done')}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={() => { void handleBulkRestore(); }}
                                disabled={selectedIds.size === 0}
                                accessibilityRole="button"
                                accessibilityLabel={t('trash.restoreToInbox')}
                                style={[styles.bulkButton, { backgroundColor: tc.taskItemBg }]}
                            >
                                <Text style={[styles.bulkButtonText, { color: tc.text }]}>
                                    {t('trash.restoreToInbox')}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={handleBatchDelete}
                                disabled={selectedIds.size === 0}
                                accessibilityRole="button"
                                accessibilityLabel={tFallback(t, 'common.delete', 'Delete')}
                                style={[styles.bulkButton, { backgroundColor: tc.taskItemBg }]}
                            >
                                <Text style={[styles.bulkButtonText, { color: tc.danger }]}>
                                    {tFallback(t, 'common.delete', 'Delete')}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                )}
                {segment === 'projects' ? (
                    <FlatList
                        data={archivedProjects}
                        renderItem={renderArchivedProject}
                        keyExtractor={(item) => item.id}
                        style={styles.taskList}
                        contentContainerStyle={[
                            styles.taskListContent,
                            archivedProjects.length === 0 && styles.emptyContent,
                        ]}
                        initialNumToRender={12}
                        maxToRenderPerBatch={12}
                        windowSize={5}
                        updateCellsBatchingPeriod={50}
                        removeClippedSubviews={false}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <View style={styles.emptyState}>
                                <Archive size={48} color={tc.secondaryText} strokeWidth={1.5} style={styles.emptyIcon} />
                                <Text style={[styles.emptyTitle, { color: tc.text }]}>
                                    {tFallback(t, 'archived.emptyProjects', 'No archived projects')}
                                </Text>
                                <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
                                    {tFallback(t, 'archived.emptyProjectsHint', 'Projects you archive will appear here')}
                                </Text>
                            </View>
                        }
                    />
                ) : (
                <FlatList
                    data={archivedTasks}
                    renderItem={renderArchivedTask}
                    keyExtractor={(item) => item.id}
                    extraData={listExtraData}
                    style={styles.taskList}
                    contentContainerStyle={[
                        styles.taskListContent,
                        archivedTasks.length === 0 && styles.emptyContent,
                    ]}
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={5}
                    updateCellsBatchingPeriod={50}
                    removeClippedSubviews={false}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Archive size={48} color={tc.secondaryText} strokeWidth={1.5} style={styles.emptyIcon} />
                            <Text style={[styles.emptyTitle, { color: tc.text }]}>
                                {t('archived.empty') || 'No archived tasks'}
                            </Text>
                            <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
                                {t('archived.emptyHint') || 'Tasks you archive will appear here'}
                            </Text>
                        </View>
                    }
                />
                )}
                <TaskEditModal
                    visible={Boolean(selectedTask)}
                    task={selectedTask}
                    onClose={() => setSelectedTaskId(null)}
                    onSave={handleSaveTask}
                    defaultTab="view"
                    onProjectNavigate={openProjectScreen}
                    onContextNavigate={openContextsScreen}
                    onTagNavigate={openContextsScreen}
                />
                {completedAtTask ? (
                    <CompletedAtPicker
                        initialValue={completedAtTask.completedAt || completedAtTask.updatedAt}
                        onCancel={() => setCompletedAtTaskId(null)}
                        onConfirm={applyCompletedAt}
                        t={t}
                        tc={tc}
                    />
                ) : null}
            </View>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    segmentRow: {
        paddingHorizontal: 16,
        paddingTop: 12,
        flexDirection: 'row',
        gap: 8,
    },
    segmentChip: {
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    segmentChipText: {
        fontSize: 12,
        fontWeight: '600',
    },
    summaryRow: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    summaryText: {
        fontSize: 13,
        fontWeight: '500',
    },
    selectButton: {
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    selectButtonText: {
        fontSize: 12,
        fontWeight: '600',
    },
    bulkBar: {
        marginHorizontal: 16,
        marginTop: 10,
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        gap: 8,
    },
    bulkCount: {
        fontSize: 12,
        fontWeight: '600',
    },
    bulkActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    bulkButton: {
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    bulkButtonText: {
        fontSize: 12,
        fontWeight: '600',
    },
    taskList: {
        flex: 1,
    },
    taskListContent: {
        padding: 16,
    },
    emptyContent: {
        flexGrow: 1,
    },
    taskItem: {
        flexDirection: 'row',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
    },
    taskItemPressed: {
        opacity: 0.85,
    },
    selectionIndicator: {
        width: 22,
        height: 22,
        borderWidth: 2,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    selectionMark: {
        fontSize: 14,
        fontWeight: '700',
        lineHeight: 16,
    },
    taskContent: {
        flex: 1,
    },
    taskTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
        textDecorationLine: 'line-through',
    },
    taskDescription: {
        fontSize: 14,
        marginBottom: 4,
    },
    archivedDate: {
        fontSize: 12,
        fontStyle: 'italic',
    },
    archivedDateButton: {
        alignSelf: 'flex-start',
    },
    statusIndicator: {
        width: 4,
        borderRadius: 2,
        marginLeft: 12,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        paddingHorizontal: 24,
    },
    emptyIcon: {
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 14,
        textAlign: 'center',
    },
    swipeActionRestore: {
        backgroundColor: '#3B82F6',
        justifyContent: 'center',
        alignItems: 'center',
        width: 100,
        borderRadius: 12,
        marginBottom: 12,
        marginRight: 8,
    },
    swipeActionDelete: {
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        width: 100,
        borderRadius: 12,
        marginBottom: 12,
        marginLeft: 8,
    },
    swipeActionText: {
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 14,
    },
});
