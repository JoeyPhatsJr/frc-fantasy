export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'frcf:theme';

/**
 * Runs inline in <head> before first paint: the saved choice, else light (Joey, 2026-09-30:
 * light by default, dark is a toggle; the device setting is not followed). Plain ES5 and
 * self-contained, because it is injected as a string. <html> also ships with data-theme="light"
 * from the server, so a visitor whose script doesn't run still gets light.
 */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement,t;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}d.dataset.theme=t==='dark'||t==='light'?t:'light'})();`;
