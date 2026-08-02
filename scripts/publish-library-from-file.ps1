param(
  [string]$CredentialsFile = ".r2-credentials.local.json",
  [string]$Bucket = "hawkins-hollow-library",
  [switch]$VerifyPublic
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $CredentialsFile)) {
  throw "Credentials file not found: $CredentialsFile"
}

$raw = Get-Content -Path $CredentialsFile -Raw -Encoding UTF8
$creds = $raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace([string]$creds.accountId) -or
    [string]::IsNullOrWhiteSpace([string]$creds.accessKeyId) -or
    [string]::IsNullOrWhiteSpace([string]$creds.secretAccessKey)) {
  throw "Credentials file is missing accountId, accessKeyId, or secretAccessKey."
}

if ([string]$creds.accessKeyId -like "PASTE_*" -or [string]$creds.secretAccessKey -like "PASTE_*") {
  throw "Credentials file still contains placeholder values. Replace accessKeyId and secretAccessKey in .r2-credentials.local.json."
}

$oldAccountId = $env:CLOUDFLARE_ACCOUNT_ID
$oldAccessKeyId = $env:R2_ACCESS_KEY_ID
$oldSecretAccessKey = $env:R2_SECRET_ACCESS_KEY
$oldBucket = $env:R2_BUCKET

try {
  $env:CLOUDFLARE_ACCOUNT_ID = [string]$creds.accountId
  $env:R2_ACCESS_KEY_ID = [string]$creds.accessKeyId
  $env:R2_SECRET_ACCESS_KEY = [string]$creds.secretAccessKey
  $env:R2_BUCKET = if ([string]::IsNullOrWhiteSpace([string]$creds.bucket)) { $Bucket } else { [string]$creds.bucket }

  $args = @("scripts/publish-library.js", "--apply", "--bucket", $env:R2_BUCKET)
  if ($VerifyPublic) {
    $args += "--verify-public"
  }

  Write-Host "Starting publish to bucket: $($env:R2_BUCKET)" -ForegroundColor Green
  & node @args
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Publish failed with exit code $exitCode"
  }

  Write-Host "Publish completed successfully." -ForegroundColor Green
}
finally {
  if ($null -eq $oldAccountId) { Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue } else { $env:CLOUDFLARE_ACCOUNT_ID = $oldAccountId }
  if ($null -eq $oldAccessKeyId) { Remove-Item Env:R2_ACCESS_KEY_ID -ErrorAction SilentlyContinue } else { $env:R2_ACCESS_KEY_ID = $oldAccessKeyId }
  if ($null -eq $oldSecretAccessKey) { Remove-Item Env:R2_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue } else { $env:R2_SECRET_ACCESS_KEY = $oldSecretAccessKey }
  if ($null -eq $oldBucket) { Remove-Item Env:R2_BUCKET -ErrorAction SilentlyContinue } else { $env:R2_BUCKET = $oldBucket }
}
