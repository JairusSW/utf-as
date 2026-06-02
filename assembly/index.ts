// Package root for `utf-as`. Re-exports the public API so consumers can
// `import { UTF8, UTF16 } from "utf-as"`. Validation is on the namespaces
// (`UTF8.validate` / `UTF16.validate`). See `utf/index.ts` for the full
// contract.

export {
  UTF8,
  UTF16,
  utf16_length_from_utf8,
  utf8_length_from_utf16,
} from "./utf/index";
