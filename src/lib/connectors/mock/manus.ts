import type {AgentSystemAdapter,AgentSystemState,ConnectorDescriptor} from "../types";
import {createMockAdapter} from "./shared";
import type {ManusStatus} from "../live/manus-v2";

// Registered connector, NOT a seventh ACF agent, runtime, or pane.
// State is read only from /api/connectors/manus/status; no simulated turns.
const descriptor:ConnectorDescriptor={
  id:"manus",name:"Manus API v2",type:"integration",category:"APIs / Webhooks",
  connectionModes:["api"],activeMode:"api",status:"pending-setup",
  capabilities:["Manus task.create (explicit per-task credit consent)","task.detail status","task.listMessages result retrieval"],
  permissions:["read-authentication-status","explicit-task-submission-after-consent"],
  lastSync:null,memoryWriteObligation:false,obsidianWriteTarget:null,
  realConnectionFields:[{key:"MANUS_API_KEY_FILE",label:"Server-side Manus API key secret file",
    placeholder:"/workspace/runtime-data/secrets/manus-api-key",kind:"secret"}],
};
const base=createMockAdapter({descriptor,modelOrService:"Manus API v2",initialRunState:"blocked",
  taskLines:[],streamLines:[],seedLogs:[],seedReports:[],seedApprovals:[],readActions:[],writeActions:[]});
function translate(s:ManusStatus):AgentSystemState["status"] {
  if(s.connection==="connected") return "connected";
  if(s.connection==="blocked") return "degraded";
  return "pending-setup";
}
export const manusAdapter:AgentSystemAdapter={
  ...base,
  async getState(){
    let live:ManusStatus|null=null;
    try {
      const response=await fetch("/api/connectors/manus/status",{cache:"no-store"});
      if(response.ok)live=await response.json() as ManusStatus;
    } catch {/* not connected != disconnected */}
    return {
      ...await base.getState(),
      status:live?translate(live):"pending-setup",
      runState:"blocked",health:live?.connection==="connected"?"ok":"warn",
      currentTask:null,connectorMode:"api",commandExecution:false,
      outputKind:"live-status",lastOutput:null,
      statusDetail:live?{
        "connection":live.connection,
        "credential":"server-side, never shown",
        "API authentication verified":live.authVerified?"yes":"no",
        "task submission":"operator-confirmed, may consume Manus credits",
        "reason":live.reason,
      }:{"connection":"unknown","reason":"status endpoint not available","credential":"server-side, never shown","API authentication verified":"no","task submission":"disabled"},
      controlledAction:null,
      capabilities:[
        {kind:"status",available:!!live},
        {kind:"readOnlyData",available:live?.connection==="connected",reason:live?.reason??"status unavailable"},
        {kind:"controlledPrompt",available:false,reason:"Task initiation requires per-task spending confirmation in the Manus operator panel"},
      ],
    };
  },
  async sendCommand(){return;},async start(){return;},async pause(){return;},async resume(){return;},async stop(){return;},
};
