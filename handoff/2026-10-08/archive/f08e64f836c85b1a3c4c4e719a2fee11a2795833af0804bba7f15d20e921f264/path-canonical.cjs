const fs = require("node:fs");

function canonical(file) {
  return fs.realpathSync.native(file).replaceAll("\\", "/").toLowerCase();
}

function within(file, directory) {
  return canonical(file).startsWith(`${canonical(directory)}/`);
}

module.exports = { canonical, within };
