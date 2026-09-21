@echo off
pushd "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing desktop runtime. Please wait...
  call npm install
  if errorlevel 1 (
    echo Installation failed. Check the network and try again.
    pause
    exit /b 1
  )
)
start "" "node_modules\electron\dist\electron.exe" "."
popd
