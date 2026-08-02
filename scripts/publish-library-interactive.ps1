param(
  [string]$Bucket = "hawkins-hollow-library",
  [string]$AccountId = "9f04af0bd97741c1f01e02fdf1869cd1",
  [switch]$VerifyPublic
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-SecureStringToPlainText {
  param([System.Security.SecureString]$Secure)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

Write-Host "Hawkins Hollow R2 Publish (interactive)" -ForegroundColor Cyan
Write-Host "Credentials are entered locally in this terminal session only." -ForegroundColor DarkCyan
Write-Host ""

if ([string]::IsNullOrWhiteSpace($AccountId)) {
  $AccountId = Read-Host "Cloudflare Account ID"
} else {
  $enteredAccountId = Read-Host "Cloudflare Account ID [$AccountId] (press Enter to keep)"
  if (-not [string]::IsNullOrWhiteSpace($enteredAccountId)) {
    $AccountId = $enteredAccountId.Trim()
  }
}

$accessKeyId = Read-Host "R2 Access Key ID"
$secretSecure = Read-Host "R2 Secret Access Key" -AsSecureString
$secretAccessKey = Convert-SecureStringToPlainText -Secure $secretSecure

if ([string]::IsNullOrWhiteSpace($AccountId) -or
    [string]::IsNullOrWhiteSpace($accessKeyId) -or
    [string]::IsNullOrWhiteSpace($secretAccessKey)) {
  throw "All credential fields are required."
}

$oldAccountId = $env:CLOUDFLARE_ACCOUNT_ID
$oldAccessKeyId = $env:R2_ACCESS_KEY_ID
$oldSecretAccessKey = $env:R2_SECRET_ACCESS_KEY
$oldBucket = $env:R2_BUCKET

try {
  $env:CLOUDFLARE_ACCOUNT_ID = $AccountId
  $env:R2_ACCESS_KEY_ID = $accessKeyId
  $env:R2_SECRET_ACCESS_KEY = $secretAccessKey
  $env:R2_BUCKET = $Bucket

  $args = @("scripts/publish-library.js", "--apply", "--bucket", $Bucket)
  if ($VerifyPublic) {
    $args += "--verify-public"
  }

  Write-Host ""
  Write-Host "Starting publish to bucket: $Bucket" -ForegroundColor Green
  Write-Host ""

  & node @args
  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0) {
    throw "Publish failed with exit code $exitCode"
  }

  Write-Host ""
  Write-Host "Publish completed successfully." -ForegroundColor Green
}
finally {
  if ($null -eq $oldAccountId) { Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue } else { $env:CLOUDFLARE_ACCOUNT_ID = $oldAccountId }
  if ($null -eq $oldAccessKeyId) { Remove-Item Env:R2_ACCESS_KEY_ID -ErrorAction SilentlyContinue } else { $env:R2_ACCESS_KEY_ID = $oldAccessKeyId }
  if ($null -eq $oldSecretAccessKey) { Remove-Item Env:R2_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue } else { $env:R2_SECRET_ACCESS_KEY = $oldSecretAccessKey }
  if ($null -eq $oldBucket) { Remove-Item Env:R2_BUCKET -ErrorAction SilentlyContinue } else { $env:R2_BUCKET = $oldBucket }

  $secretAccessKey = $null
}
