const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const options = {
    branch: 'main',
    sitemapPath: 'build-recovery/sitemap.xml',
    maxRouteDropPercent: 20,
    maxRouteDropAbsolute: 150,
    requireContains: String(process.env.PUBLISH_REQUIRE_CONTAINS || '').trim(),
    allowDirty: false,
    skipRouteDropCheck: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--branch' && argv[i + 1]) {
      options.branch = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--sitemap-path' && argv[i + 1]) {
      options.sitemapPath = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--max-route-drop-percent' && argv[i + 1]) {
      options.maxRouteDropPercent = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--max-route-drop-absolute' && argv[i + 1]) {
      options.maxRouteDropAbsolute = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--require-contains' && argv[i + 1]) {
      options.requireContains = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--allow-dirty') {
      options.allowDirty = true;
      continue;
    }
    if (token === '--skip-route-drop-check') {
      options.skipRouteDropCheck = true;
    }
  }

  return options;
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function parseSitemapLocCount(xmlText) {
  const text = String(xmlText || '');
  const matches = text.match(/<loc>[^<]+<\/loc>/g);
  return matches ? matches.length : 0;
}

function fail(message) {
  console.error(`\n[prepublish-guard] BLOCKED: ${message}`);
  process.exit(1);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.join(__dirname, '..');
  const branchRef = `origin/${options.branch}`;

  try {
    runGit(['rev-parse', '--is-inside-work-tree'], root);
  } catch (error) {
    fail(`Not a git repository at ${root}.`);
  }

  try {
    runGit(['fetch', 'origin', options.branch], root);
  } catch (error) {
    fail(`Unable to fetch ${branchRef}. ${error.message}`);
  }

  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  if (currentBranch !== options.branch) {
    fail(`Current branch is "${currentBranch}" but publish branch is "${options.branch}".`);
  }

  const aheadBehind = runGit(['rev-list', '--left-right', '--count', `${branchRef}...HEAD`], root)
    .split(/\s+/)
    .map((value) => Number(value));
  const behindCount = Number.isFinite(aheadBehind[0]) ? aheadBehind[0] : 0;
  const aheadCount = Number.isFinite(aheadBehind[1]) ? aheadBehind[1] : 0;
  if (behindCount > 0) {
    fail(`Local branch is behind ${branchRef} by ${behindCount} commit(s). Pull/rebase before publishing.`);
  }

  if (options.requireContains) {
    const check = spawnSync('git', ['merge-base', '--is-ancestor', options.requireContains, 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    });
    if (check.status !== 0) {
      fail(`HEAD does not contain required commit ${options.requireContains}.`);
    }
  }

  if (!options.allowDirty) {
    const dirty = runGit(['status', '--porcelain'], root);
    if (dirty) {
      fail('Working tree is dirty. Commit or stash changes before publishing.');
    }
  }

  if (!options.skipRouteDropCheck) {
    const localSitemapPath = path.join(root, options.sitemapPath);
    if (!fs.existsSync(localSitemapPath)) {
      fail(`Sitemap missing at ${options.sitemapPath}. Build first so route checks can run.`);
    }

    const localXml = fs.readFileSync(localSitemapPath, 'utf8');
    const localCount = parseSitemapLocCount(localXml);
    if (localCount === 0) {
      fail(`Sitemap at ${options.sitemapPath} has zero routes.`);
    }

    let remoteXml = '';
    try {
      remoteXml = runGit(['show', `${branchRef}:${options.sitemapPath}`], root);
    } catch (error) {
      remoteXml = '';
    }

    const remoteCount = parseSitemapLocCount(remoteXml);
    if (remoteCount > 0) {
      const dropped = remoteCount - localCount;
      const droppedPercent = remoteCount > 0 ? (dropped / remoteCount) * 100 : 0;
      if (dropped > options.maxRouteDropAbsolute || droppedPercent > options.maxRouteDropPercent) {
        fail(
          `Suspicious route drop detected in sitemap (${remoteCount} -> ${localCount}, drop ${dropped}, ${droppedPercent.toFixed(1)}%). ` +
          `Thresholds are ${options.maxRouteDropAbsolute} routes or ${options.maxRouteDropPercent}% decrease.`
        );
      }
    }
  }

  console.log(
    `[prepublish-guard] OK: branch ${options.branch}, ahead ${aheadCount}, behind ${behindCount}, ` +
    `route checks ${options.skipRouteDropCheck ? 'skipped' : 'passed'}.`
  );
}

main();
