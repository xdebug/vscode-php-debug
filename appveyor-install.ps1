$client = New-Object System.Net.WebClient

# Install PHP
$phpUrl = "http://windows.php.net/downloads/releases/php-$env:PHP_VERSION-nts-Win32-VC$env:VC_VERSION-x86.zip"
Write-Output "Downloading $phpUrl"
$client.DownloadFile($phpUrl, (Join-Path $PWD 'php.zip'))
7z e php.zip -ophp
Rename-Item .\php\php.ini-development php.ini
$env:PATH += ';' + (Join-Path $PWD 'php')

# Install XDebug
$phpMinorVersion = $env:PHP_VERSION -replace '\.\d+$'
$xdebugUrl = "https://xdebug.org/files/php_xdebug-$env:XDEBUG_VERSION-$phpMinorVersion-vc$env:VC_VERSION-nts.dll"
Write-Output "Downloading $xdebugUrl"
$xdebugPath = Join-Path $PWD 'php\ext\xdebug.dll'
$client.DownloadFile($xdebugUrl, $xdebugPath)
Add-Content .\php\php.ini @"
extension_dir=ext
zend_extension=$xdebugPath
xdebug.remote_enable=1
xdebug.remote_autostart=1
"@

# Install Node
Write-Output 'Installing Node'
Install-Product node 6.5.0 x64
npm config -g set progress=false
npm config -g set unicode=false

# Install dependencies
Write-Output 'Installing dependencies'
npm install
