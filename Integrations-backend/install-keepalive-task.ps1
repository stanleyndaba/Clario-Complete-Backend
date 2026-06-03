# ============================================================
# Margin Analytics — SP-API Keep-Alive Task Installer
# RIGHT-CLICK THIS FILE → "Run as Administrator"
# ============================================================

$TaskName = "MarginAnalytics-SPAPI-KeepAlive"
$XmlPath  = "C:\Users\Student\Contacts\Clario-Complete-Backend\Integrations-backend\spapi-keepalive-task.xml"
$BatPath  = "C:\Users\Student\Contacts\Clario-Complete-Backend\Integrations-backend\run-spapi-keepalive.bat"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Margin Analytics — SP-API Keep-Alive Task Installer" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# Check bat file exists
if (-not (Test-Path $BatPath)) {
    Write-Host "ERROR: run-spapi-keepalive.bat not found at:" -ForegroundColor Red
    Write-Host "  $BatPath" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Remove old task if it exists
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing old task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  Done." -ForegroundColor Green
}

# Register from XML if it exists, otherwise build it manually
if (Test-Path $XmlPath) {
    Write-Host "Registering task from XML..." -ForegroundColor Yellow
    Register-ScheduledTask -Xml (Get-Content $XmlPath | Out-String) -TaskName $TaskName -Force | Out-Null
} else {
    Write-Host "XML not found — building task manually..." -ForegroundColor Yellow

    $Action  = New-ScheduledTaskAction -Execute $BatPath

    # Three triggers:
    # 1. Every 14 days at 9 AM
    $T1 = New-ScheduledTaskTrigger -Daily -DaysInterval 14 -At "09:00AM"
    # 2. At startup (3-min delay for network)
    $T2 = New-ScheduledTaskTrigger -AtStartup
    $T2.Delay = "PT3M"
    # 3. At logon
    $T3 = New-ScheduledTaskTrigger -AtLogOn

    $Settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -RunOnlyIfNetworkAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -MultipleInstances IgnoreNew `
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action   $Action `
        -Trigger  @($T1, $T2, $T3) `
        -Settings $Settings `
        -RunLevel Limited `
        -Force | Out-Null
}

# Verify
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host ""
    Write-Host "SUCCESS! Task registered." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Name:     $($task.TaskName)"     -ForegroundColor White
    Write-Host "  State:    $($task.State)"          -ForegroundColor White
    Write-Host "  Triggers: Every 14 days + Startup + Logon" -ForegroundColor White
    Write-Host "  Bat file: $BatPath"               -ForegroundColor White
    Write-Host ""
    Write-Host "Running it once now to confirm it works..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 30
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "  Last Run Result: $($info.LastTaskResult)" -ForegroundColor $(if ($info.LastTaskResult -eq 0) { "Green" } else { "Red" })
    Write-Host "  Last Run Time:   $($info.LastRunTime)"
    Write-Host "  Next Run Time:   $($info.NextRunTime)"
    Write-Host ""
    if ($info.LastTaskResult -eq 0) {
        Write-Host "KEEP-ALIVE IS LIVE. SP-API will never deactivate again." -ForegroundColor Green
    } else {
        Write-Host "Task ran but returned a non-zero exit code. Check spapi-keepalive.log" -ForegroundColor Yellow
    }
} else {
    Write-Host "FAILED to register task. Try running this script as Administrator." -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to close"
