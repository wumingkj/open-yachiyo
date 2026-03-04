(function initChatImageUtils(globalScope) {
  function extensionFromMimeType(mimeType) {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/gif') return 'gif';
    if (normalized === 'image/bmp') return 'bmp';
    if (normalized === 'image/avif') return 'avif';
    return 'img';
  }

  function buildSessionImageUrl(sessionId, clientId, mimeType) {
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedSessionId || !normalizedClientId) {
      return '';
    }
    const ext = extensionFromMimeType(mimeType);
    return `/api/session-images/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(`${normalizedClientId}.${ext}`)}`;
  }

  function normalizeServerMessageImages(rawMessage, sessionId) {
    const rawImages = rawMessage?.metadata?.input_images;
    if (!Array.isArray(rawImages) || rawImages.length === 0) {
      return [];
    }

    return rawImages
      .filter((image) => image && typeof image === 'object' && !Array.isArray(image))
      .map((image, index) => {
        const name = typeof image.name === 'string' && image.name.trim()
          ? image.name.trim()
          : `image-${index + 1}`;
        const mimeType = typeof image.mime_type === 'string' && image.mime_type.trim()
          ? image.mime_type.trim()
          : 'image/*';
        const sizeBytes = Math.max(0, Number(image.size_bytes) || 0);
        const clientId = typeof image.client_id === 'string' ? image.client_id.trim() : '';
        const sourceUrl = typeof image.url === 'string' ? image.url.trim() : '';
        const previewUrl = sourceUrl || buildSessionImageUrl(sessionId, clientId, mimeType);

        return {
          name,
          mimeType,
          sizeBytes,
          previewUrl,
          clientId,
          url: sourceUrl
        };
      });
  }

  function extractImageFilesFromPasteEvent(event) {
    const clipboardItems = Array.from(event?.clipboardData?.items || []);
    return clipboardItems
      .filter((item) => item?.kind === 'file' && String(item.type || '').startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }

  const api = {
    extensionFromMimeType,
    buildSessionImageUrl,
    normalizeServerMessageImages,
    extractImageFilesFromPasteEvent
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope && typeof globalScope === 'object') {
    globalScope.ChatImageUtils = api;
  }
}(typeof window !== 'undefined' ? window : globalThis));
