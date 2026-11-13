import {existsSync, realpathSync} from 'node:fs';
import path from 'node:path';

// Website and clients are versioned in the same commit. Never clone a second
// application during a build, including when the local source is incomplete.
export function resolvePinnedClientSource(root, source, override = process.env.HIKING_CLIENT_ROOT) {
 const folder = path.resolve(root, source?.path || 'clients');
 if (folder !== path.join(path.resolve(root), 'clients')) throw new Error('Client source must be the in-repository clients directory');
 if (override && realpathSync(path.resolve(override)) !== realpathSync(folder)) throw new Error('External client checkouts are disabled; edit clients/ in this repository');
 if (!existsSync(path.join(folder, 'app/package.json')) || !existsSync(path.join(folder, 'shared/design/palette.json'))) throw new Error('Unified client source is missing; restore clients/ from this repository');
 return folder;
}

export function resolveLocalClientPreviewSource(root, source, previewRoot = process.env.HIKING_CLIENT_PREVIEW_ROOT) {
 if (process.env.HIKING_CLIENT_PREVIEW !== '1') throw new Error('Local client preview requires HIKING_CLIENT_PREVIEW=1');
 if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') throw new Error('Local client preview is disabled in CI and GitHub Actions');
 return resolvePinnedClientSource(root, source, previewRoot);
}
