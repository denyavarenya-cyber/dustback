// Harness only: serve the app's own cleanup screen, with the wallet module
// replaced by the devnet test wallet bridge. Nothing here ships.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const appRoot = path.resolve(__dirname, '..');
const cleanupDir = path.join(appRoot, 'src', 'features', 'cleanup');
const bridgeWallet = path.join(__dirname, 'bridgeWallet.ts');

const config = getDefaultConfig(__dirname);
config.watchFolders = [appRoot];
config.resolver.nodeModulesPaths = [path.join(appRoot, 'node_modules')];
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === './wallet' && path.dirname(context.originModulePath) === cleanupDir) {
    return { type: 'sourceFile', filePath: bridgeWallet };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
