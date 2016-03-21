$ErrorActionPreference = "Stop"

$client = New-Object System.Net.WebClient

# Install PHP
$phpUrl = "http://windows.php.net/downloads/releases/$env:PHP.zip"
Write-Output "Downloading $phpUrl"
$client.DownloadFile($phpUrl, (Join-Path $PWD 'php.zip'))
7z e php.zip -ophp
Rename-Item .\php\php.ini-development php.ini
$env:PATH += ';' + (Join-Path $PWD 'php')

# Install XDebug
$xdebugUrl = "https://xdebug.org/files/$env:XDEBUG.dll"
Write-Output "Downloading $xdebugUrl"
$client.DownloadFile($xdebugUrl, (Join-Path $PWD '.\php\ext\xdebug.dll'))
Add-Content .\php\php.ini @"
extension_dir=ext
zend_extension=xdebug.dll
xdebug.remote_enable=1
xdebug.remote_autostart=1
"@

# Install Node
Write-Output 'Installing Node'
Install-Product node 4.1.1 x64
npm install -g typings

# Install dependencies
Write-Output 'Installing dependencies'
npm install
typings install
