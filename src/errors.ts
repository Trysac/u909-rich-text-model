/**
 * Error codes produced by `@trysac/rich-text-model`.
 */
export type RichTextErrorCode =
  | "invalid_position"
  | "schema_violation"
  | "invalid_mark"
  | "input_too_large"
  | "invalid_doc";

const MAX_MESSAGE_LENGTH = 180;

function sanitizeMessage(msg: string): string {
  if (msg.length <= MAX_MESSAGE_LENGTH) {
    return msg;
  }
  return `${msg.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
}

/**
 * Base error class for all errors raised by `@trysac/rich-text-model`.
 */
export class RichTextError extends Error {
  /**
   * Stable machine-readable error code.
   */
  public readonly code: RichTextErrorCode;

  /**
   * Creates a new `RichTextError`.
   *
   * @param code - Stable error code.
   * @param message - Human-readable description (truncated to safe length).
   */
  public constructor(code: RichTextErrorCode, message: string) {
    super(sanitizeMessage(message));
    this.name = "RichTextError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
