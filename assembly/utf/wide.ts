/** Optional 256/512-bit Wide UTF validation and length kernels. */
export { validateWide256, validateWide512 } from "./wide_validate";
export { validateUtf16Wide256, validateUtf16Wide512 } from "./wide_validate_utf16";
export {
  utf16LengthWide256, utf16LengthWide512,
  utf8LengthWide256, utf8LengthWide512,
} from "./wide_length";
