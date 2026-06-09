# VISTA development environment launcher (PowerShell 5.1+ and PowerShell 7+)
#
# Architecture:
# 1) Environment sensing (desktop app + runtime CLI + compose mode)
# 2) Container orchestration (up/down/restart/logs/etc.)
# 3) Verification (health + inter-service + host connectivity)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# =========================
# Configurable settings
# =========================
$ComposeFile = if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { "docker-compose.dev.yml" }
$LogDirRel = if ($env:LOG_DIR_REL) { $env:LOG_DIR_REL } else { "logs" }
$HealthPollSeconds = if ($env:HEALTH_POLL_SECONDS) { [int]$env:HEALTH_POLL_SECONDS } else { 3 }

$PostgresHealthTimeout = if ($env:POSTGRES_HEALTH_TIMEOUT) { [int]$env:POSTGRES_HEALTH_TIMEOUT } else { 180 }
$MinioHealthTimeout = if ($env:MINIO_HEALTH_TIMEOUT) { [int]$env:MINIO_HEALTH_TIMEOUT } else { 180 }
$BackendHealthTimeout = if ($env:BACKEND_HEALTH_TIMEOUT) { [int]$env:BACKEND_HEALTH_TIMEOUT } else { 300 }
$FrontendHealthTimeout = if ($env:FRONTEND_HEALTH_TIMEOUT) { [int]$env:FRONTEND_HEALTH_TIMEOUT } else { 240 }

$HostFrontendUrl = if ($env:HOST_FRONTEND_URL) { $env:HOST_FRONTEND_URL } else { "http://localhost:3000" }
$HostBackendHealthUrl = if ($env:HOST_BACKEND_HEALTH_URL) { $env:HOST_BACKEND_HEALTH_URL } else { "http://localhost:8000/api/health" }
$HostMinioLiveUrl = if ($env:HOST_MINIO_LIVE_URL) { $env:HOST_MINIO_LIVE_URL } else { "http://localhost:9000/minio/health/live" }

$ScriptDir = $PSScriptRoot
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$LogDir = Join-Path $ProjectRoot $LogDirRel
$PidFile = Join-Path $LogDir ".log_pids"
Set-Location $ProjectRoot

$RuntimeCmd = $null
$ComposeCmd = $null
$ComposeMode = $null

function Test-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-ProcessRunning {
    param([Parameter(Mandatory = $true)][string]$Pattern)
    try {
        return [bool](Get-Process | Where-Object { $_.ProcessName -match $Pattern })
    } catch {
        return $false
    }
}

function Detect-WindowsDesktopEngine {
    # Match friendly titles and actual process names across Docker/Podman Desktop variants.
    if (Test-ProcessRunning -Pattern "(?i)docker(\s|-)?desktop") { return "docker-desktop" }
    if (Test-ProcessRunning -Pattern "(?i)podman(\s|-)?desktop") { return "podman-desktop" }
    return "none"
}

function Test-RuntimeReachable {
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Args = @("info"))
    if (-not (Test-Command $Command)) { return $false }
    try {
        return (Invoke-NativeQuiet -Command $Command -Args $Args)
    } catch {
        return $false
    }
}

function Invoke-NativeQuiet {
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Args = @())

    $oldPref = $ErrorActionPreference
    $hadNativePref = Test-Path Variable:PSNativeCommandUseErrorActionPreference
    if ($hadNativePref) { $oldNativePref = $PSNativeCommandUseErrorActionPreference }

    try {
        $ErrorActionPreference = "Continue"
        if ($hadNativePref) { $PSNativeCommandUseErrorActionPreference = $false }
        & $Command @Args *> $null 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $oldPref
        if ($hadNativePref) { $PSNativeCommandUseErrorActionPreference = $oldNativePref }
    }
}

function Get-PlatformName {
    if ($env:OS -eq "Windows_NT") { return "windows-shell" }
    $isLinuxVar = Get-Variable -Name "IsLinux" -Scope Global -ErrorAction SilentlyContinue
    $isMacOsVar = Get-Variable -Name "IsMacOS" -Scope Global -ErrorAction SilentlyContinue
    if ($isLinuxVar -and $isLinuxVar.Value) { return "linux" }
    if ($isMacOsVar -and $isMacOsVar.Value) { return "macos" }
    return "unknown"
}

function Get-ServiceHealthStatus {
    param([Parameter(Mandatory = $true)][string]$Service)

    $jsonOutput = Invoke-Compose ps --format json $Service
    if (-not $jsonOutput) { return "unknown" }

    $parsed = $null
    try {
        $parsed = $jsonOutput | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return "unknown"
    }

    $row = $null
    if ($parsed -is [System.Collections.IEnumerable] -and -not ($parsed -is [string])) {
        $items = @($parsed)
        if ($items.Count -gt 0) { $row = $items[0] }
    } else {
        $row = $parsed
    }

    if (-not $row) { return "unknown" }

    $healthProp = $row.PSObject.Properties["Health"]
    $stateProp = $row.PSObject.Properties["State"]
    $statusProp = $row.PSObject.Properties["Status"]

    $health = if ($healthProp) { [string]$healthProp.Value } else { "" }
    $state = if ($stateProp) { [string]$stateProp.Value } else { "" }
    $status = if ($statusProp) { [string]$statusProp.Value } else { "" }
    if ($health) { return $health.Trim().ToLowerInvariant() }

    $statusLower = $status.Trim().ToLowerInvariant()
    if ($statusLower.Contains("healthy")) { return "healthy" }
    if ($statusLower.Contains("unhealthy")) { return "unhealthy" }

    if ($state) { return $state.Trim().ToLowerInvariant() }
    return "unknown"
}

