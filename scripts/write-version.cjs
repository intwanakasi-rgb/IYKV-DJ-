const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const metadata = { name:'IYK DeckLab', version:pkg.version, owner:'Intwana Yase Kasi', build:process.env.GITHUB_SHA?.slice(0,7) || 'local', builtAt:new Date().toISOString(), downloads:require('../download-stats.json') };
fs.writeFileSync(path.join(__dirname,'../app-version.js'), `// Generated from package.json by scripts/write-version.cjs.\nwindow.DECKLAB_BUILD = Object.freeze(${JSON.stringify(metadata)});\n`);
console.log(`IYK DeckLab version ${pkg.version}`);
