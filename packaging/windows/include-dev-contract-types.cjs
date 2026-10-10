/* global module */
// Preserve only the seven declared public contract type files. electron-builder
// otherwise drops .d.ts by default despite their exact staged-manifest roles.
module.exports = (file) =>
  /(?:^|[/\\])node_modules[/\\]@aijian[/\\]contracts[/\\](?:generated|artifact-proposal|invalidation-operation|chatgpt-auth|official-text|official-director|shot-plan)\.d\.ts$/.test(
    file,
  );
