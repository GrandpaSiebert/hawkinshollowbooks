const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');
const publishHelper = fs.readFileSync(path.join(root, 'scripts', 'publish-pages.ps1'), 'utf8');
const dependencyVerifier = fs.readFileSync(path.join(root, 'scripts', 'verify-freebie-title-art-readonly.js'), 'utf8');
const libraryRestore = fs.readFileSync(path.join(root, 'scripts', 'restore-library-canon.js'), 'utf8');
const freebieDiscoveryValidator = fs.readFileSync(path.join(root, 'scripts', 'validate-freebie-discovery.js'), 'utf8');
const titleArtValidator = fs.readFileSync(path.join(root, 'scripts', 'validate-freebie-title-art.js'), 'utf8');

function stepBlock(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `${name} step exists`);
  const next = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

test('Pages deployment restores shared canonical inputs read-only using existing R2 secret names', () => {
  const restore = stepBlock('Restore canonical inputs into the ephemeral runner Library');
  assert.match(restore, /if \[ -e "\$GITHUB_WORKSPACE\/Library" \] \|\| \[ -L "\$GITHUB_WORKSPACE\/Library" \]/);
  assert.match(restore, /restore-library-canon\.js --r2-only --destination "\$GITHUB_WORKSPACE\/Library"/);
  assert.doesNotMatch(restore, /--public-only/);
  assert.match(restore, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(restore, /secrets\.R2_ACCESS_KEY_ID/);
  assert.match(restore, /secrets\.R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(workflow, /secrets\.R2_READONLY_/);
  const validationWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-only-validation.yml'), 'utf8');
  for (const pipeline of [workflow, validationWorkflow]) {
    assert.match(pipeline, /--required-source-map data\/discovery-review-source-objects\.json/);
  }
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    assert.ok(validationWorkflow.includes(`secrets.${name}`));
  }
  assert.doesNotMatch(validationWorkflow, /secrets\.R2_READONLY_|publish-library\.js|publish-freebie-title-art\.js|wrangler/i);
  assert.doesNotMatch(libraryRestore, /PutObjectCommand|DeleteObjectCommand|UploadPartCommand/i);
  assert.doesNotMatch(workflow, /publish:freebie-title-art|publish-freebie-title-art\.js|publish-library\.js|wrangler/i);
});

test('required public R2 dependencies are verified read-only before the build and deployment', () => {
  const verification = stepBlock('Verify required published title-art dependencies (read-only)');
  const tests = stepBlock('Run complete serial regression suite');
  const build = stepBlock('Build and validate the deployment artifact');
  const deploy = stepBlock('Deploy to GitHub Pages');
  assert.match(verification, /verify-freebie-title-art-readonly\.js/);
  assert.doesNotMatch(dependencyVerifier, /publish-library|publish-freebie-title-art|@aws-sdk|PutObject|DeleteObject/i);
  assert.match(dependencyVerifier, /fetcher\(publicUrl, \{ redirect: 'error' \}\)/);
  assert.ok(workflow.indexOf(verification) < workflow.indexOf(build));
  assert.ok(workflow.indexOf(tests) < workflow.indexOf(build));
  assert.ok(workflow.indexOf(build) < workflow.indexOf(deploy));
  assert.match(build, /REQUIRE_FREEBIE_TITLE_ART_PUBLICATION:\s*'true'/);
  assert.match(build, /HH_ENTITY_ID_STRICT:\s*'1'/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf(build), workflow.indexOf(deploy)), /touch build-recovery|cp .*build-recovery|echo .*build-recovery/i);
});

test('strict build validators inspect only the artifact uploaded to Pages', () => {
  const upload = stepBlock('Upload artifact');
  assert.match(upload, /path:\s*build-recovery/);
  assert.match(freebieDiscoveryValidator, /const outputs = \['build-recovery'\]/);
  assert.match(titleArtValidator, /const outputDirs = \['build-recovery'\]/);
});

test('Pages permissions and IndexNow deployment sequence remain intact', () => {
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /Prepare deployment-aware IndexNow delta[\s\S]*?npm run indexnow:prepare/);
  assert.match(workflow, /Finalize deployment-aware IndexNow[\s\S]*?steps\.deployment\.outcome == 'success'[\s\S]*?npm run indexnow:submit/);
  assert.match(workflow, /Retain production IndexNow state and receipt[\s\S]*?steps\.deployment\.outcome == 'success'/);
});

test('local Pages helper requires explicit paths and cannot indiscriminately stage the worktree', () => {
  assert.match(publishHelper, /\[Parameter\(Mandatory\s*=\s*\$true\)\][\s\S]*?\[string\[\]\]\$Files/);
  assert.match(publishHelper, /git add -- \$normalizedFiles/);
  assert.match(publishHelper, /git diff --cached --quiet/);
  assert.match(publishHelper, /Compare-Object -ReferenceObject \$expectedPaths -DifferenceObject \$stagedPaths/);
  assert.match(publishHelper, /Nothing was committed or pushed; inspect the Git index/);
  assert.doesNotMatch(publishHelper, /git\s+add\s+-A\b|git\s+commit\s+-a\b|git\s+reset\b/i);
});
