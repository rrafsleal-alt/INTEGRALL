import {createHash} from 'node:crypto';
import {cleanText} from './catalog.js';

export const IMAGE_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 8000;
export const IMAGE_MAX_PIXELS = 40_000_000;
export const IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

export class ImageUploadError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const removablePngChunks = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
const jpegSofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function invalid(code, message, status = 400) {
  throw new ImageUploadError(status, code, message);
}

function validateDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    invalid('IMAGE_DIMENSIONS_INVALID', 'Não foi possível validar as dimensões da imagem.');
  }
  if (width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE || width * height > IMAGE_MAX_PIXELS) {
    invalid('IMAGE_DIMENSIONS_EXCEEDED', `A imagem excede o limite de ${IMAGE_MAX_SIDE}px por lado ou ${IMAGE_MAX_PIXELS.toLocaleString('pt-BR')} pixels.`, 413);
  }
}

function sanitizePng(input) {
  if (input.length < 33 || !input.subarray(0, 8).equals(pngSignature)) invalid('IMAGE_SIGNATURE_MISMATCH', 'O conteúdo não é um PNG válido.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  const output = [pngSignature];

  while (offset < input.length) {
    if (offset + 12 > input.length) invalid('IMAGE_CORRUPTED', 'O PNG está truncado.');
    const length = input.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (length > IMAGE_UPLOAD_LIMIT_BYTES || chunkEnd > input.length) invalid('IMAGE_CORRUPTED', 'O PNG contém um bloco inválido.');
    const typeBuffer = input.subarray(typeStart, dataStart);
    const type = typeBuffer.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) invalid('IMAGE_CORRUPTED', 'O PNG contém um tipo de bloco inválido.');
    const expectedCrc = input.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([typeBuffer, input.subarray(dataStart, dataEnd)]));
    if (expectedCrc !== actualCrc) invalid('IMAGE_CORRUPTED', `O PNG falhou na verificação de integridade do bloco ${type}.`);

    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) invalid('IMAGE_CORRUPTED', 'O PNG não começa com um cabeçalho IHDR válido.');
      width = input.readUInt32BE(dataStart);
      height = input.readUInt32BE(dataStart + 4);
      if (input[dataStart + 10] !== 0 || input[dataStart + 11] !== 0 || input[dataStart + 12] > 1) invalid('IMAGE_CORRUPTED', 'O PNG usa parâmetros de compressão incompatíveis.');
      sawIhdr = true;
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (length !== 0) invalid('IMAGE_CORRUPTED', 'O bloco IEND do PNG é inválido.');
      sawIend = true;
    }

    if (!removablePngChunks.has(type)) output.push(input.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (sawIend) break;
  }
  if (!sawIhdr || !sawIdat || !sawIend || offset !== input.length) invalid('IMAGE_CORRUPTED', 'O PNG está incompleto ou possui dados anexados.');
  validateDimensions(width, height);
  return {mimeType: 'image/png', width, height, data: Buffer.concat(output)};
}

