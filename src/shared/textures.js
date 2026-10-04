// Shared by the main process (export / preview) and the renderer (code view).
// Games reference generated textures as `texture://<name>`; before a game is
// previewed or exported those references are swapped for inline data URLs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GamebudTextures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const REF = /texture:\/\/([a-z0-9][a-z0-9-]*)/g;
  // 1x1 transparent GIF, used when a game points at a texture that was deleted.
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  function inlineTextures(html, dataUrlsByName) {
    return String(html).replace(REF, (_, name) => dataUrlsByName[name] || BLANK);
  }

  function slugify(text, taken) {
    const base =
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join('-')
        .slice(0, 24)
        .replace(/-+$/, '') || 'texture';
    let name = base;
    let n = 2;
    while (taken.has(name)) name = `${base}-${n++}`;
    return name;
  }

  return { inlineTextures, slugify, BLANK };
});