function Test-CommandWorks {
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Args)
    if (-not (Test-Command $Command)) { return $false }
    return (Invoke-NativeQuiet -Command $Command -Args $Args)
}

function Sense-ContainerEngine {
    $platform = Get-PlatformName
    $desktop = if ($platform -eq "windows-shell") { Detect-WindowsDesktopEngine } else { "none" }

    # Windows + Podman Desktop can expose either podman.exe or only docker.exe wired to podman.
    # Prefer podman when it is reachable, otherwise fall back to docker.
    if ($desktop -eq "podman-desktop") {
        if (Test-RuntimeReachable -Command "podman" -Args @("info")) { $script:RuntimeCmd = "podman"; return }

        if (Test-RuntimeReachable -Command "docker" -Args @("info")) { $script:RuntimeCmd = "docker"; return }

        # Best effort: Podman Desktop commonly exposes this named pipe for Docker-compatible clients.
        $oldDockerHost = $env:DOCKER_HOST
        $candidateHosts = @(
            "npipe:////./pipe/podman-machine-default",
            "npipe:////./pipe/podman-desktop-engine"
        )
        foreach ($candidateHost in $candidateHosts) {
            $env:DOCKER_HOST = $candidateHost
            if (Test-RuntimeReachable -Command "docker" -Args @("info")) {
                $script:RuntimeCmd = "docker"
                return
            }
        }

        if ($null -eq $oldDockerHost) { Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue } else { $env:DOCKER_HOST = $oldDockerHost }
        throw "Podman Desktop is running but no reachable podman/docker API was detected. Try launching a Podman machine and verify 'podman info' or 'docker info' works."
    }

    if (Test-RuntimeReachable -Command "podman" -Args @("info")) { $script:RuntimeCmd = "podman"; return }
    if (Test-RuntimeReachable -Command "docker" -Args @("info")) { $script:RuntimeCmd = "docker"; return }

    throw "Neither podman nor docker CLI is installed and reachable."
}

function Sense-ComposeCommand {
    if (Test-CommandWorks -Command $RuntimeCmd -Args @("compose", "version")) {
        $script:ComposeMode = "plugin"
        $script:ComposeCmd = @($RuntimeCmd, "compose")
        return
    }

    $legacy = @("$RuntimeCmd-compose", "docker-compose", "podman-compose")
    foreach ($cmd in $legacy) {
        if (Test-CommandWorks -Command $cmd -Args @("version")) {
            $script:ComposeMode = "legacy"
            $script:ComposeCmd = @($cmd)
            return
        }
    }

    throw "No working compose implementation detected."
}

function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    if ($ComposeCmd.Count -eq 1) {
        & $ComposeCmd[0] -f $ComposeFile @Args
    } else {
        & $ComposeCmd[0] $ComposeCmd[1] -f $ComposeFile @Args
    }
}

function Print-EnvironmentSummary {
    $platform = Get-PlatformName
    $desktop = "n/a"
    if ($platform -eq "windows-shell") {
        $desktop = Detect-WindowsDesktopEngine
    }

    Write-Host "Environment detection:"
    Write-Host "  Platform:              $platform"
    Write-Host "  Windows desktop app:   $desktop"
    Write-Host "  Runtime CLI:           $RuntimeCmd"
    Write-Host "  Compose mode:          $ComposeMode ($($ComposeCmd -join ' '))"
    Write-Host "  Compose file:          $ComposeFile"
}

function Wait-ForServiceHealthy {
    param([string]$Service, [int]$TimeoutSeconds = 180)
    Write-Host (" [OK] Container {0,-20} Waiting                                 0.0s" -f $Service)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $elapsed = 0
    while ((Get-Date) -lt $deadline) {
        $status = Get-ServiceHealthStatus -Service $Service
        if ($status -eq "healthy") {
            Write-Host (" [OK] Container {0,-20} Healthy                                 {1}s" -f $Service, $elapsed)
            return
        }
        if ($status -eq "unhealthy") {
            Invoke-Compose logs --tail=50 $Service
            throw "Service '$Service' became unhealthy."
        }
        Start-Sleep -Seconds $HealthPollSeconds
        $elapsed += $HealthPollSeconds
    }
    Invoke-Compose ps $Service
    Invoke-Compose logs --tail=50 $Service
    throw "Timed out waiting for '$Service' to become healthy."
}

