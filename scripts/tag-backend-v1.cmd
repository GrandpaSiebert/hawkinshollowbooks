@echo off
setlocal
set GIT=C:\Program Files\Git\cmd\git.exe
"%GIT%" tag -a Backend-v1.0 -m "Backend v1.0 Complete"
"%GIT%" tag --list Backend-v1.0
"%GIT%" show Backend-v1.0 --no-patch
endlocal
