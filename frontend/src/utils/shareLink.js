export function getCurrentShareUrl() {
  return window.location.href;
}

function copyWithFallbackTextarea(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('Copy command was not successful.');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function copyCurrentShareUrl() {
  const url = getCurrentShareUrl();

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return url;
  }

  copyWithFallbackTextarea(url);
  return url;
}
