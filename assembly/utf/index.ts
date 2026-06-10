// Public API: drop-in for stdlib `String.UTF8` / `String.UTF16`. The surface is
// exactly the two namespaces. Validation lives on them (`UTF8.validate` /
// `UTF8.validateUnsafe` and the UTF-16 equivalents) and length pre-counting on
// `UTF8.utf16Length` / `UTF8.byteLength`; the standalone helpers in `length.ts`
// stay internal. SIMD kernels are reached only through the namespaces, behind an
// `ASC_FEATURE_SIMD` guard, so they dead-code-eliminate with `--disable simd`.
// See `utf8.ts` for the permissive-decode contract.

export { UTF8 } from "./utf8";
export { UTF16 } from "./utf16";
