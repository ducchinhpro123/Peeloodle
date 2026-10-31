/**
 * The pinned background-removal model (ISNet general-use, int8; see
 * `docs/assets-provenance.md`). A new model gets a new filename, hash and cache
 * name together.
 */
export const MODEL_VERSION = 'isnet-general-int8-v1';
export const MODEL_URL = `/models/cutout/${MODEL_VERSION}.onnx`;
export const MODEL_BYTES = 44_369_070;
export const MODEL_SHA256 = '1ee1bb467218d7e29490ca1b5d8051d26c083769208d1c4400a74a0c5d1967c6';
export const CACHE_NAME = 'cutout-isnet-v1';
/** The square input the network was exported at. */
export const MODEL_INPUT_SIZE = 1024;
