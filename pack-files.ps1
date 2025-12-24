# PowerShell-Skript zum Erstellen einer ZIP-Datei aller Dateien/Ordner außer "!versions"
# Automatisch erhöht die Version in manifest.json

# Holen des aktuellen Verzeichnispfads
$currentDir = Get-Location
$manifestPath = Join-Path $currentDir "manifest.json"

# Skript-Dateinamen ermitteln (für den Ausschluss)
$scriptName = Split-Path $MyInvocation.MyCommand.Path -Leaf

# Prüfen, ob manifest.json existiert
if (-not (Test-Path $manifestPath)) {
    Write-Host "Fehler: manifest.json nicht gefunden!" -ForegroundColor Red
    Write-Host "Erstelle Standard-manifest.json..."
    
    # Standard manifest.json erstellen
    $defaultManifest = @{
        name        = "Volumify"
        version     = "1.0.0"
        author      = ""
        description = ""
    } | ConvertTo-Json -Depth 10
    
    Set-Content -Path $manifestPath -Value $defaultManifest
    Write-Host "manifest.json mit Version 1.0.0 erstellt." -ForegroundColor Yellow
}

# Manifest einlesen und Version erhöhen
try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    
    # Versionsnummer parsen und erhöhen (Semantic Versioning)
    $versionParts = $manifest.version.Split('.')
    
    if ($versionParts.Count -eq 3) {
        # Patch-Version erhöhen (1.0.2 -> 1.0.3)
        $major = [int]$versionParts[0]
        $minor = [int]$versionParts[1]
        $patch = [int]$versionParts[2] + 1
        
        $newVersion = "$major.$minor.$patch"
        $oldVersion = $manifest.version
        
        # Version im Manifest aktualisieren
        $manifest.version = $newVersion
        
        # Manifest mit der neuen Version speichern
        $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8
        
        Write-Host "Version erhöht: $oldVersion -> $newVersion" -ForegroundColor Green
    }
    else {
        Write-Host "Fehler: Ungültiges Versionsformat in manifest.json" -ForegroundColor Red
        $newVersion = $manifest.version
    }
}
catch {
    Write-Host "Fehler beim Lesen/Aktualisieren von manifest.json: $_" -ForegroundColor Red
    $newVersion = "1.0.0"
}

# Erstellen des ZIP-Dateinamens mit Version
$zipFileName = "Volumify$newVersion.zip"
$versionsDir = Join-Path $currentDir "!versions"
$zipPath = Join-Path $versionsDir $zipFileName

# !versions Ordner erstellen, falls nicht vorhanden
New-Item -ItemType Directory -Path $versionsDir -Force | Out-Null

# Temporäres Verzeichnis für die zu komprimierenden Dateien
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$tempDir = Join-Path $env:TEMP "BackupTemp_$timestamp"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # Alle Elemente im aktuellen Verzeichnis außer "!versions" und dem Skript selbst kopieren
    Get-ChildItem -Path $currentDir | Where-Object {
        $_.Name -ne "!versions" -and 
        $_.Name -ne $scriptName -and 
        $_.Name -notlike "*.ps1"  # Optional: Alle PS1-Dateien ausschließen
    } | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
    }
    
    # ZIP-Datei erstellen (ab PowerShell 5.0)
    if ($PSVersionTable.PSVersion.Major -ge 5) {
        Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
    }
    else {
        # Alternative für ältere PowerShell-Versionen
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $zipPath, 'Optimal', $false)
    }
    
    Write-Host "ZIP-Datei erfolgreich erstellt: $zipPath" -ForegroundColor Green
    Write-Host "Größe: $([math]::Round((Get-Item $zipPath).Length / 1MB, 2)) MB" -ForegroundColor Cyan
    
}
catch {
    Write-Host "Fehler beim Erstellen der ZIP-Datei: $_" -ForegroundColor Red
}
finally {
    # Temporäres Verzeichnis bereinigen
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Versionshistorie in einer separaten Datei speichern
$versionHistoryPath = Join-Path $versionsDir "version_history.txt"
$historyEntry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Version $newVersion - $($zipFileName)"
Add-Content -Path $versionHistoryPath -Value $historyEntry

Write-Host "`nZusammenfassung:" -ForegroundColor Yellow
Write-Host "──────────────" -ForegroundColor Yellow
Write-Host "✓ Version in manifest.json erhöht" -ForegroundColor Green
Write-Host "✓ ZIP-Datei im !versions-Ordner gespeichert" -ForegroundColor Green
Write-Host "✓ Versionshistorie aktualisiert" -ForegroundColor Green
Write-Host "✓ Bereinigung abgeschlossen" -ForegroundColor Green
Write-Host "✓ Eigene PS1-Datei ausgeschlossen" -ForegroundColor Green

Start-Sleep -Seconds 3