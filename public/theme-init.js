/*
 * Runs before the first paint: index.html loads it as a blocking script right after the
 * theme-color meta. It applies the theme and accent the app mirrored to localStorage
 * (docs/SPEC.md §5.4 rule 9, §7), so the first frame already has the right colours:
 * - data-theme on <html>, only for an explicit "light" or "dark" ("system" leaves it unset);
 * - data-accent on <html>, "navy" unless a known accent is saved;
 * - the <html> background and the theme-color meta (the iOS status bar) for the resolved theme.
 * From then on the app's ThemeController keeps all four in step with the settings.
 *
 * Plain ES5 in one function scope: it is served as is, without a build step. The colours are
 * --bg of src/styles/tokens.css; src/features/pwa/platformFiles.test.tsx checks that they match.
 */
(function () {
  var LIGHT_BG = '#EDEEEA';
  var DARK_BG = '#0B1222';
  var ACCENTS = ['navy', 'royal', 'teal', 'bottle', 'burgundy', 'plum', 'cognac', 'graphite'];

  // Storage and media queries can throw (blocked site data, private modes, old engines): then the
  // defaults apply.
  function safely(read, fallback) {
    try {
      return read();
      // oxlint-disable-next-line no-unused-vars -- ES5 has no optional catch binding.
    } catch (error) {
      return fallback;
    }
  }

  var root = document.documentElement;
  var theme = safely(function () {
    return window.localStorage.getItem('onabudget:theme');
  }, null);
  var accent = safely(function () {
    return window.localStorage.getItem('onabudget:accent');
  }, null);

  var explicit = theme === 'light' || theme === 'dark';
  if (explicit) root.setAttribute('data-theme', theme);
  root.setAttribute('data-accent', ACCENTS.indexOf(accent) >= 0 ? accent : 'navy');

  var dark = explicit
    ? theme === 'dark'
    : safely(function () {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }, false);
  var bg = dark ? DARK_BG : LIGHT_BG;
  root.style.backgroundColor = bg;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
})();
