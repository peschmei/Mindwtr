import {
  DEFAULT_PROJECT_COLOR,
  PROJECT_SQLITE_COLUMNS,
  TASK_SQLITE_COLUMNS,
  mapSqliteTaskRow,
  normalizeProjectTaskSortBy,
  parseQuickAdd as parseQuickAddCore,
  type Area as CoreArea,
  type Person as CorePerson,
  type Project as CoreProject,
  type Section as CoreSection,
  type Task as CoreTask,
  type TaskEnergyLevel as CoreTaskEnergyLevel,
  type TaskPriority as CoreTaskPriority,
  type TaskStatus as CoreTaskStatus,
  type TimeEstimate as CoreTimeEstimate,
} from '@mindwtr/core';
import type { DbClient } from './db.js';
import { parseJson } from './db.js';
import { NotFoundError } from './errors.js';

export type TaskStatus = CoreTaskStatus;
export type Task = CoreTask;
export type Project = CoreProject & { orderNum?: number };
export type Area = CoreArea;
export type Person = CorePerson;
export type Section = CoreSection;
export type ProjectRef = Pick<CoreProject, 'id' | 'title'>;

export const parseQuickAdd = (input: string, projects: ProjectRef[]): { title: string; props: Partial<Task> } => {
  const parsed = parseQuickAddCore(input, projects as CoreProject[]);
  return {
    title: parsed.title,
    props: parsed.props as Partial<Task>,
  };
};

export type ListTasksInput = {
  status?: TaskStatus | 'all';
  projectId?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'dueDate' | 'title' | 'priority';
  sortOrder?: 'asc' | 'desc';
};

export type AddTaskInput = {
  title?: string;
  quickAdd?: string;
  status?: TaskStatus;
  projectId?: string;
  sectionId?: string;
  dueDate?: string;
  startTime?: string;
  contexts?: string[];
  tags?: string[];
  description?: string;
  priority?: CoreTaskPriority;
  energyLevel?: CoreTaskEnergyLevel;
  assignedTo?: string;
  timeEstimate?: CoreTimeEstimate;
};

export type TaskRow = Task;

