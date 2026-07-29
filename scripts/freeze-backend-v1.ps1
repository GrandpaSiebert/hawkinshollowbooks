$git = 'C:\Program Files\Git\cmd\git.exe'

& $git init
& $git config user.name 'David'
& $git config user.email 'david@local'
& $git add .
& $git commit -m 'Backend v1.0 complete - experience-ready baseline'
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Commit did not succeed (possibly no staged changes). Continuing to tag check.'
}

& $git tag -a Backend-v1.0 -m 'Backend v1.0 Complete'
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Tag creation failed (possibly already exists).'
}

& $git branch --show-current
& $git log -1 --pretty=format:'%H %s'
Write-Host ''
& $git tag --list Backend-v1.0
