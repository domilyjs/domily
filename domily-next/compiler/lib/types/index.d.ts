import { type CodecResult, type Document } from '@domily/next-ast';
/**
 * Compiles the restricted, static `.domily.ts` author DSL into the protocol AST.
 * The compiler only reads a TypeScript syntax tree; it never executes author code.
 */
export declare function compileAuthorModule(source: string): CodecResult<Document>;
