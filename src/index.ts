/*
 * Browser-safe entry: no Node imports. The Node-only parts (reading a source
 * from disk) are in './node'.
 */

export * from './types';
export * from './game_data/schema';
export { checkShapes, checkShape, sourceShapeFiles } from './game_data/shape';
export type { ShapeFile, ShapeIssue, ShapeKind } from './game_data/shape';
export {
    SCHEMA_VERSION,
    OLDEST_SCHEMA_VERSION,
    EXPRESSION_VERSION,
    OLDEST_EXPRESSION_VERSION,
    DEFAULT_EXPRESSION_VERSION,
    expressionVersionOf,
    checkManifestVersions,
} from './game_data/versions';
export { validateGameData } from './game_data/validate';
export type { DataIssue, DataFile, GameDataSet } from './game_data/validate';
export { buildVocabulary, scopeWords } from './game_data/vocabulary';
export {
    COST_TARGETS,
    defaultUsedFor,
    usedFor,
    resourcesFor,
    shownResources,
} from './game_data/resources';
export { MANIFEST_FILE, assembleSource, listedFiles } from './game_data/source';
export type { SourceInfo, SourceOnDisk } from './game_data/source';
export { SCHEMA_FILES, jsonSchemas } from './game_data/json_schema';

export {
    BUILT_IN_SCOPES,
    FIELD_SCOPES,
    checkExpression,
    tagId,
} from './expressions/checker';
export type {
    BuiltInScope,
    CheckResult,
    CompiledExpression,
    ExpressionField,
    ExpressionType,
    ExpressionVocabulary,
    ReferenceKind,
    ResolvedReference,
} from './expressions/checker';
export {
    evaluate,
    evaluateCondition,
    evaluateNumber,
    EvaluationError,
} from './expressions/evaluator';
export type {
    ConditionResult,
    EvaluationContext,
    ScopeView,
    Value,
} from './expressions/evaluator';
export {
    ExpressionSyntaxError,
    formatDiagnostic,
    closest,
    didYouMean,
} from './expressions/diagnostics';
export type { Diagnostic, Severity } from './expressions/diagnostics';
export { highlight } from './expressions/highlight';
export type { HighlightKind, Segment } from './expressions/highlight';
