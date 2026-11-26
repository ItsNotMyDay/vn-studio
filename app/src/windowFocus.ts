let activeWindowId = 'main';

export function activateMainWindow() {
  activeWindowId = 'main';
}

export function activateFloatingWindow(id: string) {
  activeWindowId = id;
}

export function isMainWindowActive() {
  return activeWindowId === 'main';
}

export function isFloatingWindowActive(id: string) {
  return activeWindowId === id;
}
