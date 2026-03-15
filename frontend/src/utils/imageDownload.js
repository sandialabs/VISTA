/**
 * Download an image by trying multiple API endpoints.
 *
 * @param {string} imageId - the image UUID
 * @param {string} filename - suggested filename (from image.filename or fallback)
 */
async function downloadImage(imageId, filename) {
  const endpoints = [
    `/api/images/${imageId}/content`,
    `/api/images/${imageId}/download`,
  ];

  let imageBlob = null;
  let resolvedFilename = filename || `image-${imageId}`;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        const jsonData = await response.json();
        if (jsonData.url) {
          const imageResponse = await fetch(jsonData.url);
          if (imageResponse.ok) {
            const blobContentType = imageResponse.headers.get('content-type');
            if (blobContentType && blobContentType.startsWith('image/')) {
              imageBlob = await imageResponse.blob();
              break;
            }
          }
        }
      } else if (contentType && contentType.startsWith('image/')) {
        imageBlob = await response.blob();
        break;
      }
    } catch (endpointError) {
      console.error('Error with endpoint %s:', endpoint, endpointError);
      continue;
    }
  }

  if (!imageBlob) {
    throw new Error('Unable to download image from any available endpoint');
  }

  // Ensure we have the right file extension
  if (!resolvedFilename.includes('.') && imageBlob.type) {
    const extension = imageBlob.type.split('/')[1];
    if (extension && extension !== 'jpeg') {
      resolvedFilename = `${resolvedFilename}.${extension}`;
    } else if (extension === 'jpeg') {
      resolvedFilename = `${resolvedFilename}.jpg`;
    }
  }

  // Create a URL for the blob and trigger download
  const blobUrl = window.URL.createObjectURL(imageBlob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = resolvedFilename;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.URL.revokeObjectURL(blobUrl);
}

export default downloadImage;
