import type { CostTarget, GameSystem, Resource } from '../types';

/*
 * Which of a game's resources an amount may be in, by where it's given. A
 * resource says what it's used for (`usedFor`); left out, its scope decides.
 * Every cost field in the Data Editor and the data checker read it from here.
 */

export const COST_TARGETS: ReadonlyArray<CostTarget> = [
    'unit',
    'additionalModels',
    'option',
    'slotOption',
    'group',
    'grant',
];

const BY_SCOPE: Record<Resource['scope'], Array<CostTarget>> = {
    list: ['unit', 'additionalModels', 'option', 'slotOption', 'group'],
    unit: ['option', 'slotOption'],
    contingent: ['group', 'grant'],
};

/** What a resource of the scope is used for unless it says otherwise */
export const defaultUsedFor = (scope: Resource['scope']): Array<CostTarget> =>
    BY_SCOPE[scope];

/** What the resource is used for: its own list, or its scope's default */
export const usedFor = (resource: Resource): Array<CostTarget> =>
    resource.usedFor ?? BY_SCOPE[resource.scope];

/** The resources amounts for the target may be in, in the game's order */
export const resourcesFor = (
    game: Pick<GameSystem, 'resources'>,
    target: CostTarget
): Array<Resource> =>
    Object.values(game.resources).filter((resource) =>
        usedFor(resource).includes(target)
    );

/** Targets whose fields always show the game's main resource */
const SPENDING: ReadonlyArray<CostTarget> = [
    'unit',
    'additionalModels',
    'option',
    'slotOption',
];

/**
 * The resources a field shows: those with an amount (or just added), and for
 * spending always the main resource, so the usual cost needs no extra click
 * and its input never moves away while others are added
 */
export function shownResources(
    available: Array<Resource>,
    amounts: Record<string, unknown>,
    added: Array<string>,
    target: CostTarget
): Array<Resource> {
    const main = SPENDING.includes(target) ? available[0]?.id : undefined;
    return available.filter(
        ({ id }) => id === main || id in amounts || added.includes(id)
    );
}
