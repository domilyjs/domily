import {
  DomilyApp as DomilyAppClass,
  DomilyAppError as DomilyAppErrorClass,
  createDomilyApp as createApp,
  defineCapabilities as defineAppCapabilities,
} from './app.ts';
import {
  createCodecRegistry as createRegistry,
  freezeDocument as freeze,
} from './codec/index.ts';
import { createMvpDomRegistry as createRegistryForDom } from './renderer-dom/index.ts';
import { validateDocument as validate } from './validator/index.ts';

export const DomilyApp = DomilyAppClass;
export const DomilyAppError = DomilyAppErrorClass;
export const createDomilyApp = createApp;
export const defineCapabilities = defineAppCapabilities;
export const createCodecRegistry = createRegistry;
export const freezeDocument = freeze;
export const createMvpDomRegistry = createRegistryForDom;
export const validateDocument = validate;

export type DomilyAppInstance = import('./app.ts').DomilyApp;

export type {
  DomilyAppOptions,
  DomilyCapabilities,
  DomilyCapabilityContext,
  DomilyCapabilityDefinition,
  DomilyCapabilityHandler,
  DomilyMountTarget,
} from './app.ts';

export type {
  ActionNode,
  CallActionNode,
  CodecIssue,
  CodecRegistry,
  CodecResult,
  Document,
  DocumentCodec,
  DocumentCodecWithSourceMap,
  ElementViewNode,
  ExpressionNode,
  JsonValue,
  NodeOrigins,
  ObjectNode,
  SourceLocation,
  SourceMap,
  SourceMappedDocument,
  SourceNodeId,
  SourceRange,
  ValueNode,
  ViewNode,
} from './codec/index.ts';

export type { DomComponentRegistry } from './renderer-dom/index.ts';
