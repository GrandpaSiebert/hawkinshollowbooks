param(
    [string]$Message,
    [string]$Branch = "main",
    [string]$RequiredBaseCommit = "f65dd02",
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Files
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    if (-not (Test-Path ".git")) {
        throw "This folder is not a git repository: $repoRoot"
    }

    $normalizedFiles = @()
    foreach ($file in $Files) {
        if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($file)) {
            throw "Release paths must be explicit; wildcard paths are not allowed: $file"
        }
        if ([System.IO.Path]::IsPathRooted($file)) {
            throw "Release paths must be relative to the repository root: $file"
        }
        $normalized = $file.Replace("/", "\")
        if (($normalized -split "\\") -contains ".." -or ($normalized -split "\\") -contains ".") {
            throw "Release paths cannot traverse outside or implicitly expand the repository: $file"
        }
        if (Test-Path -LiteralPath $normalized -PathType Container) {
            throw "Release paths must name files, not directories: $file"
        }
        if (-not (Test-Path -LiteralPath $normalized -PathType Leaf)) {
            git ls-files --error-unmatch -- $normalized *> $null
            if ($LASTEXITCODE -ne 0) {
                throw "Release path is neither an existing file nor a tracked deletion: $file"
            }
        }
        $normalizedFiles += $normalized
    }
    if (($normalizedFiles | Sort-Object -Unique).Count -ne $normalizedFiles.Count) {
        throw "Release paths must not contain duplicates."
    }
    $stagedChanges = git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "The Git index is not clean. Review or unstage existing changes before publishing."
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

    git add -- $normalizedFiles
    if ($LASTEXITCODE -ne 0) {
        throw "Could not stage the explicitly selected release paths."
    }

    $stagedPaths = @(git diff --cached --name-only | ForEach-Object { $_.Replace("/", "\") } | Sort-Object -Unique)
    $expectedPaths = @($normalizedFiles | Sort-Object -Unique)
    if (Compare-Object -ReferenceObject $expectedPaths -DifferenceObject $stagedPaths) {
        throw "The staged release paths differ from the explicit allowlist. Nothing was committed or pushed; inspect the Git index."
    }

    if ($stagedPaths.Count -eq 0) {
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
