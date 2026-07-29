@echo off
setlocal
set GIT=C:\Program Files\Git\cmd\git.exe

if not exist "%GIT%" (
  echo Git executable not found at %GIT%
  exit /b 1
)

taskkill /IM git.exe /F >nul 2>nul
if exist .git\index.lock del /f /q .git\index.lock

"%GIT%" init
"%GIT%" config user.name David
"%GIT%" config user.email david@local
"%GIT%" add .
"%GIT%" commit -m "Backend v1.0 complete - experience-ready baseline"
if errorlevel 1 echo Commit step returned non-zero exit code.

"%GIT%" tag -a Backend-v1.0 -m "Backend v1.0 Complete"
if errorlevel 1 echo Tag step returned non-zero exit code.

echo Branch:
"%GIT%" branch --show-current
echo Latest commit:
"%GIT%" log -1 --pretty=format:"%%H %%s"
echo.
echo Tag:
"%GIT%" tag --list Backend-v1.0

endlocal
