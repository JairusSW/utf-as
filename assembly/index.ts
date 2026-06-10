// Package root for `utf-as`. Re-exports the public API so consumers can
// `import { UTF8, UTF16 } from "utf-as"`. The package surface is exactly the
// two namespaces: validation lives on them (`UTF8.validate` / `UTF16.validate`)
// and length pre-counting on `UTF8.utf16Length` / `UTF8.byteLength`. Keeping the
// surface to these two means a consumer compiling with `--disable simd` pulls in
// no v128 code — every SIMD path is reachable only behind an `ASC_FEATURE_SIMD`
// guard and is dead-code-eliminated. See `utf/index.ts` for the full contract.

export { UTF8, UTF16 } from "./utf/index";
