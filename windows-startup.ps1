param([switch]$Disable)
$ErrorActionPreference = 'Stop'
try {
    $startup = [Environment]::GetFolderPath('Startup')
    if (-not $startup) { throw 'The Windows Startup folder could not be found.' }
    $link = Join-Path $startup 'Misrah Photobooth.lnk'
    if ($Disable) {
        if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link }
        Write-Host 'Misrah Photobooth automatic startup is disabled.'
    } else {
        $launcher = Join-Path $PSScriptRoot 'Start Photobooth.bat'
        if (-not (Test-Path -LiteralPath $launcher)) { throw 'Extract the complete app before enabling startup.' }
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($link)
        $shortcut.TargetPath = $launcher
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.WindowStyle = 7
        $shortcut.Description = 'Start Misrah Photobooth when this Windows user signs in'
        $shortcut.Save()
        Write-Host 'Misrah Photobooth will open full screen when this Windows user signs in.'
        Write-Host 'Keep this app folder in this location. Run setup again if you move it.'
    }
} catch {
    Write-Error $_
    exit 1
}
