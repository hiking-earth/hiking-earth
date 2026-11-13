/** UI gate only: business APIs must still validate their own account session. */
export function readClientAuthMessage(event: MessageEvent, loginFrame: HTMLIFrameElement | null): boolean | null {
  if (event.origin !== window.location.origin || !event.source) return null;
  const data: unknown = event.data;
  if (!data || typeof data !== 'object') return null;
  const message = data as { type?: unknown; authenticated?: unknown };
  if (message.type !== 'hiking-earth-auth-state' || typeof message.authenticated !== 'boolean') return null;
  // Only the visible account frame may open the gate. Logout may also come
  // from a currently embedded business client, after the account frame unmounts.
  if (message.authenticated) return event.source === loginFrame?.contentWindow ? true : null;
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    if (frame.contentWindow !== event.source) continue;
    try {
      const url = new URL(frame.src, window.location.href);
      if (url.origin === window.location.origin && url.pathname === '/client-app/index.html') return false;
    } catch { return null; }
  }
  return null;
}
