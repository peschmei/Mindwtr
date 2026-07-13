import type { FilterCriteria, MultiValueFilterMatchMode, Task, TaskEnergyLevel, TaskPriority, TimeEstimate } from '@mindwtr/core';
import { countActiveFilterCriteria, criteriaFromSelections, hasActiveFilterCriteria, matchesTask, parseSearchQuery, taskMatchesFilterCriteria } from '@mindwtr/core';
export { getTaskMetadataFilterVisibility as getMobileTaskMetadataFilterVisibility } from '@mindwtr/core';

export type MobileTaskListFilters = {
  criteria: FilterCriteria;
  searchQuery: string;
};

export type MobileTaskListFilterInput = {
  energyLevels: TaskEnergyLevel[];
  locationQuery: string;
  priorities: TaskPriority[];
  searchQuery: string;
  timeEstimates: TimeEstimate[];
  tokens: string[];
  contextMatchMode: MultiValueFilterMatchMode;
};

const normalize = (value: string | undefined): string => value?.trim().toLowerCase() ?? '';

export const buildMobileTaskListFilterCriteria = (filters: MobileTaskListFilterInput): FilterCriteria => {
  const location = filters.locationQuery.trim();
  return criteriaFromSelections({
    tokens: filters.tokens,
    priorities: filters.priorities,
    energyLevels: filters.energyLevels,
    timeEstimates: filters.timeEstimates,
    contextMatchMode: filters.contextMatchMode,
    locations: location ? [location] : [],
  });
};

export const buildMobileTaskListFilters = (filters: MobileTaskListFilterInput): MobileTaskListFilters => ({
  criteria: buildMobileTaskListFilterCriteria(filters),
  searchQuery: filters.searchQuery,
});

export const countActiveMobileTaskFilters = (filters: MobileTaskListFilters): number => (
  (normalize(filters.searchQuery) ? 1 : 0)
  + countActiveFilterCriteria(filters.criteria)
);

const taskMatchesMobileSearchQuery = (task: Task, searchQueryValue: string): boolean => {
  const searchQuery = normalize(searchQueryValue);
  if (searchQuery) {
    const parsedSearch = parseSearchQuery(searchQuery);
    const hasFieldedTerm = parsedSearch.clauses.some((clause) =>
      clause.terms.some((term) => term.field !== null)
    );
    if (hasFieldedTerm) {
      const now = new Date();
      const matchesSearch = parsedSearch.clauses.some((clause) =>
        clause.terms.every((term) => matchesTask(term, task, null, now))
      );
      if (!matchesSearch) return false;
    } else {
      const searchable = `${task.title} ${task.description ?? ''}`.toLowerCase();
      if (!searchable.includes(searchQuery)) return false;
    }
  }

  return true;
};

export const taskMatchesMobileTaskFilters = (
  task: Task,
  filters: MobileTaskListFilters,
): boolean => {
  if (!taskMatchesMobileSearchQuery(task, filters.searchQuery)) return false;
  if (!hasActiveFilterCriteria(filters.criteria)) return true;
  return taskMatchesFilterCriteria(task, filters.criteria, { tokenMatchMode: 'all' });
};
