const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const metadata = { name:'IYK DeckLab', version:pkg.version, owner:'Intwana Yase Kasi' };
fs.writeFileSync(path.join(__dirname,'../app-version.js'), `// Generated from package.json by scripts/write-version.cjs.\nwindow.DECKLAB_BUILD = Object.freeze(${JSON.stringify(metadata)});\n`);
console.log(`IYK DeckLab version ${pkg.version}`);
