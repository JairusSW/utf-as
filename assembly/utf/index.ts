// Public API: drop-in for stdlib `String.UTF8` / `String.UTF16`. Validation
// lives on the namespaces (`UTF8.validate` / `UTF8.validateUnsafe` and the
// UTF-16 equivalents); the standalone length pre-counters are also exposed.
// SIMD kernels are inlined into the namespace methods. See `utf8.ts` for the
// permissive-decode contract.

export { UTF8 } from "./utf8";
export { UTF16 } from "./utf16";
export { utf16_length_from_utf8, utf8_length_from_utf16 } from "./length";