function sanitizeJpeg(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) invalid('IMAGE_SIGNATURE_MISMATCH', 'O conteúdo não é um JPEG válido.');
  if (input[input.length - 2] !== 0xff || input[input.length - 1] !== 0xd9) invalid('IMAGE_CORRUPTED', 'O JPEG está incompleto.');
  const output = [input.subarray(0, 2)];
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;

  while (offset < input.length - 2) {
    if (input[offset] !== 0xff) invalid('IMAGE_CORRUPTED', 'O JPEG contém dados inválidos antes da imagem.');
    const segmentStart = offset;
    while (input[offset] === 0xff) offset += 1;
    if (offset >= input.length) invalid('IMAGE_CORRUPTED', 'O JPEG está truncado.');
    const marker = input[offset];
    offset += 1;
    if (marker === 0x00 || marker === 0xd8) invalid('IMAGE_CORRUPTED', 'O JPEG contém um marcador inválido.');
    if (marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      output.push(input.subarray(segmentStart, offset));
      continue;
    }
    if (offset + 2 > input.length) invalid('IMAGE_CORRUPTED', 'O JPEG está truncado.');
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) invalid('IMAGE_CORRUPTED', 'O JPEG contém um segmento inválido.');
    const segmentEnd = offset + length;

    if (jpegSofMarkers.has(marker)) {
      if (length < 7) invalid('IMAGE_CORRUPTED', 'O JPEG possui cabeçalho de dimensões inválido.');
      height = input.readUInt16BE(offset + 3);
      width = input.readUInt16BE(offset + 5);
    }

    if (marker === 0xda) {
      output.push(input.subarray(segmentStart));
      sawScan = true;
      offset = input.length;
      break;
    }

    // APP1 contém EXIF/XMP; APP13 e COM também são metadados desnecessários.
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) output.push(input.subarray(segmentStart, segmentEnd));
    offset = segmentEnd;
  }
  if (!sawScan || !width || !height) invalid('IMAGE_CORRUPTED', 'O JPEG não contém uma imagem decodificável.');
  validateDimensions(width, height);
  return {mimeType: 'image/jpeg', width, height, data: Buffer.concat(output)};
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function webpDimensions(type, payload) {
  if (type === 'VP8X' && payload.length >= 10) {
    return {width: readUInt24LE(payload, 4) + 1, height: readUInt24LE(payload, 7) + 1};
  }
  if (type === 'VP8 ' && payload.length >= 10 && payload[3] === 0x9d && payload[4] === 0x01 && payload[5] === 0x2a) {
    return {width: payload.readUInt16LE(6) & 0x3fff, height: payload.readUInt16LE(8) & 0x3fff};
  }
  if (type === 'VP8L' && payload.length >= 5 && payload[0] === 0x2f) {
    return {
      width: 1 + payload[1] + ((payload[2] & 0x3f) << 8),
      height: 1 + (payload[2] >> 6) + (payload[3] << 2) + ((payload[4] & 0x0f) << 10)
    };
  }
  return null;
}

// Structural validation of the RIFF container and every image/frame header.
// This is not a full VP8 entropy decoder. See docs/revisao-cliente for scope.
function webpBitstreamDimensions(type, payload) {
  const dimensions = webpDimensions(type, payload);
  if (!dimensions || (type === 'VP8L' && (payload.length <= 5 || (payload[4] & 0xe0)))
    || (type === 'VP8 ' && (payload.length <= 10 || (payload[0] & 1)))) {
    invalid('IMAGE_CORRUPTED', 'O WebP contém dados de imagem incompletos ou inválidos.');
  }
  validateDimensions(dimensions.width, dimensions.height);
  return dimensions;
}

function validateWebpFrame(payload, canvas) {
  if (!canvas || payload.length < 24) invalid('IMAGE_CORRUPTED', 'O quadro WebP está incompleto.');
  const x = readUInt24LE(payload, 0) * 2;
  const y = readUInt24LE(payload, 3) * 2;
  const width = readUInt24LE(payload, 6) + 1;
  const height = readUInt24LE(payload, 9) + 1;
  validateDimensions(width, height);
  if (x + width > canvas.width || y + height > canvas.height) invalid('IMAGE_CORRUPTED', 'O quadro WebP excede o canvas.');
  let offset = 16, images = 0;
  while (offset < payload.length) {
    if (offset + 8 > payload.length) invalid('IMAGE_CORRUPTED', 'O quadro WebP está truncado.');
    const type = payload.toString('ascii', offset, offset + 4);
    const size = payload.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    const paddedEnd = end + (size & 1);
    if (paddedEnd > payload.length) invalid('IMAGE_CORRUPTED', 'O quadro WebP contém um bloco inválido.');
    if (type === 'VP8 ' || type === 'VP8L') {
      const dimensions = webpBitstreamDimensions(type, payload.subarray(offset + 8, end));
      if (++images > 1 || dimensions.width !== width || dimensions.height !== height) {
        invalid('IMAGE_CORRUPTED', 'As dimensões do quadro WebP não correspondem à imagem.');
      }
    }
    offset = paddedEnd;
  }
  if (images !== 1) invalid('IMAGE_CORRUPTED', 'O quadro WebP não contém uma imagem.');
}

