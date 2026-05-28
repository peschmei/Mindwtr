import React, { useCallback, useEffect, useState } from 'react';
import { getProjectNextActionPromptData, shallow, useTaskStore } from '@mindwtr/core';
import type { Task } from '@mindwtr/core';

import { useLanguage } from '../contexts/language-context';
import { useThemeColors } from '../hooks/use-theme-colors';
import { ProjectNextActionPromptModal } from './swipeable-task-item/ProjectNextActionPromptModal';

type ProjectNextActionPromptState = {
    candidates: Task[];
    projectId: string;
    projectTitle: string;
    sectionId?: string;
};

type ProjectNextActionPromptPresenter = (completedTask: Task) => boolean;

let activePresenter: ProjectNextActionPromptPresenter | null = null;

const getAllTasksForPrompt = (completedTask: Task, allTasks: Task[]): Task[] => {
    if (allTasks.some((task) => task.id === completedTask.id)) {
        return allTasks.map((task) => (task.id === completedTask.id ? completedTask : task));
    }
    return [...allTasks, completedTask];
};

export function buildProjectNextActionPromptState(completedTask: Task): ProjectNextActionPromptState | null {
    const storeState = useTaskStore.getState();
    const taskLookup = storeState._tasksById instanceof Map ? storeState._tasksById : null;
    const allTasks = Array.isArray(storeState._allTasks) ? storeState._allTasks : storeState.tasks;
    const allProjects = Array.isArray(storeState._allProjects) ? storeState._allProjects : storeState.projects;
    const latestTask = taskLookup?.get(completedTask.id)
        ?? allTasks.find((candidate) => candidate.id === completedTask.id)
        ?? completedTask;
    const completedSnapshot: Task = {
        ...latestTask,
        ...completedTask,
        status: 'done',
    };
    const promptData = getProjectNextActionPromptData(
        completedSnapshot,
        getAllTasksForPrompt(completedSnapshot, allTasks),
        allProjects,
    );

    if (!promptData) return null;

    return {
        candidates: promptData.candidates,
        projectId: promptData.project.id,
        projectTitle: promptData.project.title,
        sectionId: completedSnapshot.sectionId,
    };
}

export function presentProjectNextActionPrompt(completedTask: Task): boolean | null {
    if (!activePresenter) return null;
    return activePresenter(completedTask);
}

export function ProjectNextActionPromptProvider({ children }: { children: React.ReactNode }) {
    const { addTask, updateTask } = useTaskStore((state) => ({
        addTask: state.addTask,
        updateTask: state.updateTask,
    }), shallow);
    const tc = useThemeColors();
    const { t } = useLanguage();
    const [prompt, setPrompt] = useState<ProjectNextActionPromptState | null>(null);
    const [newTitle, setNewTitle] = useState('');

    const closePrompt = useCallback(() => {
        setPrompt(null);
        setNewTitle('');
    }, []);

    const presentPrompt = useCallback((completedTask: Task) => {
        const nextPrompt = buildProjectNextActionPromptState(completedTask);
        if (!nextPrompt) return false;
        setNewTitle('');
        setPrompt(nextPrompt);
        return true;
    }, []);

    useEffect(() => {
        activePresenter = presentPrompt;
        return () => {
            if (activePresenter === presentPrompt) {
                activePresenter = null;
            }
        };
    }, [presentPrompt]);

    const handleChooseTask = useCallback((taskId: string) => {
        void Promise.resolve(updateTask(taskId, { status: 'next' }))
            .then((result) => {
                if (result && !result.success) {
                    throw new Error(result.error || 'Failed to choose next action');
                }
                closePrompt();
            })
            .catch(() => undefined);
    }, [closePrompt, updateTask]);

    const handleAddTask = useCallback(() => {
        if (!prompt) return;
        const title = newTitle.trim();
        if (!title) return;
        void Promise.resolve(addTask(title, {
            status: 'next',
            projectId: prompt.projectId,
            sectionId: prompt.sectionId,
        }))
            .then((result) => {
                if (result && !result.success) {
                    throw new Error(result.error || 'Failed to add next action');
                }
                closePrompt();
            })
            .catch(() => undefined);
    }, [addTask, closePrompt, newTitle, prompt]);

    return (
        <>
            {children}
            {prompt ? (
                <ProjectNextActionPromptModal
                    visible
                    candidates={prompt.candidates}
                    projectTitle={prompt.projectTitle}
                    newTitle={newTitle}
                    tc={tc}
                    t={t}
                    onAddTask={handleAddTask}
                    onCancel={closePrompt}
                    onChooseTask={handleChooseTask}
                    onNewTitleChange={setNewTitle}
                />
            ) : null}
        </>
    );
}
