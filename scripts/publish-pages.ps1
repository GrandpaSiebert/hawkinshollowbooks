param(
    [string]$Message,
    [string]$Branch = "main",
    [string]$RequiredBaseCommit = "f65dd02"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    if (-not (Test-Path ".git")) {
        throw "This folder is not a git repository: $repoRoot"
    }

    Write-Host "Running pre-publish branch guard..."
    node scripts/prepublish-guard.js --branch $Branch --skip-route-drop-check --require-contains $RequiredBaseCommit
    if ($LASTEXITCODE -ne 0) {
        throw "Pre-publish branch guard failed with exit code $LASTEXITCODE"
    }

    Write-Host "Building site..."
    node scripts/generate-site.js
    if ($LASTEXITCODE -ne 0) {
        throw "Site build failed with exit code $LASTEXITCODE"
    }

    Write-Host "Running pre-publish sitemap guard..."
    node scripts/prepublish-guard.js --branch $Branch --allow-dirty --require-contains $RequiredBaseCommit
    if ($LASTEXITCODE -ne 0) {
        throw "Pre-publish sitemap guard failed with exit code $LASTEXITCODE"
    }

    git add -A

    $pendingChanges = git status --porcelain
    if ([string]::IsNullOrWhiteSpace($pendingChanges)) {
        Write-Host "No changes to commit. Nothing to publish."
        exit 0
    }

    if ([string]::IsNullOrWhiteSpace($Message)) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
        $Message = "Publish site update $timestamp"
    }

    Write-Host "Committing changes..."
    git commit -m "$Message"
    if ($LASTEXITCODE -ne 0) {
        throw "git commit failed with exit code $LASTEXITCODE"
    }

    Write-Host "Pushing to origin/$Branch..."
    git push origin $Branch
    if ($LASTEXITCODE -ne 0) {
        throw "git push failed with exit code $LASTEXITCODE"
    }

    Write-Host "Publish complete. GitHub Actions will deploy Pages from build-recovery."
}
finally {
    Pop-Location
}