function sanitizeWebp(input) {
  if (input.length < 20 || input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WEBP') {
    invalid('IMAGE_SIGNATURE_MISMATCH', 'O conteúdo não é um WebP válido.');
  }
  if (input.readUInt32LE(4) + 8 !== input.length) invalid('IMAGE_CORRUPTED', 'O WebP possui tamanho RIFF inconsistente.');
  let offset = 12, dimensions = null, bitstream = null;
  let animation = false, sawAnim = false, frames = 0;
  const chunks = [];
  while (offset < input.length) {
    if (offset + 8 > input.length) invalid('IMAGE_CORRUPTED', 'O WebP está truncado.');
    const type = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const paddedEnd = dataEnd + (size & 1);
    if (size > IMAGE_UPLOAD_LIMIT_BYTES || paddedEnd > input.length) invalid('IMAGE_CORRUPTED', 'O WebP contém um bloco inválido.');
    const payload = Buffer.from(input.subarray(dataStart, dataEnd));
    if (type === 'VP8X') {
      if (offset !== 12 || payload.length !== 10) invalid('IMAGE_CORRUPTED', 'O cabeçalho WebP estendido é inválido.');
      dimensions = webpDimensions(type, payload);
      validateDimensions(dimensions.width, dimensions.height);
      animation = Boolean(payload[0] & 0x02);
      payload[0] &= ~0x0c; // EXIF/XMP chunks are removed below.
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (bitstream || animation) invalid('IMAGE_CORRUPTED', 'O WebP contém imagens incompatíveis com o container.');
      bitstream = webpBitstreamDimensions(type, payload);
      if (dimensions && (dimensions.width !== bitstream.width || dimensions.height !== bitstream.height)) {
        invalid('IMAGE_CORRUPTED', 'As dimensões WebP não correspondem ao canvas.');
      }
    } else if (type === 'ANIM') {
      if (!animation || sawAnim || payload.length !== 6) invalid('IMAGE_CORRUPTED', 'O cabeçalho de animação WebP é inválido.');
      sawAnim = true;
    } else if (type === 'ANMF') {
      if (!animation || !sawAnim) invalid('IMAGE_CORRUPTED', 'O quadro WebP não possui cabeçalho de animação.');
      validateWebpFrame(payload, dimensions); frames += 1;
    }
    if (type !== 'EXIF' && type !== 'XMP ') {
      const header = Buffer.alloc(8);
      header.write(type, 0, 4, 'ascii'); header.writeUInt32LE(payload.length, 4);
      chunks.push(header, payload);
      if (payload.length & 1) chunks.push(Buffer.from([0]));
    }
    offset = paddedEnd;
  }
  dimensions ||= bitstream;
  if (offset !== input.length || !dimensions || (animation ? !sawAnim || !frames : !bitstream)) {
    invalid('IMAGE_CORRUPTED', 'O WebP não contém uma imagem válida.');
  }
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8); header.write('RIFF', 0, 4, 'ascii'); header.writeUInt32LE(body.length, 4);
  return {mimeType: 'image/webp', ...dimensions, data: Buffer.concat([header, body])};
}

export function detectImageMime(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature)) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

export function validateAndSanitizeImage({data, declaredMime = '', filename = '', altText = '', purpose = 'product'} = {}) {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (!input.length) invalid('IMAGE_EMPTY', 'A imagem está vazia.');
  if (input.length > IMAGE_UPLOAD_LIMIT_BYTES) invalid('IMAGE_TOO_LARGE', 'A imagem excede o limite de 10 MB.', 413);
  const detectedMime = detectImageMime(input);
  if (!detectedMime || !IMAGE_MIME_TYPES.includes(detectedMime)) invalid('IMAGE_TYPE_NOT_ALLOWED', 'Use uma imagem JPG, PNG ou WebP.');
  const normalizedDeclared = String(declaredMime || '').split(';')[0].trim().toLowerCase();
  if (normalizedDeclared && normalizedDeclared !== 'application/octet-stream' && normalizedDeclared !== detectedMime) {
    invalid('IMAGE_MIME_MISMATCH', 'O conteúdo do arquivo não corresponde ao tipo informado.');
  }
  const parsed = detectedMime === 'image/png' ? sanitizePng(input) : detectedMime === 'image/jpeg' ? sanitizeJpeg(input) : sanitizeWebp(input);
  return {
    ...parsed,
    size: parsed.data.length,
    checksum: createHash('sha256').update(parsed.data).digest('hex'),
    originalName: cleanText(filename, 180),
    altText: cleanText(altText, 300),
    purpose: cleanText(purpose, 60) || 'product'
  };
}

