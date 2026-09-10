export type ProcessingErrorCode =
  | 'unsupported_type'
  | 'file_too_large'
  | 'too_many_pixels'
  | 'dimension_too_large'
  | 'animated_image'
  | 'decode_failed'
  | 'svg_unsafe'
  | 'svg_too_complex'
  | 'unsupported_feature'
  | 'render_failed'

export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode

  constructor(code: ProcessingErrorCode, message: string) {
    super(message)
    this.name = 'ProcessingError'
    this.code = code
  }
}

export function isProcessingError(error: unknown): error is ProcessingError {
  return error instanceof ProcessingError
}
