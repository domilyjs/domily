# @domily/next-codec-toon

Experimental TOON source codec for Domily Next PageSpec documents. It uses the fixed official
`@toon-format/toon@4.1.1` decoder and produces only generic JSON-compatible data; PageSpec semantics
remain in `normalizePageSpec()`.

```ts
import { createToonSourceCodecRegistry } from '@domily/next-codec-toon';
import domilyNext from '@domily/next-vite-plugin';

export default {
  plugins: [domilyNext({ codecs: createToonSourceCodecRegistry() })],
};
```

The codec handles `.dmy.toon`, codec id `toon`, media type `text/toon`, and text payloads only. Its
envelope-facing adapter version is `1.0.0`; it is independent from the TOON specification version.

TOON remains experimental: specification 4.1 is a Working Draft and the official decoder does not expose
token ranges, so this release provides only a `toon:` document-level SourceMap node. Keep JSON as the
fallback representation for generated or delivered pages.