function parseDisposition(value) {
  const result = {};
  for (const part of String(value || '').split(';').map(item => item.trim())) {
    const index = part.indexOf('=');
    if (index < 0) { if (!result.type) result.type = part.toLowerCase(); continue; }
    const key = part.slice(0, index).trim().toLowerCase();
    let val = part.slice(index + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    result[key] = val;
  }
  return result;
}

export function parseMultipartBody(body, contentType) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  if (!buffer.length) invalid('UPLOAD_BODY_EMPTY', 'Nenhum arquivo foi enviado.');
  if (buffer.length > IMAGE_UPLOAD_LIMIT_BYTES + 256 * 1024) invalid('UPLOAD_BODY_TOO_LARGE', 'O envio excede o limite permitido.', 413);
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2] || '';
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) invalid('MULTIPART_BOUNDARY_INVALID', 'O formulário de upload é inválido.');
  const opening = Buffer.from(`--${boundary}\r\n`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  if (!buffer.subarray(0, opening.length).equals(opening)) invalid('MULTIPART_INVALID', 'O formulário multipart está malformado.');

  const fields = {};
  let file = null;
  let offset = opening.length;
  let parts = 0;
  while (offset < buffer.length) {
    parts += 1;
    if (parts > 12) invalid('MULTIPART_TOO_MANY_PARTS', 'O upload contém campos demais.');
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), offset);
    if (headerEnd < 0 || headerEnd - offset > 16_384) invalid('MULTIPART_HEADERS_INVALID', 'Os cabeçalhos do upload são inválidos.');
    const headers = new Map();
    for (const line of buffer.toString('utf8', offset, headerEnd).split('\r\n')) {
      const index = line.indexOf(':');
      if (index <= 0) invalid('MULTIPART_HEADERS_INVALID', 'Os cabeçalhos do upload são inválidos.');
      headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
    }
    const disposition = parseDisposition(headers.get('content-disposition'));
    if (disposition.type !== 'form-data' || !disposition.name) invalid('MULTIPART_DISPOSITION_INVALID', 'O campo de upload é inválido.');
    const contentStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(delimiter, contentStart);
    if (nextBoundary < 0) invalid('MULTIPART_INVALID', 'O formulário multipart está incompleto.');
    const content = buffer.subarray(contentStart, nextBoundary);
    const name = cleanText(disposition.name, 80);
    if (disposition.filename !== undefined) {
      if (file) invalid('MULTIPART_MULTIPLE_FILES', 'Envie uma imagem por vez.');
      if (name !== 'file') invalid('MULTIPART_FILE_FIELD_INVALID', 'Use o campo de arquivo esperado.');
      file = {
        data: Buffer.from(content),
        filename: cleanText(disposition.filename, 180),
        declaredMime: String(headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      };
    } else {
      if (content.length > 4096) invalid('MULTIPART_FIELD_TOO_LARGE', 'Um campo textual do upload excede o limite.');
      if (['alt', 'purpose'].includes(name)) fields[name] = content.toString('utf8');
    }
    offset = nextBoundary + delimiter.length;
    if (buffer.subarray(offset, offset + 2).toString() === '--') {
      offset += 2;
      if (buffer.subarray(offset, offset + 2).toString() === '\r\n') offset += 2;
      if (offset !== buffer.length) invalid('MULTIPART_TRAILING_DATA', 'O upload possui dados adicionais inválidos.');
      break;
    }
    if (buffer.subarray(offset, offset + 2).toString() !== '\r\n') invalid('MULTIPART_INVALID', 'O formulário multipart está malformado.');
    offset += 2;
  }
  if (!file) invalid('UPLOAD_FILE_REQUIRED', 'Selecione uma imagem para enviar.');
  return {...file, altText: fields.alt || '', purpose: fields.purpose || 'product'};
}

export function decodeLegacyDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value || ''));
  if (!match) invalid('IMAGE_DATA_URL_INVALID', 'Formato de imagem inválido. Use JPG, PNG ou WebP.');
  let data;
  try { data = Buffer.from(match[2].replace(/\s/g, ''), 'base64'); } catch { invalid('IMAGE_DATA_URL_INVALID', 'A imagem em base64 é inválida.'); }
  return {data, declaredMime: match[1].toLowerCase(), filename: '', altText: '', purpose: 'product'};
}

export function mediaIdFromUrl(value) {
  const match = /^\/media\/(?:products\/)?([A-Za-z0-9-]{10,160})$/.exec(String(value || '').trim());
  return match ? match[1] : '';
}