function Invoke-ConnectivityChecks {
    Write-Host "Running cross-service connectivity checks..."
    Invoke-Compose exec -T backend-dev bash -c @"
set -e
cd /app/backend
python - <<"PY"
import asyncio
import asyncpg
import urllib.request

async def verify_postgres():
    conn = await asyncpg.connect("postgresql://postgres:postgres@postgres:5432/postgres")
    try:
        value = await conn.fetchval("SELECT 1")
        assert value == 1
        print("[OK] backend-dev -> postgres connectivity OK (SELECT 1)")
    finally:
        await conn.close()

asyncio.run(verify_postgres())
urllib.request.urlopen('http://minio:9000/minio/health/live', timeout=5).read()
print('[OK] backend-dev -> minio connectivity OK (/minio/health/live)')
PY
"@
    Invoke-Compose exec -T frontend-dev sh -c "wget -qO- http://backend-dev:8000/api/health >/dev/null && echo '[OK] frontend-dev -> backend-dev connectivity OK (/api/health)'"

    Invoke-WebRequest -Uri $HostBackendHealthUrl -UseBasicParsing | Out-Null
    Write-Host "[OK] host -> backend-dev connectivity OK ($HostBackendHealthUrl)"
    Invoke-WebRequest -Uri $HostMinioLiveUrl -UseBasicParsing | Out-Null
    Write-Host "[OK] host -> minio connectivity OK ($HostMinioLiveUrl)"
    Invoke-WebRequest -Uri $HostFrontendUrl -UseBasicParsing | Out-Null
    Write-Host "[OK] host -> frontend-dev connectivity OK ($HostFrontendUrl)"
}

function Start-LogCollector {
    param([string]$Service, [string]$OutputFile)
    $errorFile = "$OutputFile.err"
    $args = if ($ComposeCmd.Count -eq 1) {
        @("-f", $ComposeFile, "logs", "-f", "--no-color", $Service)
    } else {
        @("compose", "-f", $ComposeFile, "logs", "-f", "--no-color", $Service)
    }
    $proc = Start-Process -FilePath $ComposeCmd[0] -ArgumentList $args -RedirectStandardOutput $OutputFile -RedirectStandardError $errorFile -PassThru
    return $proc.Id
}

function Start-LogCollectors {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $pids = @()
    $pids += Start-LogCollector -Service "postgres" -OutputFile (Join-Path $LogDir "postgres.log")
    $pids += Start-LogCollector -Service "minio" -OutputFile (Join-Path $LogDir "minio.log")
    $pids += Start-LogCollector -Service "backend-dev" -OutputFile (Join-Path $LogDir "backend-dev.log")
    $pids += Start-LogCollector -Service "frontend-dev" -OutputFile (Join-Path $LogDir "frontend-dev.log")
    $pids | Set-Content -Path $PidFile
}

function Stop-LogCollectors {
    if (Test-Path $PidFile) {
        Get-Content $PidFile | ForEach-Object {
            if ($_ -match '^\d+$') { Stop-Process -Id ([int]$_) -ErrorAction SilentlyContinue }
        }
        Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Main {
    param([string[]]$CliArgs = @())

    Sense-ContainerEngine
    Sense-ComposeCommand

    $Command = if ($CliArgs.Count -ge 1) { $CliArgs[0].ToLowerInvariant() } else { "up" }
    $Arg2 = if ($CliArgs.Count -ge 2) { $CliArgs[1] } else { "" }

    switch ($Command) {
        "up" {
            Print-EnvironmentSummary
            Invoke-Compose up -d
            Wait-ForServiceHealthy postgres $PostgresHealthTimeout
            Wait-ForServiceHealthy minio $MinioHealthTimeout
            Wait-ForServiceHealthy backend-dev $BackendHealthTimeout
            Wait-ForServiceHealthy frontend-dev $FrontendHealthTimeout
            Invoke-ConnectivityChecks
            Start-LogCollectors
        }
        "verify" {
            Print-EnvironmentSummary
            Wait-ForServiceHealthy postgres 120
            Wait-ForServiceHealthy minio 120
            Wait-ForServiceHealthy backend-dev 180
            Wait-ForServiceHealthy frontend-dev 120
            Invoke-ConnectivityChecks
        }
        "down" { Stop-LogCollectors; Invoke-Compose down }
        "restart" { if ($Arg2) { Invoke-Compose restart $Arg2 } else { Invoke-Compose restart } }
        "logs" { if ($Arg2) { Invoke-Compose logs -f $Arg2 } else { Invoke-Compose logs -f } }
        "test" { Invoke-Compose exec backend-dev bash -c "cd /app/backend && pytest tests/"; Invoke-Compose exec frontend-dev npm test -- --watchAll=false }
        "shell" { if ($Arg2) { Invoke-Compose exec $Arg2 bash } else { Invoke-Compose exec backend-dev bash } }
        "migrate" { Invoke-Compose exec backend-dev bash -c "cd /app/backend && alembic upgrade head" }
        "build" { if ($Arg2) { Invoke-Compose build $Arg2 } else { Invoke-Compose build } }
        "ps" { Invoke-Compose ps }
        default { throw "Usage: ./scripts/dev.ps1 {up|down|restart|logs|test|shell|migrate|build|ps|verify}" }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-Main -CliArgs $args
}
