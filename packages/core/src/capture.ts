import type { Project, Task } from './types';
import type { QuickAddResult } from './quick-add';
import { getQuickAddProjectInitialProps } from './quick-add';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { DEFAULT_PROJECT_COLOR } from './color-constants';

/**
 * Capture assembly as one module: turning parsed quick-add input plus surface
 * state into `addTask` props. Every capture surface (desktop Quick Add, the
 * mobile capture sheet, the mobile in-list quick add) is an adapter over this
 * — the project match/create policy, Container exclusivity, detected-date
 * precedence, and the title fallback chain live here once.
 *
 * A capture is never dropped: a `+Project` naming only an archived project
 * behaves like an unknown name and requests a fresh project (archived
 * projects accept no new tasks).
 */
export type CaptureAssemblyInput = {
    parsed: Pick<QuickAddResult, 'title' | 'props' | 'projectTitle' | 'detectedDate' | 'invalidDateCommands'>;
    rawInput: string;
    /** Last-resort title (e.g. an attachment's name) when input parses empty. */
    fallbackTitle?: string;
    projects: readonly Project[];
    /** Surface defaults merged under the parsed props. */
    initialProps?: Partial<Task>;
    /** Surface overrides merged over the parsed props. */
    extraProps?: Partial<Task>;
    /** Area applied when the capture has no project home (Container exclusivity). */
    selectedAreaId?: string | null;
    /** Star for Today's Focus; the store gates eligibility/cap on write. */
    starNewTask?: boolean;
    /** Set when the surface already holds an explicit due date (a picker). */
    suppressDetectedDate?: boolean;
};

export type CaptureProjectToCreate = {
    title: string;
    color: string;
    initialProps?: Partial<Project>;
};

export type CaptureAssembly =
    | { ok: false; reason: 'empty-title' }
    | {
        ok: true;
        title: string;
        props: Partial<Task>;
        /** When set: create this project, then applyCapturedProject(props, id). */
        projectToCreate?: CaptureProjectToCreate;
        invalidDateCommands?: string[];
    };

const findSelectableProjectByTitle = (
    projects: readonly Project[],
    title: string,
): Project | undefined => {
    const normalized = title.toLowerCase();
    return projects.find((project) => (
        project.title.toLowerCase() === normalized
        && isSelectableProjectForTaskAssignment(project)
    ));
};

const isAssignableProjectId = (projects: readonly Project[], projectId: string | undefined): boolean =>
    Boolean(projectId && projects.some((project) => (
        project.id === projectId && isSelectableProjectForTaskAssignment(project)
    )));

export function buildCaptureTaskProps(input: CaptureAssemblyInput): CaptureAssembly {
    const { parsed, projects } = input;
    // Only the PARSED project id is validated: user-typed +Project tokens can
    // name archived or deleted projects, which accept no new tasks — dropping
    // the token lets the surface's own project (in-project quick add) show
    // through. Surface-provided initialProps/extraProps are trusted; the
    // surface knows its own context better than a possibly-stale snapshot.
    const parsedProps = { ...parsed.props };
    if (parsedProps.projectId && !isAssignableProjectId(projects, parsedProps.projectId)) {
        delete parsedProps.projectId;
    }
    const props: Partial<Task> = {
        status: 'inbox',
        ...input.initialProps,
        ...parsedProps,
        ...input.extraProps,
    };
    if (!props.status) props.status = 'inbox';

    // Natural-language date applies only when nothing more explicit set one.
    const detectedDate = parsed.detectedDate;
    const applyDetectedDate = Boolean(
        detectedDate?.date && !props.dueDate && !input.suppressDetectedDate,
    );
    if (applyDetectedDate && detectedDate) {
        props.dueDate = detectedDate.date;
    }

    const title = (applyDetectedDate && detectedDate
        ? detectedDate.titleWithoutDate
        : (parsed.title || input.rawInput.trim() || input.fallbackTitle || '')
    ).trim();
    if (!title) return { ok: false, reason: 'empty-title' };

    if (input.starNewTask) {
        // The store's addTask evaluates eligibility and the focus cap before
        // the star commits (a refused star leaves an unstarred inbox capture).
        props.isFocusedToday = true;
    }

    let projectToCreate: CaptureProjectToCreate | undefined;
    if (!props.projectId && parsed.projectTitle) {
        const existing = findSelectableProjectByTitle(projects, parsed.projectTitle);
        if (existing) {
            props.projectId = existing.id;
        } else {
            projectToCreate = {
                title: parsed.projectTitle,
                color: DEFAULT_PROJECT_COLOR,
                initialProps: getQuickAddProjectInitialProps(props, input.selectedAreaId ?? undefined),
            };
        }
    }

    // Container exclusivity: a project home clears the direct area; the area
    // fallback applies only when the capture has no project home at all.
    const hasProjectHome = Boolean(props.projectId || projectToCreate);
    if (hasProjectHome) {
        props.areaId = undefined;
    } else if (!parsedProps.areaId && !props.areaId) {
        props.areaId = input.selectedAreaId || undefined;
    }

    return {
        ok: true,
        title,
        props,
        projectToCreate,
        invalidDateCommands: parsed.invalidDateCommands,
    };
}

/** Attach the created project to the capture, keeping Container exclusivity. */
export function applyCapturedProject(props: Partial<Task>, projectId: string): Partial<Task> {
    return { ...props, projectId, areaId: undefined };
}
