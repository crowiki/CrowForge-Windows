' CrowForge - Launcher Silencioso
' Inicia o instalador gráfico sem janela de CMD visível
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\installer"
WshShell.Run "cmd /c npm start", 0, False
Set WshShell = Nothing