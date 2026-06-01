import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TaskEditOrganizationField } from './TaskEditOrganizationField';

const styles = {
    formGroup: {},
    label: {},
    dateRow: {},
    dateBtn: {},
    flex1: {},
    clearDateBtn: {},
    clearDateText: {},
    compactFieldRow: {},
    compactFieldLabel: {},
    compactFieldValue: {},
    statusContainer: {},
    statusContainerCompact: {},
    statusChip: {},
    statusChipCompact: {},
    statusText: {},
    statusTextCompact: {},
    input: {},
    tokenSuggestionsMenu: {},
    tokenSuggestionItem: {},
    tokenSuggestionItemLast: {},
    tokenSuggestionText: {},
};

const tc = {
    cardBg: '#111',
    border: '#333',
    filterBg: '#222',
    inputBg: '#111',
    secondaryText: '#aaa',
    text: '#fff',
    tint: '#3b82f6',
};

const t = (key: string) => ({
    'taskEdit.projectLabel': 'Project',
    'taskEdit.noProjectOption': 'No Project',
    'taskEdit.areaLabel': 'Area',
    'taskEdit.noAreaOption': 'No Area',
    'taskEdit.statusLabel': 'Status',
    'common.clear': 'Clear',
}[key] ?? key);

const baseProps = {
    applyAssignedToSuggestion: vi.fn(),
    areas: [],
    assignedToSuggestions: [],
    availableStatusOptions: [],
    editedTask: {},
    energyLevelOptions: [],
    handleInputFocus: vi.fn(),
    prioritiesEnabled: true,
    priorityOptions: [],
    projectSections: [],
    projects: [],
    setEditedTask: vi.fn(),
    setShowAreaPicker: vi.fn(),
    setShowProjectPicker: vi.fn(),
    setShowSectionPicker: vi.fn(),
    styles,
    t,
    task: null,
    tc,
    timeEstimateOptions: [],
    timeEstimatesEnabled: true,
};

describe('TaskEditOrganizationField', () => {
    it('renders an unset project as a compact picker row', () => {
        const setShowProjectPicker = vi.fn();

        let tree!: renderer.ReactTestRenderer;
        act(() => {
            tree = renderer.create(
                <TaskEditOrganizationField
                    {...(baseProps as any)}
                    fieldId="project"
                    setShowProjectPicker={setShowProjectPicker}
                />
            );
        });

        const compactButton = tree.root.findByProps({ accessibilityLabel: 'Project: No Project' });
        expect(compactButton.props.accessibilityRole).toBe('button');

        act(() => {
            compactButton.props.onPress();
        });

        expect(setShowProjectPicker).toHaveBeenCalledWith(true);
    });

    it('renders an unset area as a compact picker row', () => {
        const setShowAreaPicker = vi.fn();

        let tree!: renderer.ReactTestRenderer;
        act(() => {
            tree = renderer.create(
                <TaskEditOrganizationField
                    {...(baseProps as any)}
                    fieldId="area"
                    setShowAreaPicker={setShowAreaPicker}
                />
            );
        });

        const compactButton = tree.root.findByProps({ accessibilityLabel: 'Area: No Area' });
        expect(compactButton.props.accessibilityRole).toBe('button');

        act(() => {
            compactButton.props.onPress();
        });

        expect(setShowAreaPicker).toHaveBeenCalledWith(true);
    });
});
