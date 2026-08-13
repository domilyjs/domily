// src/index.ts
function createCodecRegistry() {
  const codecsById = new Map;
  const codecsByExtension = new Map;
  const codecsByMediaType = new Map;
  return {
    register(codec) {
      if (codecsById.has(codec.id)) {
        throw new Error(`A document codec with id "${codec.id}" is already registered.`);
      }
      codecsById.set(codec.id, codec);
      for (const extension of codec.extensions) {
        codecsByExtension.set(normalizeExtension(extension), codec);
      }
      for (const mediaType of codec.mediaTypes) {
        codecsByMediaType.set(mediaType.toLowerCase(), codec);
      }
    },
    byExtension(extension) {
      return codecsByExtension.get(normalizeExtension(extension));
    },
    byId(id) {
      return codecsById.get(id);
    },
    byMediaType(mediaType) {
      return codecsByMediaType.get(mediaType.toLowerCase());
    }
  };
}
function normalizeExtension(extension) {
  return extension.startsWith(".") ? extension.slice(1).toLowerCase() : extension.toLowerCase();
}
function freezeDocument(document) {
  return deepFreeze(document);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}
export {
  freezeDocument,
  createCodecRegistry
};
