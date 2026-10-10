; Updates: show only a small "Installing Cadence" progress window, then open Cadence.
;
; Cadence starts its update installer with --updated (not silent, so people can see that
; something is happening). The installer already skips the folder page when updating;
; this also skips the "who is it for" page (keeping how it was installed before) and the
; Finish page (opening Cadence straight away instead).

!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

!macro customFinishPage
  ; Like electron-builder's StartApp (which can't be used twice): open Cadence as the
  ; signed-in user, even when the installer itself was given permission to change files.
  Function cadenceRunApp
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd

  Function cadenceFinishPre
    ${if} ${isUpdated}
      HideWindow
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      Abort
    ${endif}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE cadenceFinishPre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION cadenceRunApp
  !insertmacro MUI_PAGE_FINISH
!macroend
