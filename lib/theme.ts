export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'frcf:theme';

/**
 * Runs inline in <head> before first paint: the saved choice, else the device setting.
 * Plain ES5 and self-contained, because it is injected as a string. Dark is the CSS default,
 * so if anything here throws the page is still readable.
 */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement,t;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}if(t!=='light'&&t!=='dark'){try{t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){t='dark'}}d.dataset.theme=t})();`;
