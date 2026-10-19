const { createSignedConfig } = require('./scripts/windows-signing.cjs');
module.exports = createSignedConfig(process.env);
