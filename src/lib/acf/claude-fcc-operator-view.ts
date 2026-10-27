/** Presentation only. No side effects, no eligibility registry and no model-price gates. */
export type ClaudeFccOperatorInput = {
  fcc: "connected"|"degraded"|"disconnected"|"unknown";
  nativeVersion: string|null;
  stageSession: {status:string;active:boolean;hasNativeId:boolean;firstTurnStored:boolean}|null;
  acfSession: {status:string;verdict:string}|null;
  canJoinNow:boolean;
  teamPaused:boolean;
};
export type ClaudeFccOperatorState = {
  kind:"ERROR"|"PAUSED"|"PREPARED"|"READY"|"RUNNING"|"STOPPED"|"UNKNOWN";
  title:string;
  explanation:string;
  next:"INSPECT_ERROR"|"OPEN_EXISTING_PREPARED"|"SHOW_RESUME"|"VIEW_EXISTING"|"CHECK_STATUS";
  acfReady:boolean;
};
export function deriveClaudeFccOperatorState(x:ClaudeFccOperatorInput):ClaudeFccOperatorState {
  const stage=x.stageSession;
  // Team Room intervention is NOT native Claude process state.
  if(x.teamPaused && x.acfSession && x.acfSession.verdict==="ELIGIBLE")
    return {kind:"PAUSED",title:"Teamgesprek gepauzeerd",
      explanation:"Dennis heeft een ACF-ingreep open. Hervatten gebeurt in de bestaande Operatorstoel; niet met een nieuwe Claude-sessie.",
      next:"SHOW_RESUME",acfReady:false};
  if(x.acfSession?.verdict==="EXCLUDED_ERROR" || stage?.status==="error")
    return {kind:"ERROR",title:"Claude Code: samenwerking geblokkeerd",
      explanation:stage?.status==="prepared"
        ?"De oude ACF-registratie staat op ERROR. De eigen Werkplaatssessie is alleen PREPARED; nog geen bewezen native eerste beurt."
        :"De bestaande ACF-/Claude-sessie staat op ERROR. Dit is geen pauze: niet automatisch opnieuw starten of hervatten.",
      next:"INSPECT_ERROR",acfReady:false};
  if(stage?.status==="prepared")
    return {kind:"PREPARED",title:"Claude Code: sessie voorbereid",
      explanation:"De sessie bestaat, maar heeft nog geen bewezen eerste native operatorbeurt. Alleen Dennis kan een eerste bericht sturen.",
      next:"OPEN_EXISTING_PREPARED",acfReady:false};
  if(stage?.status==="running"||stage?.status==="starting")
    return {kind:"RUNNING",title:"Claude Code: beurt mogelijk in uitvoering",
      explanation:"De sessiestatus is niet afgerond. Niet opnieuw verzenden of hervatten zonder vastgestelde uitkomst.",
      next:"CHECK_STATUS",acfReady:false};
  if(stage?.status==="stopped")
    return {kind:"STOPPED",title:"Claude Code: sessie gestopt",
      explanation:"Bestaande sessie en geschiedenis bewaren. Geen automatische bootstrap of vervangende sessie.",
      next:"VIEW_EXISTING",acfReady:false};
  // Native version + ACF eligibility + proof of a real first stored turn are
  // distinct, all required. FCC health alone can NEVER produce READY.
  if(stage?.active && stage.status==="idle" && stage.firstTurnStored &&
    stage.hasNativeId && x.acfSession?.verdict==="ELIGIBLE" &&
    x.canJoinNow && x.fcc==="connected" && x.nativeVersion)
    return {kind:"READY",title:"Claude Code: kan deelnemen",
      explanation:"De native sessie, ACF-toelating en FCC-transport zijn onafhankelijk bevestigd.",
      next:"VIEW_EXISTING",acfReady:true};
  return {kind:"UNKNOWN",title:"Claude Code: nog niet inzetbaar bevestigd",
    explanation:"FCC-verbinding, native proces, opgeslagen eerste beurt en ACF-geschiktheid zijn verschillende controles. Niet automatisch herstarten.",
    next:"CHECK_STATUS",acfReady:false};
}
