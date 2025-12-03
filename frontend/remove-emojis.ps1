# PowerShell Script to Remove Emojis and Non-Standard Characters from Frontend Files
# This script will scan JS, CSS, and HTML files for emojis and other non-alphanumeric characters

param(
    [switch]$DryRun = $false,
    [switch]$Verbose = $false
)

# Define file extensions to process
$fileExtensions = @("*.js", "*.jsx", "*.css", "*.html", "*.htm")

# Define patterns for different types of non-standard characters
$patterns = @{
    # Unicode emoji ranges (most common emoji ranges)
    "Emojis_Emoticons" = "[\u{1F600}-\u{1F64F}]"  # Emoticons
    "Emojis_Symbols" = "[\u{1F300}-\u{1F5FF}]"    # Misc Symbols and Pictographs
    "Emojis_Transport" = "[\u{1F680}-\u{1F6FF}]"  # Transport and Map Symbols
    "Emojis_Flags" = "[\u{1F1E0}-\u{1F1FF}]"      # Regional Indicator Symbols (flags)
    "Emojis_Extended" = "[\u{1F900}-\u{1F9FF}]"   # Supplemental Symbols and Pictographs
    "Emojis_Additional" = "[\u{2600}-\u{26FF}]"   # Misc symbols (sun, umbrella, etc.)
    "Emojis_Dingbats" = "[\u{2700}-\u{27BF}]"     # Dingbats
    "Emojis_Arrows" = "[\u{2190}-\u{21FF}]"       # Arrows (some decorative arrows)
    
    # Specific characters we've seen in the code
    "SpecificChars" = "[📸📁🏠👤✨🚀👥→←]"
    
    # General non-ASCII printable characters (excluding common punctuation and symbols)
    "NonASCII" = "[^\x00-\x7F]"
}

# Replacement suggestions for common emojis found in the code
$replacements = @{
    "📸" = "Image"
    "📁" = "Folder"
    "🏠" = "Home"
    "👤" = "User"
    "✨" = ""
    "🚀" = ""
    "👥" = "Group"
    "→" = ">"
    "←" = "<"
    "+" = "+"  # Keep mathematical symbols
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

function Find-NonStandardChars {
    param(
        [string]$FilePath,
        [string]$Content
    )
    
    $findings = @()
    $lineNumber = 1
    
    foreach ($line in $Content -split "`n") {
        foreach ($patternName in $patterns.Keys) {
            $pattern = $patterns[$patternName]
            $regexMatches = [regex]::Matches($line, $pattern)
            
            if ($regexMatches.Count -gt 0) {
                foreach ($match in $regexMatches) {
                    $findings += [PSCustomObject]@{
                        File = $FilePath
                        Line = $lineNumber
                        Column = $match.Index + 1
                        Character = $match.Value
                        Pattern = $patternName
                        Context = $line.Trim()
                    }
                }
            }
        }
        $lineNumber++
    }
    
    return $findings
}

function Remove-NonStandardChars {
    param(
        [string]$Content
    )
    
    $modifiedContent = $Content
    $changesLog = @()
    
    # Apply specific replacements first
    foreach ($char in $replacements.Keys) {
        if ($modifiedContent -match [regex]::Escape($char)) {
            $replacement = $replacements[$char]
            $beforeCount = ([regex]::Matches($modifiedContent, [regex]::Escape($char))).Count
            $modifiedContent = $modifiedContent -replace [regex]::Escape($char), $replacement
            
            if ($beforeCount -gt 0) {
                $changesLog += "Replaced $beforeCount instances of '$char' with '$replacement'"
            }
        }
    }
    
    # Remove any remaining emojis (but be careful with common symbols)
    $emojiPatterns = @(
        "[\u{1F600}-\u{1F64F}]",  # Emoticons
        "[\u{1F300}-\u{1F5FF}]",  # Misc Symbols and Pictographs
        "[\u{1F680}-\u{1F6FF}]",  # Transport and Map Symbols
        "[\u{1F1E0}-\u{1F1FF}]",  # Regional Indicator Symbols
        "[\u{1F900}-\u{1F9FF}]"   # Supplemental Symbols and Pictographs
    )
    
    foreach ($pattern in $emojiPatterns) {
        $beforeCount = ([regex]::Matches($modifiedContent, $pattern)).Count
        if ($beforeCount -gt 0) {
            $modifiedContent = $modifiedContent -replace $pattern, ""
            $changesLog += "Removed $beforeCount emoji characters matching pattern: $pattern"
        }
    }
    
    return @{
        Content = $modifiedContent
        Changes = $changesLog
    }
}

# Main execution
Write-ColorOutput "=== Frontend Emoji and Non-Standard Character Scanner ===" "Cyan"
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
            $findings = Find-NonStandardChars -FilePath $file.FullName -Content $content
            
            if ($findings.Count -gt 0) {
                $totalFindings += $findings
                
                Write-ColorOutput "`n📄 File: $($file.FullName)" "Yellow"
                Write-ColorOutput "Found $($findings.Count) non-standard character(s):" "Red"
                
                foreach ($finding in $findings) {
                    Write-ColorOutput "  Line $($finding.Line), Col $($finding.Column): '$($finding.Character)' ($($finding.Pattern))" "Red"
                    if ($Verbose) {
                        Write-ColorOutput "    Context: $($finding.Context)" "Gray"
                    }
                }
                
                if (-not $DryRun) {
                    $result = Remove-NonStandardChars -Content $content
                    
                    if ($result.Changes.Count -gt 0) {
                        # Create backup
                        $backupPath = $file.FullName + ".backup"
                        Copy-Item -Path $file.FullName -Destination $backupPath
                        
                        # Write modified content
                        Set-Content -Path $file.FullName -Value $result.Content -Encoding UTF8
                        $modifiedFiles++
                        
                        Write-ColorOutput "  ✅ Modified file (backup created: $backupPath)" "Green"
                        foreach ($change in $result.Changes) {
                            Write-ColorOutput "    - $change" "Green"
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-ColorOutput "❌ Error processing file $($file.FullName): $($_.Exception.Message)" "Red"
    }
}

# Summary
Write-ColorOutput "`n=== SUMMARY ===" "Cyan"
Write-ColorOutput "Files scanned: $($allFiles.Count)" "Blue"
Write-ColorOutput "Files with non-standard characters: $(($totalFindings | Group-Object File).Count)" "Blue"
Write-ColorOutput "Total non-standard characters found: $($totalFindings.Count)" "Blue"

if (-not $DryRun) {
    Write-ColorOutput "Files modified: $modifiedFiles" "Green"
    Write-ColorOutput "Backup files created with .backup extension" "Yellow"
}

# Character breakdown
if ($totalFindings.Count -gt 0) {
    Write-ColorOutput "`n=== CHARACTER BREAKDOWN ===" "Cyan"
    $charGroups = $totalFindings | Group-Object Character | Sort-Object Count -Descending
    foreach ($group in $charGroups) {
        Write-ColorOutput "$($group.Name): $($group.Count) occurrences" "Blue"
    }
}

if ($DryRun) {
    Write-ColorOutput "`nTo actually remove these characters, run the script without -DryRun flag" "Yellow"
}

Write-ColorOutput "`nScript completed!" "Green"
