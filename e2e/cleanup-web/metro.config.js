// Harness only, web: the app's own code from the parent folder, no module swapped.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const appRoot = path.resolve(__dirname, "..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [appRoot];
config.resolver.nodeModulesPaths = [path.join(appRoot, "node_modules")];
module.exports = config;
