import { DEFAULT_RUNTIME_LOAD_PATH, type PolicyOperationKind } from '@zenstackhq/runtime';
import { PluginGlobalOptions } from '@zenstackhq/sdk';
import fs from 'fs';
import path from 'path';

export const ALL_OPERATION_KINDS: PolicyOperationKind[] = ['create', 'update', 'postUpdate', 'read', 'delete'];

/**
 * Gets the nearest "node_modules" folder by walking up from start path.
 */
export function getNodeModulesFolder(startPath?: string): string | undefined {
    startPath = startPath ?? process.cwd();
    if (startPath.endsWith('node_modules')) {
        return startPath;
    } else if (fs.existsSync(path.join(startPath, 'node_modules'))) {
        return path.join(startPath, 'node_modules');
    } else if (startPath !== '/') {
        const parent = path.join(startPath, '..');
        return getNodeModulesFolder(parent);
    } else {
        return undefined;
    }
}

/**
 * Gets the default node_modules/.zenstack output folder for plugins.
 * @returns
 */
export function getDefaultOutputFolder(globalOptions?: PluginGlobalOptions) {
    if (typeof globalOptions?.output === 'string') {
        return path.resolve(globalOptions.output);
    }

    // Find the real runtime module path, it might be a symlink in pnpm
    let runtimeModulePath = require.resolve('@zenstackhq/runtime');

    if (process.env.ZENSTACK_TEST === '1') {
        // handling the case when running as tests, resolve relative to CWD
        runtimeModulePath = path.resolve(path.join(process.cwd(), 'node_modules', '@zenstackhq', 'runtime'));
    }

    if (runtimeModulePath) {
        // start with the parent folder of @zenstackhq, supposed to be a node_modules folder
        while (!runtimeModulePath.endsWith('@zenstackhq') && runtimeModulePath !== '/') {
            runtimeModulePath = path.join(runtimeModulePath, '..');
        }
        runtimeModulePath = path.join(runtimeModulePath, '..');
    }
    const modulesFolder = getNodeModulesFolder(runtimeModulePath);
    return modulesFolder ? path.join(modulesFolder, DEFAULT_RUNTIME_LOAD_PATH) : undefined;
}
