import { type CodecResult, type Document, type DocumentCodec } from '@domily/next-ast';
export declare const jsonDocumentCodec: DocumentCodec;
export declare function parseJsonDocument(input: string): CodecResult<Document>;
export declare function serializeJsonDocument(document: Document): CodecResult<string>;
