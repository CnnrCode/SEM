; installer-admin.nsh — Custom NSIS hooks for Prodigy Browser Admin installer
; Runs after the main installer finishes creating shortcuts.

!macro customInstall
  ; ── Admin Panel shortcut on Desktop ──────────────────────────────────────────
  CreateShortcut "$DESKTOP\Launch Admin Panel.lnk" \
    "$INSTDIR\Prodigy Browser.exe" "--admin" \
    "$INSTDIR\Prodigy Browser.exe" 0 \
    SW_SHOWNORMAL "" "Open Prodigy Browser Admin Panel"

  ; ── Admin Panel shortcut in Start Menu ───────────────────────────────────────
  CreateShortcut "$SMPROGRAMS\Prodigy Browser\Launch Admin Panel.lnk" \
    "$INSTDIR\Prodigy Browser.exe" "--admin" \
    "$INSTDIR\Prodigy Browser.exe" 0 \
    SW_SHOWNORMAL "" "Open Prodigy Browser Admin Panel"
!macroend

!macro customUnInstall
  ; Remove the extra Admin shortcut on uninstall
  Delete "$DESKTOP\Launch Admin Panel.lnk"
  Delete "$SMPROGRAMS\Prodigy Browser\Launch Admin Panel.lnk"
!macroend
