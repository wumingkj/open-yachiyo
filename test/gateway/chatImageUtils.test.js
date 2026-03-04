const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extensionFromMimeType,
  buildSessionImageUrl,
  normalizeServerMessageImages,
  extractImageFilesFromPasteEvent
} = require('../../apps/gateway/public/chatImageUtils');

test('extensionFromMimeType maps known image mime types', () => {
  assert.equal(extensionFromMimeType('image/png'), 'png');
  assert.equal(extensionFromMimeType('image/jpeg'), 'jpg');
  assert.equal(extensionFromMimeType('image/webp'), 'webp');
  assert.equal(extensionFromMimeType('application/octet-stream'), 'img');
});

test('buildSessionImageUrl returns encoded session image API URL', () => {
  const url = buildSessionImageUrl('session 1', 'img-1', 'image/png');
  assert.equal(url, '/api/session-images/session%201/img-1.png');
});

test('normalizeServerMessageImages maps metadata.input_images and prioritizes image.url', () => {
  const images = normalizeServerMessageImages({
    metadata: {
      input_images: [
        {
          client_id: 'img-1',
          name: 'from-url.png',
          mime_type: 'image/png',
          size_bytes: 123,
          url: '/api/session-images/s-a/from-url.png'
        },
        {
          client_id: 'img-2',
          name: 'fallback.webp',
          mime_type: 'image/webp',
          size_bytes: 456
        }
      ]
    }
  }, 's-a');

  assert.equal(images.length, 2);
  assert.equal(images[0].previewUrl, '/api/session-images/s-a/from-url.png');
  assert.equal(images[1].previewUrl, '/api/session-images/s-a/img-2.webp');
  assert.equal(images[1].clientId, 'img-2');
});

test('extractImageFilesFromPasteEvent keeps image files only', () => {
  const pngFile = { name: 'clip.png', type: 'image/png' };
  const txtFile = { name: 'note.txt', type: 'text/plain' };

  const result = extractImageFilesFromPasteEvent({
    clipboardData: {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'text/plain', getAsFile: () => txtFile },
        { kind: 'file', type: 'image/png', getAsFile: () => pngFile }
      ]
    }
  });

  assert.deepEqual(result, [pngFile]);
});
