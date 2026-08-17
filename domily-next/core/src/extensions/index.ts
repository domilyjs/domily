export {
  createPageExtensionRuntimeRegistry,
  extensionScopeContractsMatch,
  PageExtensionRuntimeRegistryError,
  scopeContractMatches,
} from './registry.ts';

export type {
  PageExtensionActivation,
  PageExtensionActivationContext,
  PageExtensionRuntimeAvailability,
  PageExtensionRuntimeAvailabilityEntry,
  PageExtensionRuntimeRegistry,
  PageExtensionRuntimeRegistrySnapshot,
  RegisteredPageExtensionRuntime,
  TrustedPageExtensionRuntime,
} from './types.ts';
