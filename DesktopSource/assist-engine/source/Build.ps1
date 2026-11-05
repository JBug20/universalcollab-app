$ErrorActionPreference = 'Stop'
$bundleRoot = Split-Path -Parent $PSScriptRoot
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compilerPath /nologo /target:winexe "/win32icon:$bundleRoot\Notify.ico" "/out:$bundleRoot\CollabAssistEngine.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:System.Security.dll "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll" "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationCore.dll" "/resource:$PSScriptRoot\obs.html,obs.html" "/resource:$PSScriptRoot\obs.js,obs.js" "/resource:$PSScriptRoot\obs.css,obs.css" "$PSScriptRoot\IntegratedHost.cs" "$PSScriptRoot\VersionInfo.cs" "$PSScriptRoot\TokenRenewal.cs" "$PSScriptRoot\ChatSend.cs" "$PSScriptRoot\CollabIntegration.cs" "$PSScriptRoot\ToolsIntegration.cs" "$PSScriptRoot\Pulsoid.cs" "$PSScriptRoot\ObsIntegration.cs" "$PSScriptRoot\CombinedChat.cs" "$PSScriptRoot\Notify.cs" "$PSScriptRoot\Notifications.cs" "$PSScriptRoot\ActionIcons.cs" "$PSScriptRoot\InlineEmotes.cs" "$PSScriptRoot\DirectTwitch.cs" "$PSScriptRoot\DirectStreamlabs.cs" "$PSScriptRoot\DirectYouTube.cs" "$PSScriptRoot\DirectKick.cs" "$PSScriptRoot\Accounts.cs" "$PSScriptRoot\ModernLayout.cs" "$PSScriptRoot\Experience.cs"
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }






