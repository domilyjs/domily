import type { CodecIssue, Document } from '@domily/next-ast';
export interface ComponentDefinition {
    props: ReadonlySet<string>;
    events: ReadonlySet<string>;
}
export interface ComponentRegistry {
    get(name: string): ComponentDefinition | undefined;
}
export interface ValidationOptions {
    capabilities: ReadonlySet<string>;
    components: ComponentRegistry;
}
export type ValidationResult = {
    ok: true;
    issues: [];
} | {
    ok: false;
    issues: CodecIssue[];
};
export declare function createMvpHtmlRegistry(): ComponentRegistry;
export declare function validateDocument(document: Document, options: ValidationOptions): ValidationResult;
