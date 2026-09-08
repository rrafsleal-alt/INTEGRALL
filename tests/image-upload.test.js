import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeLegacyDataUrl, detectImageMime, ImageUploadError, parseMultipartBody, validateAndSanitizeImage} from '../src/image-upload.js';

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC';
const tinyPng = Buffer.from(tinyPngBase64, 'base64');

function multipart(boundary, file, {mime = 'image/png', filename = 'foto.png', alt = 'Foto do produto', purpose = 'product'} = {}) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\n${alt}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
}

test('PNG válido tem assinatura, dimensão, checksum e metadados controlados', () => {
  const result = validateAndSanitizeImage({data: tinyPng, declaredMime: 'image/png', filename: '../foto.png', altText: '  Produto  '});
  assert.equal(detectImageMime(result.data), 'image/png');
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.equal(result.altText, 'Produto');
  assert.equal(result.checksum.length, 64);
});

test('MIME falso e arquivo corrompido são recusados', () => {
  assert.throws(() => validateAndSanitizeImage({data: tinyPng, declaredMime: 'image/jpeg'}), error => error instanceof ImageUploadError && error.code === 'IMAGE_MIME_MISMATCH');
  const corrupted = Buffer.from(tinyPng);
  corrupted[corrupted.length - 6] ^= 0xff;
  assert.throws(() => validateAndSanitizeImage({data: corrupted, declaredMime: 'image/png'}), error => error instanceof ImageUploadError && error.code === 'IMAGE_CORRUPTED');
  assert.throws(() => validateAndSanitizeImage({data: Buffer.from('#!/bin/sh\necho pwn'), declaredMime: 'image/png'}), /JPG, PNG ou WebP/);
});

test('multipart extrai um arquivo real e campos auxiliares', () => {
  const boundary = '----integrall-test-boundary';
  const parsed = parseMultipartBody(multipart(boundary, tinyPng), `multipart/form-data; boundary=${boundary}`);
  assert.equal(parsed.filename, 'foto.png');
  assert.equal(parsed.declaredMime, 'image/png');
  assert.equal(parsed.altText, 'Foto do produto');
  assert.equal(parsed.purpose, 'product');
  assert.deepEqual(parsed.data, tinyPng);
});

test('data URL antiga permanece migrável, mas passa pela mesma validação', () => {
  const parsed = decodeLegacyDataUrl(`data:image/png;base64,${tinyPngBase64}`);
  const result = validateAndSanitizeImage(parsed);
  assert.equal(result.mimeType, 'image/png');
});
