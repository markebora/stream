!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall add rule name="Disciples Stream" dir=in action=allow program="$INSTDIR\Disciples Stream.exe" enable=yes'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Disciples Stream"'
!macroend
