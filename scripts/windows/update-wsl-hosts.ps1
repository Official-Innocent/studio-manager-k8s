# update-wsl-hosts.ps1
# Auto-updates biggshots.local in the Windows hosts file to match
# the current WSL2 VM IP (which changes on every WSL2/laptop restart).
# Retries for up to 2 minutes in case WSL2 hasn't finished booting at logon.
#
# One-time setup (run as Administrator):
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$HOME\update-wsl-hosts.ps1`""
#   $trigger = New-ScheduledTaskTrigger -AtLogOn
#   $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest
#   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
#   Register-ScheduledTask -TaskName "UpdateWSLHosts" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Auto-updates biggshots.local in hosts file to match current WSL2 IP"

$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$hostEntry = "biggshots.local"
$maxAttempts = 12
$delaySeconds = 10

for ($i = 1; $i -le $maxAttempts; $i++) {
    $wslIp = (wsl hostname -I 2>$null).Trim().Split(" ")[0]
    if ($wslIp) {
        $hostsContent = Get-Content $hostsPath
        $filtered = $hostsContent | Where-Object { $_ -notmatch $hostEntry }
        $filtered += "$wslIp $hostEntry"
        $filtered | Set-Content $hostsPath
        Write-Host "Updated: $wslIp $hostEntry (attempt $i)" -ForegroundColor Green
        exit 0
    }
    Start-Sleep -Seconds $delaySeconds
}

Write-Host "Failed to detect WSL2 IP after $maxAttempts attempts." -ForegroundColor Red
exit 1
