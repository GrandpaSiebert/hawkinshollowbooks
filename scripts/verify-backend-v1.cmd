@echo off
setlocal
set GIT=C:\Program Files\Git\cmd\git.exe

echo Branch:
"%GIT%" branch --show-current
echo Latest commit:
"%GIT%" log -1 --pretty=format:"%%H %%s"
echo.
echo Tags:
"%GIT%" tag --list Backend-v1.0
echo Tag details:
"%GIT%" show Backend-v1.0 --no-patch

endlocal