type ColumnInfoRow = { name?: unknown };
type SqliteNameRow = { name?: unknown };
type TaskSqliteRow = Record<string, unknown>;
type ProjectSqliteRow = Record<string, unknown> & {
  id: string;
  title: string;
  status?: string | null;
  color?: string | null;
  orderNum?: number | null;
  tagIds?: unknown;
  isSequential?: number | null;
  sequentialScope?: string | null;
  taskSortBy?: string | null;
  isFocused?: number | null;
  supportNotes?: string | null;
  attachments?: unknown;
  dueDate?: string | null;
  reviewAt?: string | null;
  areaId?: string | null;
  areaTitle?: string | null;
  rev?: number | null;
  revBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  purgedAt?: string | null;
};
type SectionSqliteRow = Record<string, unknown> & {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  orderNum?: number | null;
  isCollapsed?: number | null;
  rev?: number | null;
  revBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
type AreaSqliteRow = Record<string, unknown> & {
  id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  orderNum?: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
type PersonSqliteRow = Record<string, unknown> & {
  id: string;
  name: string;
  note?: string | null;
  referenceLink?: string | null;
  rev?: number | null;
  revBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

// MCP writes go through the core-backed adapter, but reads are intentionally
// kept as direct SQL so list/search tools stay fast and read-only. Row mapping
// is delegated to core; keep this projection in sync with core SQLite columns
// whenever task columns are added or renamed.
const BASE_TASK_COLUMNS = [...TASK_SQLITE_COLUMNS];

const taskColumnsCache = new WeakMap<DbClient, { hasOrderNum: boolean; insertColumns: string[]; selectColumns: string[] }>();
const tasksFtsCache = new WeakMap<DbClient, boolean>();

const getTaskColumns = (db: DbClient) => {
  const cached = taskColumnsCache.get(db);
  if (cached) return cached;
  try {
    const columns = db.prepare('PRAGMA table_info(tasks)').all<ColumnInfoRow>();
    const names = new Set<string>(columns.map((col) => String(col.name)));
    const hasOrderNum = names.has('orderNum');
    const selectColumns = BASE_TASK_COLUMNS.filter((name) => name === 'orderNum' ? hasOrderNum : names.has(name));
    const insertColumns = TASK_SQLITE_COLUMNS.filter((name) => names.has(name));
    const resolved = { hasOrderNum, insertColumns, selectColumns };
    taskColumnsCache.set(db, resolved);
    return resolved;
  } catch {
    const fallback = { hasOrderNum: true, insertColumns: [...TASK_SQLITE_COLUMNS], selectColumns: BASE_TASK_COLUMNS };
    taskColumnsCache.set(db, fallback);
    return fallback;
  }
};

const hasTasksFts = (db: DbClient): boolean => {
  const cached = tasksFtsCache.get(db);
  if (cached !== undefined) return cached;
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks_fts'").all<SqliteNameRow>();
    const hasFts = rows.some((row) => row.name === 'tasks_fts');
    tasksFtsCache.set(db, hasFts);
    return hasFts;
  } catch {
    tasksFtsCache.set(db, false);
    return false;
  }
};

const buildTasksFtsQuery = (search: string): string | null => {
  const cleaned = String(search || '')
    .replace(/[^\p{L}\p{N}#@]+/gu, ' ')
    .trim();
  if (!cleaned) return null;
  const reservedTokens = new Set(['AND', 'OR', 'NOT', 'NEAR']);
  const tokens = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !reservedTokens.has(token.toUpperCase()));
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}*`).join(' ');
};

function mapTaskRow(row: TaskSqliteRow): TaskRow {
  const task = mapSqliteTaskRow(row);
  return {
    ...task,
    tags: task.tags ?? [],
    contexts: task.contexts ?? [],
    checklist: task.checklist ?? [],
    attachments: task.attachments ?? [],
    orderNum: task.orderNum ?? task.order,
  };
}

export function listTasks(db: DbClient, input: ListTasksInput): TaskRow[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!input.includeDeleted) {
    where.push('deletedAt IS NULL');
  }
  if (input.status && input.status !== 'all') {
    where.push('status = ?');
    params.push(input.status);
  }
  if (input.projectId) {
    where.push('projectId = ?');
    params.push(input.projectId);
  }
  if (input.search) {
    const ftsQuery = buildTasksFtsQuery(input.search);
    if (ftsQuery && hasTasksFts(db)) {
      where.push("rowid IN (SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ?)");
      params.push(ftsQuery);
    } else {
      where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      // Escape SQL wildcards (%, _, \) in search input
      const escaped = input.search.replace(/[\\%_]/g, '\\$&');
      const pattern = `%${escaped}%`;
      params.push(pattern, pattern);
    }
  }
  if (input.dueDateFrom) {
    where.push('date(dueDate) >= date(?)');
    params.push(input.dueDateFrom);
  }
  if (input.dueDateTo) {
    where.push('date(dueDate) <= date(?)');
    params.push(input.dueDateTo);
  }

  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, input.limit as number)) : 200;
  const offset = Number.isFinite(input.offset) ? Math.max(0, input.offset as number) : 0;

  // Validate and apply sorting
  const validSortColumns = ['updatedAt', 'createdAt', 'dueDate', 'title', 'priority'];
  const sortBy = validSortColumns.includes(input.sortBy ?? '') ? input.sortBy : 'updatedAt';
  const sortOrder = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const { selectColumns } = getTaskColumns(db);
  const sql = `SELECT ${selectColumns.join(', ')} FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all<TaskSqliteRow>(...params, limit, offset);
  return rows.map(mapTaskRow);
}

export type GetTaskInput = { id: string; includeDeleted?: boolean };

export function getTask(db: DbClient, input: GetTaskInput): TaskRow {
  const where = ['id = ?'];
  if (!input.includeDeleted) {
    where.push('deletedAt IS NULL');
  }
  const { selectColumns } = getTaskColumns(db);
  const sql = `SELECT ${selectColumns.join(', ')} FROM tasks WHERE ${where.join(' AND ')}`;
  const row = db.prepare(sql).get<TaskSqliteRow>(input.id);
  if (!row) {
    throw new NotFoundError(`Task not found: ${input.id}`);
  }
  return mapTaskRow(row);
}

const BASE_PROJECT_COLUMNS = [...PROJECT_SQLITE_COLUMNS];

const projectColumnsCache = new WeakMap<DbClient, { hasOrderNum: boolean; selectColumns: string[] }>();

const getProjectColumns = (db: DbClient) => {
  const cached = projectColumnsCache.get(db);
  if (cached) return cached;
  try {
    const columns = db.prepare('PRAGMA table_info(projects)').all<ColumnInfoRow>();
    const names = new Set<string>(columns.map((col) => String(col.name)));
    const hasOrderNum = names.has('orderNum');
    const hasDueDate = names.has('dueDate');
    const selectColumns = BASE_PROJECT_COLUMNS.filter(
      (name) => names.has(name) && (hasOrderNum || name !== 'orderNum') && (hasDueDate || name !== 'dueDate')
    );
    const resolved = { hasOrderNum, selectColumns };
    projectColumnsCache.set(db, resolved);
    return resolved;
  } catch {
    const fallback = { hasOrderNum: true, selectColumns: BASE_PROJECT_COLUMNS };
    projectColumnsCache.set(db, fallback);
    return fallback;
  }
};

export function listProjects(db: DbClient): Project[] {
  const { selectColumns } = getProjectColumns(db);
  const rows = db.prepare(`SELECT ${selectColumns.join(', ')} FROM projects WHERE deletedAt IS NULL`).all<ProjectSqliteRow>();
  return rows.map(mapProjectRow);
}

const mapProjectRow = (row: ProjectSqliteRow): Project => ({
  id: row.id,
  title: row.title,
  status: row.status === 'someday' || row.status === 'waiting' || row.status === 'archived' ? row.status : 'active',
  color: row.color ?? DEFAULT_PROJECT_COLOR,
  order: row.orderNum ?? 0,
  orderNum: row.orderNum ?? undefined,
  tagIds: parseJson(row.tagIds, []),
  isSequential: row.isSequential === 1,
  sequentialScope: row.sequentialScope === 'section' || row.sequentialScope === 'project'
    ? row.sequentialScope
    : undefined,
  taskSortBy: normalizeProjectTaskSortBy(row.taskSortBy),
  isFocused: row.isFocused === 1,
  supportNotes: row.supportNotes ?? undefined,
  attachments: parseJson(row.attachments, []),
  dueDate: row.dueDate ?? undefined,
  reviewAt: row.reviewAt ?? undefined,
  areaId: row.areaId ?? undefined,
  areaTitle: row.areaTitle ?? undefined,
  rev: row.rev ?? undefined,
  revBy: row.revBy ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt ?? undefined,
  purgedAt: row.purgedAt ?? undefined,
});

export type GetProjectInput = { id: string; includeDeleted?: boolean };

export function getProject(db: DbClient, input: GetProjectInput): Project {
  const { selectColumns } = getProjectColumns(db);
  const where = ['id = ?'];
  if (!input.includeDeleted) {
    where.push('deletedAt IS NULL');
  }
  const row = db.prepare(`SELECT ${selectColumns.join(', ')} FROM projects WHERE ${where.join(' AND ')}`).get<ProjectSqliteRow>(input.id);
  if (!row) {
    throw new NotFoundError(`Project not found: ${input.id}`);
  }
  return mapProjectRow(row);
}

const BASE_SECTION_COLUMNS = [
  'id',
  'projectId',
  'title',
  'description',
  'orderNum',
  'isCollapsed',
  'rev',
  'revBy',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

const sectionColumnsCache = new WeakMap<DbClient, { hasOrderNum: boolean; selectColumns: string[] }>();

const getSectionColumns = (db: DbClient) => {
  const cached = sectionColumnsCache.get(db);
  if (cached) return cached;
  try {
    const columns = db.prepare('PRAGMA table_info(sections)').all<ColumnInfoRow>();
    const names = new Set<string>(columns.map((col) => String(col.name)));
    const hasOrderNum = names.has('orderNum');
    const selectColumns = BASE_SECTION_COLUMNS.filter((name) => hasOrderNum || name !== 'orderNum');
    const resolved = { hasOrderNum, selectColumns };
    sectionColumnsCache.set(db, resolved);
    return resolved;
  } catch {
    const fallback = { hasOrderNum: true, selectColumns: BASE_SECTION_COLUMNS };
    sectionColumnsCache.set(db, fallback);
    return fallback;
  }
};

const mapSectionRow = (row: SectionSqliteRow): Section => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  description: row.description ?? undefined,
  order: row.orderNum ?? 0,
  isCollapsed: row.isCollapsed === null || row.isCollapsed === undefined ? undefined : row.isCollapsed === 1,
  rev: row.rev ?? undefined,
  revBy: row.revBy ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt ?? undefined,
});

export type ListSectionsInput = {
  projectId?: string;
  includeDeleted?: boolean;
};

export function listSections(db: DbClient, input: ListSectionsInput = {}): Section[] {
  const { hasOrderNum, selectColumns } = getSectionColumns(db);
  const where: string[] = [];
  const params: unknown[] = [];
  if (input.projectId) {
    where.push('projectId = ?');
    params.push(input.projectId);
  }
  if (!input.includeDeleted) {
    where.push('deletedAt IS NULL');
  }
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const orderSql = hasOrderNum ? 'projectId ASC, orderNum ASC, title ASC' : 'projectId ASC, title ASC';
  const rows = db
    .prepare(`SELECT ${selectColumns.join(', ')} FROM sections${whereSql} ORDER BY ${orderSql}`)
    .all<SectionSqliteRow>(...params);
  return rows.map(mapSectionRow);
}

export type GetSectionInput = { id: string; includeDeleted?: boolean };

export function getSection(db: DbClient, input: GetSectionInput): Section {
  const { selectColumns } = getSectionColumns(db);
  const where = ['id = ?'];
  if (!input.includeDeleted) {
    where.push('deletedAt IS NULL');
  }
  const row = db.prepare(`SELECT ${selectColumns.join(', ')} FROM sections WHERE ${where.join(' AND ')}`).get<SectionSqliteRow>(input.id);
  if (!row) {
    throw new NotFoundError(`Section not found: ${input.id}`);
  }
  return mapSectionRow(row);
}

const BASE_AREA_COLUMNS = [
  'id',
  'name',
  'color',
  'icon',
  'orderNum',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

const areaColumnsCache = new WeakMap<DbClient, { hasOrderNum: boolean; selectColumns: string[] }>();

const getAreaColumns = (db: DbClient) => {
  const cached = areaColumnsCache.get(db);
  if (cached) return cached;
  try {
    const columns = db.prepare('PRAGMA table_info(areas)').all<ColumnInfoRow>();
    const names = new Set<string>(columns.map((col) => String(col.name)));
    const hasOrderNum = names.has('orderNum');
    const selectColumns = BASE_AREA_COLUMNS.filter((name) => hasOrderNum || name !== 'orderNum');
    const resolved = { hasOrderNum, selectColumns };
    areaColumnsCache.set(db, resolved);
    return resolved;
  } catch {
    const fallback = { hasOrderNum: true, selectColumns: BASE_AREA_COLUMNS };
    areaColumnsCache.set(db, fallback);
    return fallback;
  }
};

const mapAreaRow = (row: AreaSqliteRow): Area => ({
  id: row.id,
  name: row.name,
  color: row.color ?? undefined,
  icon: row.icon ?? undefined,
  order: row.orderNum ?? 0,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt ?? undefined,
});

export function listAreas(db: DbClient): Area[] {
  const { selectColumns } = getAreaColumns(db);
  const rows = db.prepare(`SELECT ${selectColumns.join(', ')} FROM areas WHERE deletedAt IS NULL ORDER BY orderNum ASC, updatedAt DESC`).all<AreaSqliteRow>();
  return rows.map(mapAreaRow);
}

const BASE_PERSON_COLUMNS = [
  'id',
  'name',
  'note',
  'referenceLink',
  'rev',
  'revBy',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

const peopleColumnsCache = new WeakMap<DbClient, { exists: boolean; selectColumns: string[] }>();

const getPeopleColumns = (db: DbClient) => {
  const cached = peopleColumnsCache.get(db);
  if (cached) return cached;
  try {
    const columns = db.prepare('PRAGMA table_info(people)').all<ColumnInfoRow>();
    const names = new Set<string>(columns.map((col) => String(col.name)));
    const exists = names.size > 0;
    const selectColumns = BASE_PERSON_COLUMNS.filter((name) => names.has(name));
    const resolved = { exists, selectColumns: selectColumns.length > 0 ? selectColumns : BASE_PERSON_COLUMNS };
    peopleColumnsCache.set(db, resolved);
    return resolved;
  } catch {
    const fallback = { exists: false, selectColumns: BASE_PERSON_COLUMNS };
    peopleColumnsCache.set(db, fallback);
    return fallback;
  }
};

const mapPersonRow = (row: PersonSqliteRow): Person => ({
  id: row.id,
  name: row.name,
  note: row.note ?? undefined,
  referenceLink: row.referenceLink ?? undefined,
  rev: row.rev ?? undefined,
  revBy: row.revBy ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt ?? undefined,
});

export type ListPeopleInput = {
  includeDeleted?: boolean;
};

export function listPeople(db: DbClient, input: ListPeopleInput = {}): Person[] {
  const { exists, selectColumns } = getPeopleColumns(db);
  if (!exists) return [];
  const where = input.includeDeleted ? '' : ' WHERE deletedAt IS NULL';
  const rows = db
    .prepare(`SELECT ${selectColumns.join(', ')} FROM people${where} ORDER BY lower(name) ASC, updatedAt DESC`)
    .all<PersonSqliteRow>();
  return rows.map(mapPersonRow);
}

export type GetPersonInput = { id: string; includeDeleted?: boolean };

export function getPerson(db: DbClient, input: GetPersonInput): Person {
  const { exists, selectColumns } = getPeopleColumns(db);
  if (!exists) {
    throw new NotFoundError(`Person not found: ${input.id}`);
  }
  const where = ['id = ?'];
  if (!input.includeDeleted) {
    where.push('deletedAt IS NULL');
  }
  const row = db.prepare(`SELECT ${selectColumns.join(', ')} FROM people WHERE ${where.join(' AND ')}`).get<PersonSqliteRow>(input.id);
  if (!row) {
    throw new NotFoundError(`Person not found: ${input.id}`);
  }
  return mapPersonRow(row);
}

export type UpdateTaskInput = {
  id: string;
  title?: string;
  status?: TaskStatus;
  projectId?: string | null;
  sectionId?: string | null;
  dueDate?: string | null;
  startTime?: string | null;
  contexts?: string[] | null;
  tags?: string[] | null;
  description?: string | null;
  priority?: CoreTaskPriority | null;
  energyLevel?: CoreTaskEnergyLevel | null;
  assignedTo?: string | null;
  timeEstimate?: CoreTimeEstimate | null;
  reviewAt?: string | null;
  isFocusedToday?: boolean;
};
