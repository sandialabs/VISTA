# PowerShell Script to Remove Emojis from Frontend Files
# This script will scan JS, CSS, and HTML files for emojis and other specific characters

param(
    [switch]$DryRun = $false,
    [switch]$Verbose = $false
)

# Define file extensions to process
$fileExtensions = @("*.js", "*.jsx", "*.css", "*.html", "*.htm")

# Define specific characters we want to replace (using escape sequences)
$replacements = @{
    [char]0x1F4F8 = "Image"       # 📸
    [char]0x1F4C1 = "Folder"      # 📁  
    [char]0x1F3E0 = "Home"        # 🏠
    [char]0x1F464 = "User"        # 👤
    [char]0x2728 = ""             # ✨
    [char]0x1F680 = ""            # 🚀
    [char]0x1F465 = "Group"       # 👥
    [char]0x2192 = ">"            # →
    [char]0x2190 = "<"            # ←
}

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    
    switch ($Color) {
        "Red" { Write-Host $Message -ForegroundColor Red }
        "Green" { Write-Host $Message -ForegroundColor Green }
        "Yellow" { Write-Host $Message -ForegroundColor Yellow }
        "Blue" { Write-Host $Message -ForegroundColor Blue }
        "Cyan" { Write-Host $Message -ForegroundColor Cyan }
        "Magenta" { Write-Host $Message -ForegroundColor Magenta }
        default { Write-Host $Message }
    }
}

function Find-SpecialChars {
    param(
        [string]$FilePath,
        [string]$Content
    )
    
    $findings = @()
    $lineNumber = 1
    
    foreach ($line in $Content -split "`n") {
        foreach ($char in $replacements.Keys) {
            if ($line.Contains($char)) {
                $index = 0
                while (($index = $line.IndexOf($char, $index)) -ne -1) {
                    $findings += [PSCustomObject]@{
                        File = $FilePath
                        Line = $lineNumber
                        Column = $index + 1
                        Character = $char
                        UnicodePoint = "U+{0:X4}" -f [int]$char
                        Context = $line.Trim()
                    }
                    $index++
                }
            }
        }
        
        # Also check for any other high Unicode characters (potential emojis)
        for ($i = 0; $i -lt $line.Length; $i++) {
            $charCode = [int]$line[$i]
            if ($charCode -gt 127 -and $charCode -ne 8212 -and $charCode -ne 8211) { # Exclude common punctuation
                $findings += [PSCustomObject]@{
                    File = $FilePath
                    Line = $lineNumber
                    Column = $i + 1
                    Character = $line[$i]
                    UnicodePoint = "U+{0:X4}" -f $charCode
                    Context = $line.Trim()
                }
            }
        }
        
        $lineNumber++
    }
    
    return $findings
}

function Remove-SpecialChars {
    param(
        [string]$Content
    )
    
    $modifiedContent = $Content
    $changesLog = @()
    
    # Apply specific replacements
    foreach ($char in $replacements.Keys) {
        $replacement = $replacements[$char]
        $charString = [string]$char
        
        if ($modifiedContent.Contains($charString)) {
            $beforeCount = ($modifiedContent.ToCharArray() | Where-Object { $_ -eq $char }).Count
            $modifiedContent = $modifiedContent.Replace($charString, $replacement)
            
            if ($beforeCount -gt 0) {
                $unicodePoint = "U+{0:X4}" -f [int]$char
                $changesLog += "Replaced $beforeCount instances of '$char' ($unicodePoint) with '$replacement'"
            }
        }
    }
    
    return @{
        Content = $modifiedContent
        Changes = $changesLog
    }
}

# Main execution
Write-ColorOutput "=== Frontend Emoji and Special Character Scanner ===" "Cyan"
Write-ColorOutput "Scanning directory: $(Get-Location)" "Blue"

if ($DryRun) {
    Write-ColorOutput "DRY RUN MODE - No files will be modified" "Yellow"
}

# Find all relevant files
$allFiles = @()
foreach ($extension in $fileExtensions) {
    $files = Get-ChildItem -Path "." -Filter $extension -Recurse | Where-Object { 
        $_.FullName -notmatch "node_modules" -and 
        $_.FullName -notmatch "build" -and 
        $_.FullName -notmatch "\.git" 
    }
    $allFiles += $files
}

Write-ColorOutput "Found $($allFiles.Count) files to scan" "Green"

$totalFindings = @()
$modifiedFiles = 0

foreach ($file in $allFiles) {
    try {
        $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
        
        if ($content) {
            $findings = Find-SpecialChars -FilePath $file.FullName -Content $content
            
            if ($findings.Count -gt 0) {
                $totalFindings += $findings
                
                Write-ColorOutput "`nFile: $($file.FullName)" "Yellow"
                Write-ColorOutput "Found $($findings.Count) special character(s):" "Red"
                
                $uniqueFindings = $findings | Group-Object Character, UnicodePoint | ForEach-Object {
                    $_.Group[0] | Add-Member -NotePropertyName Count -NotePropertyValue $_.Count -PassThru
                }
                
                foreach ($finding in $uniqueFindings) {
                    Write-ColorOutput "  Character: '$($finding.Character)' ($($finding.UnicodePoint)) - $($finding.Count) occurrence(s)" "Red"
                    if ($Verbose) {
                        Write-ColorOutput "    First occurrence at Line $($finding.Line), Col $($finding.Column)" "Gray"
                        Write-ColorOutput "    Context: $($finding.Context)" "Gray"
                    }
                }
                
                if (-not $DryRun) {
                    $result = Remove-SpecialChars -Content $content
                    
                    if ($result.Changes.Count -gt 0) {
                        # Create backup
                        $backupPath = $file.FullName + ".backup"
                        Copy-Item -Path $file.FullName -Destination $backupPath
                        
                        # Write modified content
                        Set-Content -Path $file.FullName -Value $result.Content -Encoding UTF8
                        $modifiedFiles++
                        
                        Write-ColorOutput "  Modified file (backup: $backupPath)" "Green"
                        foreach ($change in $result.Changes) {
                            Write-ColorOutput "    - $change" "Green"
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-ColorOutput "Error processing file $($file.FullName): $($_.Exception.Message)" "Red"
    }
}

# Summary
Write-ColorOutput "`n=== SUMMARY ===" "Cyan"
Write-ColorOutput "Files scanned: $($allFiles.Count)" "Blue"
Write-ColorOutput "Files with special characters: $(($totalFindings | Group-Object File).Count)" "Blue"
Write-ColorOutput "Total special characters found: $($totalFindings.Count)" "Blue"

if (-not $DryRun) {
    Write-ColorOutput "Files modified: $modifiedFiles" "Green"
    if ($modifiedFiles -gt 0) {
        Write-ColorOutput "Backup files created with .backup extension" "Yellow"
    }
}

# Character breakdown
if ($totalFindings.Count -gt 0) {
    Write-ColorOutput "`n=== CHARACTER BREAKDOWN ===" "Cyan"
    $charGroups = $totalFindings | Group-Object Character, UnicodePoint | Sort-Object Count -Descending
    foreach ($group in $charGroups) {
        $char = $group.Group[0]
        Write-ColorOutput "'$($char.Character)' ($($char.UnicodePoint)): $($group.Count) occurrences" "Blue"
    }
}

if ($DryRun) {
    Write-ColorOutput "`nTo actually remove these characters, run: .\remove-emojis.ps1" "Yellow"
}

Write-ColorOutput "`nScript completed!" "Green"
