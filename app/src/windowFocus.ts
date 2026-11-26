let activeWindowId = 'main';
let activationHistory: string[] = [];

export function activateMainWindow() {
  activeWindowId = 'main';
  activationHistory = [];
}

export function activateFloatingWindow(id: string) {
  if (activeWindowId === id) return;
  activationHistory = activationHistory.filter(previous => previous !== id);
  activationHistory.push(activeWindowId);
  activeWindowId = id;
}

export function closeFloatingWindow(id: string) {
  activationHistory = activationHistory.filter(previous => previous !== id);
  if (activeWindowId === id) {
    activeWindowId = activationHistory.pop() ?? 'main';
  }
}

export function isMainWindowActive() {
  return activeWindowId === 'main';
}

export function isFloatingWindowActive(id: string) {
  return activeWindowId === id;
}
