'use strict';

// The one external library games may load. Pinned so the CSP can be exact:
// the preview allows scripts from this folder and nowhere else.
const THREE_VERSION = '0.186.1';
const THREE_BASE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`;

module.exports = { THREE_VERSION, THREE_BASE };
