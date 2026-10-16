/* eslint-env worker */
/* eslint-disable no-restricted-globals */
import { handleSplatAssetMessage } from './pt3SplatAssetParser';

self.onmessage = (event) => handleSplatAssetMessage(event.data, {
  fetchImpl: (url) => fetch(url),
  postMessage: (message, transfer) => self.postMessage(message, transfer),
});
